import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generationRequestSchema,
  modelCatalog,
} from "../packages/contracts/src/index";
import {
  t2iModels,
  i2iModels,
  t2vModels,
  i2vModels,
  audioModels,
} from "../packages/studio-ui/src/models.js";
import { buildGenerationInput } from "../packages/studio-ui/src/platform-client.js";
import { probeGeneration } from "../packages/core/src/task-client";
import {
  videoModelCatalog,
  imageModelCatalog,
} from "../packages/studio-ui/src/modelFamilies.js";

afterEach(() => vi.unstubAllGlobals());

describe("mainstream model registration", () => {
  it("keeps text/reference modes in the same picker family", () => {
    for (const [catalog, pairs] of [
      [
        imageModelCatalog,
        [
          ["nano-banana-2", "nano-banana-2-edit"],
          ["nano-banana-pro", "nano-banana-pro-edit"],
        ],
      ],
      [
        videoModelCatalog,
        [
          ["platform-seedance-2-t2v", "platform-seedance-2-i2v"],
          ["platform-hailuo-2.3-t2v", "platform-hailuo-2.3-i2v"],
        ],
      ],
    ] as const) {
      for (const [text, reference] of pairs) {
        const a = catalog.variantById.get(text);
        const b = catalog.variantById.get(reference);
        expect(a).toBeDefined();
        expect(b).toBeDefined();
        expect(a.familyId).toBe(b.familyId);
      }
    }
    const forms = [
      ...t2iModels,
      ...i2iModels,
      ...t2vModels,
      ...i2vModels,
      ...audioModels,
    ];
    expect(new Set(forms.map((m) => m.id))).toEqual(
      new Set(modelCatalog.map((m) => m.studioId)),
    );
  });

  it("validates each video model's duration and rejects parameters from another model", () => {
    for (const [key, allowed, rejected] of [
      ["video.seedance-2.t2v.v1", [5, 10, 15], [6, 16]],
      ["video.hailuo-2.3.t2v.v1", [6, 10], [5, 15]],
      ["video.kling-o3.t2v.v1", [5], [6, 10]],
    ] as const) {
      for (const durationSeconds of allowed)
        expect(
          generationRequestSchema.safeParse({
            modelKey: key,
            prompt: "海浪",
            parameters: { durationSeconds },
          }).success,
        ).toBe(true);
      for (const durationSeconds of rejected)
        expect(
          generationRequestSchema.safeParse({
            modelKey: key,
            prompt: "海浪",
            parameters: { durationSeconds },
          }).success,
        ).toBe(false);
    }
    expect(
      generationRequestSchema.safeParse({
        modelKey: "video.hailuo-2.3.t2v.v1",
        prompt: "海浪",
        parameters: { aspectRatio: "16:9" },
      }).success,
    ).toBe(false);
    expect(
      generationRequestSchema.safeParse({
        modelKey: "image.nano-banana-2.t2i.v1",
        prompt: "海浪",
        parameters: { durationSeconds: 5 },
      }).success,
    ).toBe(false);
  });

  it("preserves selected duration in the local job request and omits inapplicable aspect ratio", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "PROVIDER_NOT_CONFIGURED", message: "尚未配置" },
          }),
          { status: 503 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    for (const [model, duration, key, ratio] of [
      ["platform-seedance-2-t2v", "15", "video.seedance-2.t2v.v1", "16:9"],
      ["platform-hailuo-2.3-t2v", "10", "video.hailuo-2.3.t2v.v1", undefined],
    ] as const) {
      const input = buildGenerationInput(
        { model, duration, prompt: "海浪", aspect_ratio: "16:9" },
        "video",
      );
      expect(await probeGeneration(input, "test-key")).toMatchObject({
        status: "blocked",
        error: { code: "PROVIDER_NOT_CONFIGURED" },
      });
      const [url, request] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe("/api/jobs");
      const payload = JSON.parse(request.body);
      expect(payload.modelKey).toBe(key);
      expect(payload.parameters.durationSeconds).toBe(Number(duration));
      expect(payload.parameters.aspectRatio).toBe(ratio);
      expect(generationRequestSchema.safeParse(payload).success).toBe(true);
    }
  });
});
