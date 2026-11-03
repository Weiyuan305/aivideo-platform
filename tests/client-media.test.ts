import { describe, expect, it, vi } from "vitest";
import {
  mediaDraftRequest,
  mediaReuseTargets,
  workflowFromImage,
  replaceWorkflowDraft,
  workflowDraftKey,
  previousWorkflowDraftKey,
} from "../packages/core/src/media-reuse";
import { generationRequestSchema } from "../packages/contracts/src/index";
import {
  validateWorkflow,
  validateReferences,
  createTemplate,
  importWorkflowJSON,
} from "../packages/core/src/workflow";
import { loadTaskMedia } from "../packages/core/src/task-media";
import { createRefreshLoop } from "../packages/core/src/refresh-loop";
import { workspaceRequest } from "../packages/core/src/workspace-client";
it("reports a readable network failure without masking aborts or server error codes", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  try {
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(workspaceRequest("/api/production")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "工作区请求未能完成，请检查网络连接后重试",
    });
    const aborted = new DOMException("cancelled", "AbortError");
    fetch.mockRejectedValueOnce(aborted);
    await expect(workspaceRequest("/api/production")).rejects.toBe(aborted);
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "FORBIDDEN", message: "无权访问" } }),
        { status: 403 },
      ),
    );
    await expect(workspaceRequest("/api/production")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "无权访问",
    });
  } finally {
    fetch.mockRestore();
  }
});
describe("result and asset reuse", () => {
  it("reports malformed workflow JSON in plain Chinese and creates a fresh ID on import", () => {
    expect(() => importWorkflowJSON("{broken")).toThrow("工作流 JSON 无法解析");
    const graph = createTemplate("image-video"),
      imported = importWorkflowJSON(JSON.stringify(graph));
    expect(imported.id).not.toBe(graph.id);
    expect(imported.nodes).toEqual(graph.nodes);
  });
  it("prefills existing IDs for image editing, image-to-video and voice without submitting", () => {
    for (const [kind, target] of [
      ["image", "image"],
      ["image", "video"],
      ["audio", "voice"],
    ] as const) {
      const asset = { id: crypto.randomUUID(), kind };
      const draft = mediaDraftRequest(asset, target);
      expect(draft.prompt).toBe("");
      expect(draft.assetIds).toEqual([asset.id]);
      expect(
        generationRequestSchema.safeParse({ ...draft, prompt: "验收文本" })
          .success,
      ).toBe(true);
    }
    expect(mediaReuseTargets({ kind: "video" })).toEqual([]);
    expect(() =>
      mediaDraftRequest({ id: crypto.randomUUID(), kind: "audio" }, "video"),
    ).toThrow("不支持");
  });
  it("creates a valid reference workflow and preserves the previous unsaved draft", () => {
    const asset = { id: crypto.randomUUID(), kind: "image" as const };
    const graph = workflowFromImage(asset);
    expect(validateWorkflow(graph).valid).toBe(true);
    expect(validateReferences(graph, [asset], [])).toEqual([]);
    expect(graph.nodes.some((n) => n.type === "generate.image")).toBe(false);
    const values = new Map([
      [workflowDraftKey, JSON.stringify(createTemplate("blank"))],
    ]);
    const before = values.get(workflowDraftKey);
    replaceWorkflowDraft(graph, {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    });
    expect(values.get(previousWorkflowDraftKey)).toBe(before);
    expect(JSON.parse(values.get(workflowDraftKey)!)).toEqual(graph);
  });
  it("loads references directly, de-duplicates voice recordings and distinguishes missing IDs", async () => {
    const id = crypto.randomUUID(),
      voiceId = crypto.randomUUID(),
      missing = crypto.randomUUID();
    const asset = {
      id,
      name: "archived.png",
      kind: "image" as const,
      mime: "image/png",
      bytes: 1,
      createdAt: new Date().toISOString(),
      blob: new Blob(),
    };
    const read = vi.fn(async (value: string) =>
      value === id ? asset : undefined,
    );
    const result = await loadTaskMedia(
      { assetIds: [id, missing], voiceIds: [voiceId] },
      {
        asset: read,
        voice: async () => ({
          id: voiceId,
          name: "reference",
          assetId: id,
          createdAt: asset.createdAt,
        }),
      },
    );
    expect(result.assets).toEqual([asset]);
    expect(result.missing).toEqual([missing]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
describe("polling lifecycle", () => {
  it("coalesces overlapping refreshes and never publishes after unmount", async () => {
    let release!: (value: number) => void;
    const load = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<number>((r) => {
            release = r;
          }),
      )
      .mockResolvedValue(2);
    const publish = vi.fn(),
      failure = vi.fn();
    const loop = createRefreshLoop(load, publish, failure);
    const first = loop.refresh();
    const second = loop.refresh();
    loop.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    release(1);
    await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    load.mockImplementationOnce(
      () =>
        new Promise<number>((r) => {
          release = r;
        }),
    );
    const pending = loop.refresh();
    loop.stop();
    release(3);
    await pending;
    expect(publish).toHaveBeenCalledTimes(2);
    expect(failure).not.toHaveBeenCalled();
  });
  it("recovers on the next refresh after a network error", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(7);
    const publish = vi.fn(),
      failure = vi.fn();
    const loop = createRefreshLoop(load, publish, failure);
    await loop.refresh();
    expect(failure).toHaveBeenCalledTimes(1);
    await loop.refresh();
    expect(publish).toHaveBeenCalledWith(7);
    loop.stop();
  });
});
