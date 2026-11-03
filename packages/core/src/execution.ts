import {
  generationRequestSchema,
  modelCatalog,
  type GenerationRequest,
  type LocalAsset,
  type LocalVoice,
  type LocalTask,
  type RunValue,
  type NodeCheckpoint,
} from "@aivideo/contracts";
import { validateWorkflow, validateReferences } from "./workflow";
import { transitionTask } from "./tasks";
export type Library = {
  assets: Pick<LocalAsset, "id" | "kind">[];
  voices: Pick<LocalVoice, "id" | "assetId">[];
};
export type ExecutionResult =
  | { status: "succeeded"; outputs: Record<string, RunValue> }
  | {
      status: "blocked" | "failed" | "unknown" | "archive_failed";
      error: { code: string; message: string };
    };
export type GenerationExecutor = (
  request: GenerationRequest,
  idempotencyKey: string,
) => Promise<ExecutionResult>;
export function checkRun(task: LocalTask, library: Library) {
  if (!task.graph) throw new Error("缺少工作流快照");
  const result = validateWorkflow(task.graph);
  const errors = [
    ...result.errors,
    ...validateReferences(task.graph, library.assets, library.voices),
  ];
  if (errors.length) throw new Error(errors.join("；"));
  return result.order;
}
/** Plan references carry no URL or fake asset ID. They are only usable in a dry run. */
export async function performWorkflowStep(
  task: LocalTask,
  library: Library,
  executor: GenerationExecutor,
  onPrepared?: (task: LocalTask) => Promise<void>,
): Promise<LocalTask> {
  if (task.status !== "running") return task;
  const order = checkRun(task, library);
  const nodeId = order.find(
    (id) => task.nodes.find((n) => n.nodeId === id)?.status !== "succeeded",
  );
  if (!nodeId)
    return transitionTask(
      task,
      "succeeded",
      task.mode === "dry-run" ? "试运行通过；没有生成媒体文件" : "工作流已完成",
    );
  const node = task.graph!.nodes.find((n) => n.id === nodeId)!;
  let checkpoint: NodeCheckpoint = {
    nodeId,
    status: "running",
    inputs: {},
    outputs: {},
    startedAt: new Date().toISOString(),
  };
  let prepared = task;
  try {
    for (const edge of task.graph!.edges.filter((e) => e.target === nodeId)) {
      const source = task.nodes.find((n) => n.nodeId === edge.source);
      const value = source?.outputs[edge.sourceHandle];
      if (source?.status !== "succeeded" || !value)
        throw new Error("上游节点尚未完成或缺少输出");
      checkpoint.inputs[edge.targetHandle] = value;
    }
    prepared = {
      ...task,
      nodes: task.nodes.map((n) => (n.nodeId === nodeId ? checkpoint : n)),
      events: [
        ...task.events,
        {
          at: checkpoint.startedAt!,
          status: "running" as const,
          nodeId,
          message: `开始检查：${node.data.label}`,
        },
      ].slice(-200),
    };
    await onPrepared?.(prepared);
    let result: ExecutionResult;
    if (node.type === "input.text") {
      result = {
        status: "succeeded",
        outputs: { text: { type: "text", text: node.data.text.trim() } },
      };
    } else if (node.type === "input.asset") {
      result = {
        status: "succeeded",
        outputs: { image: { type: "image", assetId: node.data.assetId! } },
      };
    } else if (node.type === "input.voice") {
      const voice = library.voices.find((v) => v.id === node.data.voiceId)!;
      result = {
        status: "succeeded",
        outputs: {
          voice: { type: "voice", assetId: voice.assetId, voiceId: voice.id },
        },
      };
    } else {
      const model = modelCatalog.find((m) => m.key === node.data.modelKey)!;
      const connectedText =
        checkpoint.inputs[node.type === "generate.voice" ? "text" : "prompt"];
      const prompt =
        connectedText?.type === "text" ? connectedText.text : node.data.text;
      const reference =
        checkpoint.inputs[model.kind === "voice" ? "voice" : "image"];
      const planned = reference && "planned" in reference;
      const parameters = node.data.parameters ?? {
        ...(model.parameters.aspectRatios.length
          ? { aspectRatio: model.parameters.aspectRatios[0] }
          : {}),
        ...(model.parameters.durationSeconds.length
          ? { durationSeconds: model.parameters.durationSeconds[0] }
          : {}),
      };
      const input = {
        modelKey: model.key,
        prompt,
        assetIds:
          reference && "assetId" in reference ? [reference.assetId] : [],
        parameters,
      };
      const parsed = generationRequestSchema.safeParse(input);
      // A downstream dry-run image reference has not been generated, so cannot have an asset UUID yet.
      const issues = parsed.success
        ? []
        : parsed.error.issues.filter(
            (issue) =>
              !(
                task.mode === "dry-run" &&
                planned &&
                issue.path[0] === "assetIds"
              ),
          );
      if (issues.length)
        throw new Error(issues.map((i) => i.message).join("；"));
      if (task.mode === "dry-run") {
        const type = model.kind === "voice" ? "audio" : model.kind;
        result = {
          status: "succeeded",
          outputs: { [type]: { type, planned: true, nodeId } },
        };
      } else {
        if (!parsed.success || planned)
          throw new Error("试运行计划引用不能提交到真实生成接口");
        result = await executor(
          parsed.data,
          `${task.idempotencyKey}:${nodeId}`,
        );
      }
    }
    checkpoint = {
      ...checkpoint,
      status: result.status === "unknown" ? "blocked" : result.status,
      finishedAt: new Date().toISOString(),
      outputs: result.status === "succeeded" ? result.outputs : {},
      message:
        result.status === "succeeded"
          ? task.mode === "dry-run" && node.type.startsWith("generate.")
            ? "参数检查通过 · 输出为计划引用，未生成文件"
            : "输入解析完成"
          : result.error.message,
    };
    const newAssets =
      node.type.startsWith("generate.") && result.status === "succeeded"
        ? Object.values(result.outputs).flatMap((v) =>
            "assetId" in v ? [v.assetId] : [],
          )
        : [];
    let next = {
      ...prepared,
      nodes: prepared.nodes.map((n) => (n.nodeId === nodeId ? checkpoint : n)),
      outputAssetIds: [...new Set([...prepared.outputAssetIds, ...newAssets])],
    };
    if (result.status !== "succeeded")
      return transitionTask(
        next,
        result.status,
        `${node.data.label}：${result.error.message}`,
        result.error,
      );
    const complete = next.nodes.every((n) => n.status === "succeeded");
    next = transitionTask(
      next,
      complete ? "succeeded" : "running",
      complete
        ? task.mode === "dry-run"
          ? "试运行通过；没有生成媒体文件"
          : "工作流已完成"
        : `${node.data.label}：${checkpoint.message}`,
    );
    return next;
  } catch (e) {
    const message = e instanceof Error ? e.message : "节点执行失败";
    return transitionTask(
      {
        ...prepared,
        nodes: prepared.nodes.map((n) =>
          n.nodeId === nodeId
            ? {
                ...checkpoint,
                status: "failed",
                message,
                finishedAt: new Date().toISOString(),
              }
            : n,
        ),
      },
      "failed",
      `${node.data.label}：${message}`,
      { code: "NODE_FAILED", message },
    );
  }
}
