import { describe, expect, it, vi } from "vitest";
import { generationRequestSchema } from "../packages/contracts/src/index";
import {
  createTask,
  transitionTask,
  retryTaskSnapshot,
  canRetry,
  referencesForTask,
} from "../packages/core/src/tasks";
import {
  checkRun,
  performWorkflowStep,
  type GenerationExecutor,
} from "../packages/core/src/execution";
import { createTemplate } from "../packages/core/src/workflow";
import { probeGeneration } from "../packages/core/src/task-client";
const empty = { assets: [], voices: [] };
const blocked: GenerationExecutor = async () => ({
  status: "blocked",
  error: { code: "PROVIDER_NOT_CONFIGURED", message: "尚未配置" },
});
const run = () =>
  transitionTask(
    createTask({ graph: createTemplate("image-video"), mode: "dry-run" }),
    "running",
    "开始",
  );
describe("local task transitions and snapshots", () => {
  it("freezes input values and creates separate retry attempts", () => {
    const request = generationRequestSchema.parse({
      modelKey: "image.nano-banana-2.t2i.v1",
      prompt: "原始提示",
      parameters: { aspectRatio: "9:16" },
    });
    const task = createTask({ request });
    request.prompt = "已修改";
    request.parameters.aspectRatio = "16:9";
    expect(task.request?.prompt).toBe("原始提示");
    expect(task.request?.parameters.aspectRatio).toBe("9:16");
    const previous = transitionTask(
      transitionTask(task, "running", "检查"),
      "blocked",
      "待接入",
    );
    const retry = retryTaskSnapshot(previous);
    expect(retry.id).not.toBe(task.id);
    expect(retry.idempotencyKey).not.toBe(task.idempotencyKey);
    expect(retry.groupId).toBe(task.groupId);
    expect(retry.attempt).toBe(2);
    expect(retry.request).toEqual(task.request);
    expect(previous.status).toBe("blocked");
  });
  it("does not resurrect cancellation or retry an uncertain paid submission", () => {
    const running = run();
    const cancelled = transitionTask(running, "cancelled", "取消");
    expect(() =>
      transitionTask(cancelled, "succeeded", "迟到的结果"),
    ).toThrow();
    const unknown = transitionTask(running, "unknown", "核对");
    expect(canRetry(unknown)).toBe(false);
    expect(() => retryTaskSnapshot(unknown)).toThrow("需要先核对");
  });
});
describe("workflow execution", () => {
  it("resolves the DAG, transfers text and planned image references without calling any model", async () => {
    let task = run();
    const executor = vi.fn(blocked);
    for (let i = 0; i < 3; i++)
      task = await performWorkflowStep(task, empty, executor);
    expect(task.status).toBe("succeeded");
    expect(executor).not.toHaveBeenCalled();
    expect(task.outputAssetIds).toEqual([]);
    expect(task.nodes.find((n) => n.nodeId === "image")?.inputs.prompt).toEqual(
      { type: "text", text: "窗边的陶瓷花瓶，自然光" },
    );
    expect(task.nodes.find((n) => n.nodeId === "video")?.inputs.image).toEqual({
      type: "image",
      planned: true,
      nodeId: "image",
    });
    expect(JSON.stringify(task.nodes)).not.toContain("https://");
  });
  it("stops at a blocked generation node and leaves downstream untouched", async () => {
    let task = { ...run(), mode: "provider" as const };
    const executor = vi.fn(blocked);
    task = await performWorkflowStep(task, empty, executor);
    task = await performWorkflowStep(task, empty, executor);
    expect(task.status).toBe("blocked");
    expect(task.nodes.find((n) => n.nodeId === "video")?.status).toBe(
      "pending",
    );
    expect(executor).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "窗边的陶瓷花瓶，自然光" }),
      `${task.idempotencyKey}:image`,
    );
    expect(await performWorkflowStep(task, empty, executor)).toBe(task);
    expect(executor).toHaveBeenCalledTimes(1);
  });
  it("continues after a saved checkpoint instead of redoing completed nodes", async () => {
    let task = await performWorkflowStep(run(), empty, blocked);
    const checkpoint = structuredClone(task.nodes[0]);
    task = transitionTask(task, "interrupted", "中断");
    task = transitionTask(task, "queued", "继续");
    task = transitionTask(task, "running", "继续");
    task = await performWorkflowStep(task, empty, blocked);
    task = await performWorkflowStep(task, empty, blocked);
    expect(task.status).toBe("succeeded");
    expect(task.nodes[0]).toEqual(checkpoint);
  });
  it("checks imported references and the resolved voice text length", async () => {
    const graph = createTemplate("voice"),
      voiceId = crypto.randomUUID(),
      assetId = crypto.randomUUID();
    graph.nodes[0].data.voiceId = voiceId;
    graph.nodes[1].data.text = "长".repeat(501);
    const task = createTask({ graph, mode: "dry-run" });
    expect(() => checkRun(task, empty)).toThrow("参考声音不存在");
    const library = {
      assets: [{ id: assetId, kind: "audio" as const }],
      voices: [{ id: voiceId, assetId }],
    };
    let next = transitionTask(task, "running", "开始");
    for (let i = 0; i < 3; i++)
      next = await performWorkflowStep(next, library, blocked);
    expect(next.status).toBe("failed");
    expect(next.outputAssetIds).toEqual([]);
    expect(referencesForTask(task).voiceIds.has(voiceId)).toBe(true);
  });
  it("uses concrete archived output IDs for downstream real execution adapters", async () => {
    const imageId = crypto.randomUUID(),
      videoId = crypto.randomUUID();
    const executor = vi.fn<GenerationExecutor>(async (request) =>
      request.modelKey.startsWith("image.")
        ? {
            status: "succeeded",
            outputs: { image: { type: "image", assetId: imageId } },
          }
        : {
            status: "succeeded",
            outputs: { video: { type: "video", assetId: videoId } },
          },
    );
    let task = { ...run(), mode: "provider" as const };
    for (let i = 0; i < 3; i++)
      task = await performWorkflowStep(task, empty, executor);
    expect(task.status).toBe("succeeded");
    expect(task.outputAssetIds).toEqual([imageId, videoId]);
    expect(executor.mock.calls[1][0].assetIds).toEqual([imageId]);
  });
  it("rejects per-model parameter errors even when using planned references", async () => {
    let task = run();
    task.graph!.nodes[2].data.modelKey = "video.kling-o3.i2v.v1";
    task.graph!.nodes[2].data.parameters = { durationSeconds: 10 };
    for (let i = 0; i < 3; i++)
      task = await performWorkflowStep(task, empty, blocked);
    expect(task.status).toBe("failed");
    expect(task.nodes[2].outputs).toEqual({});
  });
});
describe("reserved API seam", () => {
  it("marks a timeout or unexpected success as uncertain and does not retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "unexpected" }), { status: 202 }),
      );
    try {
      const request = generationRequestSchema.parse({
        modelKey: "image.flux2.t2i.v1",
        prompt: "测试",
      });
      expect((await probeGeneration(request, "one")).status).toBe("unknown");
      expect((await probeGeneration(request, "two")).status).toBe("unknown");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
