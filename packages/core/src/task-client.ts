import {
  workspaceBackend,
  workspaceRequest,
  workspaceChanged,
  serverTaskAction,
} from "./workspace-client";
import {
  generationRequestSchema,
  modelCatalog,
  type GenerationRequest,
  type LocalTask,
  type WorkflowGraph,
} from "@aivideo/contracts";
import {
  createLocalTask,
  getLocal,
  listLocal,
  mutateTask,
  LOCAL_CHANGE,
} from "./local";
import { createTask, transitionTask, retryTaskSnapshot } from "./tasks";
import {
  checkRun,
  performWorkflowStep,
  type ExecutionResult,
} from "./execution";
function requireLocks() {
  if (!navigator.locks)
    throw new Error(
      "此浏览器不支持安全的本地任务调度，请使用新版 Chrome、Edge 或 Safari",
    );
}
/** Only probes our disabled server endpoint. A real provider adapter must stay server-side. */
export async function probeGeneration(
  request: GenerationRequest,
  idempotencyKey: string,
): Promise<ExecutionResult> {
  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    if (
      response.status === 503 &&
      ["PROVIDER_NOT_CONFIGURED", "GENERATION_NOT_ENABLED"].includes(
        body.error?.code,
      )
    )
      return { status: "blocked", error: body.error };
    if (response.status >= 400 && response.status < 500)
      return {
        status: "failed",
        error: {
          code: body.error?.code ?? "INVALID_REQUEST",
          message: body.error?.message ?? "请求未被接受",
        },
      };
    return {
      status: "unknown",
      error: {
        code: "SUBMISSION_UNKNOWN",
        message:
          "提交结果暂时无法确认，请核对服务端状态后再操作；不会自动重试。",
      },
    };
  } catch {
    return {
      status: "unknown",
      error: {
        code: "SUBMISSION_UNKNOWN",
        message: "无法确认提交结果，请检查连接并核对任务；不会自动重复提交。",
      },
    };
  }
}
async function library() {
  const [assets, voices] = await Promise.all([
    listLocal("assets"),
    listLocal("voices"),
  ]);
  return { assets, voices };
}
async function validateRequestReferences(request: GenerationRequest) {
  const { assets, voices } = await library();
  const model = modelCatalog.find((m) => m.key === request.modelKey)!;
  for (const id of request.assetIds)
    if (
      !assets.some(
        (a) =>
          a.id === id &&
          a.kind === (model.kind === "voice" ? "audio" : "image"),
      )
    )
      throw new Error("参考素材不存在或类型不匹配，请重新选择");
  if (request.voiceId) {
    const voice = voices.find((v) => v.id === request.voiceId);
    if (
      !voice ||
      !assets.some((a) => a.id === voice.assetId && a.kind === "audio")
    )
      throw new Error("参考声音不存在，请重新选择");
  }
}
export async function executeLocalTask(id: string) {
  requireLocks();
  return navigator.locks.request(
    `aivideo-task:${id}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return;
      let task = await getLocal("tasks", id);
      if (!task) return;
      if (task.status === "running") {
        return mutateTask(id, (current) =>
          current.status !== "running"
            ? current
            : transitionTask(
                current,
                current.mode === "dry-run" ? "interrupted" : "unknown",
                current.mode === "dry-run"
                  ? "页面执行已中断；可从已完成节点继续试运行"
                  : "页面执行已中断，提交状态需要核对；不会自动重试",
                {
                  code:
                    current.mode === "dry-run"
                      ? "LOCAL_INTERRUPTED"
                      : "SUBMISSION_UNKNOWN",
                  message: "执行上下文已离开，检查点已保留",
                },
              ),
        );
      }
      if (task.status !== "queued") return task;
      task = await mutateTask(id, (current) =>
        current.status !== "queued"
          ? current
          : transitionTask(
              current,
              "running",
              current.mode === "dry-run"
                ? "开始本地试运行，不调用模型 API"
                : "开始检查生成接口",
            ),
      );
      if (task.status !== "running") return task;
      try {
        if (task.request) {
          await validateRequestReferences(task.request);
          const result = await probeGeneration(
            task.request,
            task.idempotencyKey,
          );
          return mutateTask(id, (current) =>
            current.status !== "running"
              ? current
              : transitionTask(
                  current,
                  result.status,
                  result.status === "succeeded"
                    ? "生成完成"
                    : result.error.message,
                  result.status === "succeeded" ? undefined : result.error,
                ),
          );
        }
        const resources = await library();
        checkRun(task, resources);
        while (task.status === "running") {
          const next = await performWorkflowStep(
            task,
            resources,
            probeGeneration,
            async (prepared) => {
              const current = await mutateTask(id, (value) =>
                value.status !== "running"
                  ? value
                  : {
                      ...value,
                      nodes: prepared.nodes,
                      events: prepared.events,
                    },
              );
              if (current.status !== "running") throw new Error("任务已停止");
            },
          );
          task = await mutateTask(id, (current) =>
            current.status !== "running"
              ? current
              : { ...next, revision: current.revision },
          );
        }
        return task;
      } catch (e) {
        const message = e instanceof Error ? e.message : "本地执行失败";
        return mutateTask(id, (current) =>
          current.status !== "running"
            ? current
            : transitionTask(current, "failed", message, {
                code: "LOCAL_EXECUTION_FAILED",
                message,
              }),
        );
      }
    },
  );
}
async function waitForTask(id: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const task = await getLocal("tasks", id);
    if (!task) throw new Error("任务记录不存在");
    if (!["queued", "running"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("任务仍在处理中，请到任务中心查看；请勿重复提交");
}
export async function submitGenerationTask(
  raw: GenerationRequest,
  key = crypto.randomUUID(),
) {
  const request = generationRequestSchema.parse(raw);
  if ((await workspaceBackend()) === "server") {
    const { item } = await workspaceRequest<{ item: LocalTask }>("/api/jobs", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(request),
    });
    workspaceChanged("tasks");
    return item;
  }
  requireLocks();
  await validateRequestReferences(request);
  const task = await createLocalTask(createTask({ request }, key));
  await executeLocalTask(task.id);
  return waitForTask(task.id);
}
export async function submitWorkflowTask(
  graph: WorkflowGraph,
  mode: "provider" | "dry-run",
  workflowVersion?: number,
) {
  if ((await workspaceBackend()) === "server") {
    const { item } = await workspaceRequest<{ item: LocalTask }>("/api/jobs", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ kind: "workflow", graph, mode, workflowVersion }),
    });
    workspaceChanged("tasks");
    return item;
  }
  requireLocks();
  const task = createTask({ graph, mode, workflowVersion });
  checkRun(task, await library());
  return createLocalTask(task);
}
export async function cancelLocalTask(id: string) {
  if ((await workspaceBackend()) === "server")
    return serverTaskAction(id, "cancel");
  return mutateTask(id, (task) => ({
    ...transitionTask(task, "cancelled", "已取消本地任务"),
    nodes: task.nodes.map((n) =>
      ["pending", "running"].includes(n.status)
        ? { ...n, status: "cancelled" as const, message: "未继续执行" }
        : n,
    ),
  }));
}
export async function resumeLocalTask(id: string) {
  if ((await workspaceBackend()) === "server")
    return serverTaskAction(id, "resume");
  requireLocks();
  return mutateTask(id, (task) => {
    if (task.status !== "interrupted" || task.mode !== "dry-run")
      throw new Error("只能继续已中断的本地试运行");
    return {
      ...transitionTask(task, "queued", "从已完成节点继续试运行"),
      nodes: task.nodes.map((n) =>
        n.status === "running"
          ? { ...n, status: "pending" as const, inputs: {}, outputs: {} }
          : n,
      ),
    };
  });
}
export async function retryLocalTask(id: string) {
  if ((await workspaceBackend()) === "server")
    return serverTaskAction(id, "retry");
  requireLocks();
  const previous = await getLocal("tasks", id);
  if (!previous) throw new Error("任务不存在");
  const next = retryTaskSnapshot(previous);
  if (next.request) await validateRequestReferences(next.request);
  else checkRun(next, await library());
  return createLocalTask(next);
}
let pumping = false;
export function startLocalTaskRunner(onError: (message: string) => void) {
  let stopped = false;
  async function pump() {
    if (pumping || stopped) return;
    pumping = true;
    try {
      if ((await workspaceBackend()) === "server") return;
      const tasks = await listLocal("tasks");
      for (const task of tasks.filter((t) =>
        ["queued", "running"].includes(t.status),
      )) {
        if (stopped) break;
        await executeLocalTask(task.id);
      }
    } catch (e) {
      if (!stopped) onError(e instanceof Error ? e.message : "任务调度失败");
    } finally {
      pumping = false;
    }
  }
  function changed(event: Event) {
    if (!(event instanceof CustomEvent) || event.detail?.store === "tasks")
      void pump();
  }
  window.addEventListener(LOCAL_CHANGE, changed);
  window.addEventListener("focus", pump);
  const timer = setInterval(pump, 2_000);
  void pump();
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener(LOCAL_CHANGE, changed);
    window.removeEventListener("focus", pump);
  };
}
