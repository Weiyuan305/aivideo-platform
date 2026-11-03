import { describe, it, expect, vi } from "vitest";
import {
  AgnesProvider,
  agnesConfigured,
  publicMediaURL,
} from "../packages/server/src/agnes";
import {
  ProviderRejected,
  type StoredAsset,
} from "../packages/server/src/types";
import type { ObjectStorage } from "../packages/server/src/storage";
import {
  getConfiguration,
  getModelReadiness,
} from "../packages/providers/src/index";
import { generationRequestSchema } from "../packages/contracts/src/index";

const asset: StoredAsset = {
  id: crypto.randomUUID(),
  ownerId: "owner",
  objectKey: "inputs/test",
  name: "test.png",
  kind: "image",
  mime: "image/png",
  bytes: 3,
  sha256: "test",
  createdAt: new Date().toISOString(),
  sourceJobAvailable: true,
};
function setup(replies: (Response | Error)[] = []) {
  const fetcher = vi.fn(async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    if (!reply) throw new Error("unexpected request");
    return reply;
  });
  const storage = {
    read: async () => ({ bytes: new Uint8Array([1, 2, 3]) }),
  } as ObjectStorage;
  const provider = new AgnesProvider({
    key: "unit-secret",
    storage,
    referenceURL: async () => "https://media.example/test.png",
    fetch: fetcher,
    validateURL: async (url) => url,
  });
  return { provider, fetcher, storage };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
