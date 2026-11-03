import { describe, expect, it } from "vitest";
import {
  generationRequestSchema,
  modelCatalog,
  workflowSchema,
} from "../packages/contracts/src/index";
import {
  createTemplate,
  validateWorkflow,
  validateReferences,
} from "../packages/core/src/workflow";
import {
  getConfiguration,
  getModelReadiness,
} from "../packages/providers/src/index";
import { validateFile } from "../packages/core/src/local";

describe("generation contract", () => {
  it("rejects unknown provider paths and extra parameters", () => {
    expect(
      generationRequestSchema.safeParse({
        modelKey: "arbitrary-provider",
        prompt: "hello",
      }).success,
    ).toBe(false);
    expect(
      generationRequestSchema.safeParse({
        modelKey: modelCatalog[0].key,
        prompt: "hello",
        parameters: { endpoint: "https://example.com" },
      }).success,
    ).toBe(false);
  });
  it("requires references for image editing, image to video and voice cloning", () => {
    for (const model of modelCatalog.filter((m) =>
      ["image_edit", "image_to_video", "voice_clone"].includes(m.capability),
    ))
      expect(
        generationRequestSchema.safeParse({
          modelKey: model.key,
          prompt: "hello",
        }).success,
      ).toBe(false);
  });
  it("accepts a bounded voice request and rejects oversized text", () => {
    const request = {
      modelKey: "voice.indextts2.clone.v1",
      prompt: "欢迎",
      voiceId: crypto.randomUUID(),
    };
    expect(generationRequestSchema.safeParse(request).success).toBe(true);
    expect(
      generationRequestSchema.safeParse({ ...request, prompt: "a".repeat(501) })
        .success,
    ).toBe(false);
  });
});
describe("portable workflow and local references", () => {
  it("validates the image-video template with deterministic dependency order", () => {
    expect(validateWorkflow(createTemplate("image-video"))).toEqual({
      valid: true,
      errors: [],
      order: ["prompt", "image", "video"],
    });
  });
  it("rejects cycles, missing nodes, duplicate input and incompatible ports", () => {
    const graph = createTemplate("image-video");
    graph.edges.push({
      id: "loop",
      source: "video",
      target: "image",
      sourceHandle: "video",
      targetHandle: "prompt",
    });
    const result = validateWorkflow(graph);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("循环");
    expect(result.errors.join(" ")).toContain("类型不匹配");
    expect(result.errors.join(" ")).toContain("只能连接一个");
    graph.edges.push({
      id: "ghost",
      source: "missing",
      target: "video",
      sourceHandle: "image",
      targetHandle: "image",
    });
    expect(validateWorkflow(graph).errors.join(" ")).toContain("不存在");
  });
  it("requires image-edit input and a selected voice", () => {
    const graph = createTemplate("image-video");
    graph.nodes[1].data.modelKey = "image.flux2.edit.v1";
    expect(validateWorkflow(graph).errors.join(" ")).toContain(
      "图片编辑需要图片连线",
    );
    expect(
      validateWorkflow(createTemplate("voice")).errors.join(" "),
    ).toContain("请选择声音");
  });
  it("rejects missing local voice references after importing a portable graph", () => {
    const graph = createTemplate("voice"),
      id = crypto.randomUUID(),
      assetId = crypto.randomUUID();
    graph.nodes[0].data.voiceId = id;
    expect(validateWorkflow(graph).valid).toBe(true);
    expect(validateReferences(graph, [], [])).toHaveLength(1);
    expect(
      validateReferences(
        graph,
        [{ id: assetId, kind: "audio" }],
        [{ id, assetId }],
      ),
    ).toEqual([]);
  });
  it("rejects unknown node types and unbounded graph size", () => {
    const graph = createTemplate("image-video");
    expect(
      workflowSchema.safeParse({
        ...graph,
        nodes: [{ ...graph.nodes[0], type: "exec.shell" }],
      }).success,
    ).toBe(false);
    expect(
      workflowSchema.safeParse({
        ...graph,
        nodes: Array(21).fill(graph.nodes[0]),
      }).success,
    ).toBe(false);
  });
});
describe("configuration and files", () => {
  it("never serializes secret values or enables generation implicitly", () => {
    const env = {
      FAL_KEY: "sentinel-fal-secret",
      REPLICATE_API_TOKEN: "sentinel-replicate-secret",
      REPLICATE_INDEXTTS_VERSION: "version",
      UNRELATED_SECRET: "hidden",
    };
    const result = getConfiguration(env);
    expect(result.services.find((s) => s.id === "fal")?.configured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("sentinel");
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(result.generationEnabled).toBe(false);
    expect(getModelReadiness(modelCatalog[0].key, env).ready).toBe(false);
  });
  it("rejects empty or unsupported files before persistence", () => {
    expect(() =>
      validateFile(new File([], "empty.png", { type: "image/png" })),
    ).toThrow("不能为空");
    expect(() =>
      validateFile(
        new File(["<script>"], "unsafe.svg", { type: "image/svg+xml" }),
      ),
    ).toThrow("支持");
    expect(
      validateFile(new File(["data"], "sample.wav", { type: "audio/wav" })),
    ).toBe("audio");
  });
});
