import { renderSnapshotSchema, type RenderSnapshot } from "@aivideo/contracts";
import { validateTimeline, timelineAssetIds } from "./timeline";
import {
  generationRequestSchema,
  modelCatalog,
  workflowSchema,
  type LocalTask,
  type TaskStatus,
  type WorkflowGraph,
  type GenerationRequest,
} from "@aivideo/contracts";
export const taskStatusLabels: Record<TaskStatus, string> = {
  queued: "排队中",
  running: "执行中",
  blocked: "待接入 API",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  unknown: "提交待核对",
  archiving: "归档中",
  archive_failed: "归档失败",
  cancel_requested: "取消申请中",
  reconciling: "核对中",
};
export const isTerminal = (status: TaskStatus) =>
  ["succeeded", "failed", "cancelled"].includes(status);
export const canRetry = (task: LocalTask) =>
  ["blocked", "failed", "cancelled"].includes(task.status);
const transitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: [
    "succeeded",
    "blocked",
    "failed",
    "cancelled",
    "interrupted",
    "unknown",
    "archiving",
    "archive_failed",
    "cancel_requested",
  ],
  interrupted: ["queued", "cancelled"],
  blocked: ["cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  unknown: ["reconciling"],
  reconciling: ["running", "unknown", "cancel_requested", "failed"],
  archiving: ["succeeded", "archive_failed", "cancel_requested"],
  archive_failed: ["queued", "cancel_requested"],
  cancel_requested: [
    "cancelled",
    "succeeded",
    "archive_failed",
    "unknown",
    "failed",
  ],
};
export function transitionTask(
  task: LocalTask,
  status: TaskStatus,
  message: string,
  error?: LocalTask["error"],
): LocalTask {
  if (task.status !== status && !transitions[task.status].includes(status))
    throw new Error(`任务状态不能从 ${task.status} 切换为 ${status}`);
  const at = new Date().toISOString();
  return {
    ...task,
    status,
    updatedAt: at,
    error,
    events: [...task.events, { at, status, message }].slice(-200),
  };
}
export function createTask(
  input:
    | { request: GenerationRequest }
    | { render: RenderSnapshot }
    | {
        graph: WorkflowGraph;
        mode: "provider" | "dry-run";
        workflowVersion?: number;
      },
  idempotencyKey: string = crypto.randomUUID(),
): LocalTask {
  const id = crypto.randomUUID(),
    at = new Date().toISOString();
  const request =
    "request" in input
      ? generationRequestSchema.parse(input.request)
      : undefined;
  const graph =
    "graph" in input ? workflowSchema.parse(input.graph) : undefined;
  const render =
    "render" in input ? renderSnapshotSchema.parse(input.render) : undefined;
  if (render) validateTimeline(render.timeline, true);
  const model =
    request && modelCatalog.find((m) => m.key === request.modelKey)!;
  return {
    schemaVersion: 1,
    id,
    groupId: id,
    idempotencyKey,
    attempt: 1,
    revision: 0,
    title: render
      ? `${render.episodeName} · 成片 v${render.version}`
      : (graph?.name ??
        `${model && model.name} · ${request?.prompt.slice(0, 40)}`),
    kind: render ? "video" : graph ? "workflow" : model!.kind,
    mode: render
      ? "render"
      : graph
        ? (input as { mode: LocalTask["mode"] }).mode
        : "provider",
    status: "queued",
    createdAt: at,
    updatedAt: at,
    request,
    graph,
    render,
    ...("workflowVersion" in input
      ? { workflowVersion: input.workflowVersion }
      : {}),
    nodes:
      graph?.nodes.map((n) => ({
        nodeId: n.id,
        status: "pending",
        inputs: {},
        outputs: {},
      })) ?? [],
    outputAssetIds: [],
    events: [
      {
        at,
        status: "queued",
        message: render
          ? "已冻结剪辑版本，等待后台合成"
          : graph
            ? "已保存工作流运行快照"
            : "已保存生成参数，等待提交",
      },
    ],
  };
}
export function retryTaskSnapshot(previous: LocalTask): LocalTask {
  if (!canRetry(previous))
    throw new Error("此状态不能重试；提交结果不确定时需要先核对，避免重复生成");
  const task = previous.render
    ? createTask({ render: previous.render })
    : previous.graph
      ? createTask({
          graph: previous.graph,
          mode: previous.mode === "dry-run" ? "dry-run" : "provider",
          workflowVersion: previous.workflowVersion,
        })
      : createTask({ request: previous.request! });
  return { ...task, groupId: previous.groupId, attempt: previous.attempt + 1 };
}
export function referencesForTask(task: LocalTask) {
  const assetIds = new Set(task.request?.assetIds ?? []),
    voiceIds = new Set<string>();
  if (task.render)
    timelineAssetIds(task.render.timeline).forEach((id) => assetIds.add(id));
  if (task.request?.voiceId) voiceIds.add(task.request.voiceId);
  for (const node of task.graph?.nodes ?? []) {
    if (node.data.assetId) assetIds.add(node.data.assetId);
    if (node.data.voiceId) voiceIds.add(node.data.voiceId);
  }
  for (const id of task.outputAssetIds) assetIds.add(id);
  return { assetIds, voiceIds };
}
export function taskLabel(task: LocalTask) {
  return task.mode === "dry-run" && task.status === "succeeded"
    ? "试运行通过"
    : taskStatusLabels[task.status];
}