describe("Agnes provider boundary", () => {
  it("enables only Agnes in server mode, never exposes secrets or enables paid/reserved models", () => {
    const env = {
      AGNES_API_KEY: "unit-secret",
      WORKSPACE_BACKEND: "server",
      FAL_KEY: "other-secret",
    };
    const config = getConfiguration(env);
    expect(config.enabledModelKeys).toHaveLength(4);
    expect(JSON.stringify(config)).not.toContain("unit-secret");
    expect(getModelReadiness("video.kling-o3.t2v.v1", env).ready).toBe(false);
    expect(
      getConfiguration({ ...env, WORKSPACE_BACKEND: "browser" })
        .generationEnabled,
    ).toBe(false);
    expect(
      agnesConfigured({ ...env, AGNES_BASE_URL: "https://other.example/v1" }),
    ).toBe(false);
  });
  it("returns synchronous image artifacts for durable persistence and uses extra_body for references", async () => {
    const { provider, fetcher } = setup([
      json({ data: [{ url: "https://media.example/result.png" }] }),
    ]);
    const result = await provider.submit(
      generationRequestSchema.parse({
        modelKey: "image.agnes-2.5.edit.v1",
        prompt: "blue cup",
        assetIds: [asset.id],
        parameters: { aspectRatio: "16:9" },
      }),
      "operation",
      [asset],
    );
    expect(result.outputs?.[0]).toMatchObject({
      kind: "image",
      mime: "image/png",
    });
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(call[1].body));
    expect(payload).toMatchObject({
      model: "agnes-image-2.5-flash",
      size: "1K",
      ratio: "16:9",
      extra_body: {
        response_format: "url",
        image: ["data:image/png;base64,AQID"],
      },
    });
    expect(payload).not.toHaveProperty("response_format");
  });
  it("polls by video_id and model_name, uses public status despite stale internal status", async () => {
    const { provider, fetcher } = setup([
      json({ id: "task-id", task_id: "task-id", video_id: "video-id" }),
      json({
        status: "completed",
        internal_status: "pending",
        url: "https://media.example/clip.mp4",
      }),
    ]);
    const result = await provider.submit(
      generationRequestSchema.parse({
        modelKey: "video.agnes-2.5.i2v.v1",
        prompt: "slow camera",
        assetIds: [asset.id],
        parameters: { durationSeconds: 4, aspectRatio: "9:16" },
      }),
      "op",
      [asset],
    );
    expect(result.requestId).toBe("video-id");
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({
      model: "agnes-video-2.5-flash",
      mode: "keyframe",
      size: "720P",
      seconds: "4",
      first_frame: "https://media.example/test.png",
    });
    expect((await provider.poll(result.requestId)).status).toBe("succeeded");
    expect((fetcher.mock.calls[1] as unknown as [string])[0]).toContain(
      "video_id=video-id&model_name=agnes-video-2.5-flash",
    );
  });
  it("never substitutes task_id for a missing video_id or resubmits ambiguous failures", async () => {
    const { provider, fetcher } = setup([json({ task_id: "wrong-id" })]);
    await expect(
      provider.submit(
        generationRequestSchema.parse({
          modelKey: "video.agnes-2.5.t2v.v1",
          prompt: "sea",
        }),
        "op",
        [],
      ),
    ).rejects.toThrow("video_id");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("distinguishes definitive rejection from uncertain transport/server errors without leaking provider payload", async () => {
    for (const status of [401, 402, 403, 422, 429, 500, 502]) {
      const { provider, fetcher } = setup([
        json({ detail: "unit-secret sensitive raw text" }, status),
      ]);
      const error = await provider
        .submit(
          generationRequestSchema.parse({
            modelKey: "image.agnes-2.5.t2i.v1",
            prompt: "test",
          }),
          "op",
          [],
        )
        .catch((e) => e);
      expect(error instanceof ProviderRejected).toBe(status < 500);
      expect(error.message).not.toContain("unit-secret");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("does not submit local-only video references or unimplemented providers", async () => {
    const { storage, fetcher } = setup();
    const provider = new AgnesProvider({
      key: "test",
      storage,
      referenceURL: async () => undefined,
      fetch: fetcher,
    });
    await expect(
      provider.submit(
        generationRequestSchema.parse({
          modelKey: "video.agnes-2.5.i2v.v1",
          prompt: "test",
          assetIds: [asset.id],
        }),
        "op",
        [asset],
      ),
    ).rejects.toMatchObject({ code: "PUBLIC_REFERENCE_REQUIRED" });
    await expect(
      provider.submit(
        generationRequestSchema.parse({
          modelKey: "image.flux2.t2i.v1",
          prompt: "test",
        }),
        "op",
        [],
      ),
    ).rejects.toMatchObject({ code: "GENERATION_NOT_ENABLED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("recognizes explicit queue-full rejection without treating arbitrary 503 as safe to retry", async () => {
    const { provider } = setup([
      json({ code: "video_queue_full", message: "private request id" }, 503),
    ]);
    await expect(
      provider.submit(
        generationRequestSchema.parse({
          modelKey: "video.agnes-2.5.t2v.v1",
          prompt: "test",
        }),
        "op",
        [],
      ),
    ).rejects.toMatchObject({ code: "AGNES_QUEUE_FULL" });
    const { provider: unavailable } = setup([
      json({ message: "unavailable" }, 503),
    ]);
    const error = await unavailable
      .submit(
        generationRequestSchema.parse({
          modelKey: "video.agnes-2.5.t2v.v1",
          prompt: "test",
        }),
        "op",
        [],
      )
      .catch((e) => e);
    expect(error).not.toBeInstanceOf(ProviderRejected);
    expect(error.code).toBe("AGNES_HTTP_503");
    const { provider: imageBusy } = setup([
      json(
        {
          error: {
            message:
              "image queue is full, please retry later (request id: private)",
          },
        },
        503,
      ),
    ]);
    await expect(
      imageBusy.submit(
        generationRequestSchema.parse({
          modelKey: "image.agnes-2.5.edit.v1",
          prompt: "test",
          assetIds: [asset.id],
        }),
        "op",
        [asset],
      ),
    ).rejects.toMatchObject({ code: "AGNES_QUEUE_FULL" });
  });
  it("downloads media without Authorization and rejects unsafe media URL forms", async () => {
    const { provider, fetcher } = setup([new Response(new Uint8Array([1, 2]))]);
    const source = await provider.openOutput({
      key: "x",
      name: "x.png",
      mime: "image/png",
      kind: "image",
      url: "https://media.example/image.png",
    });
    for await (const _ of source) {
      /* Consume archive stream. */
    }
    const call = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[1].headers).toBeUndefined();
    expect(call[1].redirect).toBe("error");
    for (const url of [
      "http://127.0.0.1/a",
      "https://127.0.0.1/a",
      "https://[::1]/a",
      "https://u:p@example.com/a",
    ]) {
      await expect(publicMediaURL(url)).rejects.toThrow();
    }
  });
});
