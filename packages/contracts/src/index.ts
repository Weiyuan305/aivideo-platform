import { z } from "zod";
export * from "./lists";
export * from "./health";

export type MediaKind = "image" | "video" | "voice";
// Deliberately exposes a small, verified parameter subset for the first release.
// Live execution is enabled per provider, never by catalog presence alone.
const imageParameters = {
  aspectRatios: ["1:1", "16:9", "9:16"],
  durationSeconds: [],
} as const;
const klingTextParameters = {
  aspectRatios: ["16:9", "9:16", "1:1"],
  durationSeconds: [5],
} as const;
const seedanceParameters = {
  aspectRatios: ["16:9", "9:16", "1:1"],
  durationSeconds: [5, 10, 15],
} as const;
const hailuoParameters = {
  aspectRatios: [],
  durationSeconds: [6, 10],
} as const;
export const modelCatalog = [
  {
    key: "image.agnes-2.5.t2i.v1",
    studioId: "agnes-image-2.5-t2i",
    name: "Agnes Image 2.5 Flash · 文生图",
    displayName: "Agnes Image 2.5 Flash",
    family: "agnes-image-2.5",
    pickerKey: "agnes-image-2.5",
    parameters: imageParameters,
    kind: "image",
    capability: "text_to_image",
    provider: "agnes",
    endpoint: "agnes-image-2.5-flash",
    requiredEnv: ["AGNES_API_KEY"],
  },
  {
    key: "image.agnes-2.5.edit.v1",
    studioId: "agnes-image-2.5-edit",
    name: "Agnes Image 2.5 Flash · 图片编辑",
    displayName: "Agnes Image 2.5 Flash",
    family: "agnes-image-2.5",
    pickerKey: "agnes-image-2.5",
    parameters: imageParameters,
    kind: "image",
    capability: "image_edit",
    provider: "agnes",
    endpoint: "agnes-image-2.5-flash",
    requiredEnv: ["AGNES_API_KEY"],
  },
  {
    key: "video.agnes-2.5.t2v.v1",
    studioId: "agnes-video-2.5-t2v",
    name: "Agnes Video 2.5 Flash · 文生视频",
    displayName: "Agnes Video 2.5 Flash",
    family: "agnes-video-2.5",
    pickerKey: "agnes-video-2.5",
    parameters: {
      aspectRatios: ["16:9", "9:16", "1:1"],
      durationSeconds: [4, 5, 6, 8, 10, 12],
    },
    kind: "video",
    capability: "text_to_video",
    provider: "agnes",
    endpoint: "agnes-video-2.5-flash",
    requiredEnv: ["AGNES_API_KEY"],
  },
  {
    key: "video.agnes-2.5.i2v.v1",
    studioId: "agnes-video-2.5-i2v",
    name: "Agnes Video 2.5 Flash · 图生视频",
    displayName: "Agnes Video 2.5 Flash",
    family: "agnes-video-2.5",
    pickerKey: "agnes-video-2.5",
    parameters: {
      aspectRatios: ["16:9", "9:16", "1:1"],
      durationSeconds: [4, 5, 6, 8, 10, 12],
    },
    kind: "video",
    capability: "image_to_video",
    provider: "agnes",
    endpoint: "agnes-video-2.5-flash",
    requiredEnv: ["AGNES_API_KEY"],
  },
  {
    key: "image.flux2.t2i.v1",
    studioId: "flux-2-dev",
    name: "FLUX.2 · 文生图",
    displayName: "FLUX.2",
    family: "flux-2-dev",
    pickerKey: "flux-2-dev",
    parameters: imageParameters,
    kind: "image",
    capability: "text_to_image",
    provider: "fal",
    endpoint: "fal-ai/flux-2",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "image.flux2.edit.v1",
    studioId: "flux-2-dev-edit",
    name: "FLUX.2 · 图片编辑",
    displayName: "FLUX.2",
    family: "flux-2-dev",
    pickerKey: "flux-2-dev",
    parameters: imageParameters,
    kind: "image",
    capability: "image_edit",
    provider: "fal",
    endpoint: "fal-ai/flux-2/edit",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "video.kling-o3.t2v.v1",
    studioId: "platform-kling-t2v",
    name: "Kling O3 · 文生视频",
    displayName: "Kling O3",
    family: "platform-kling",
    pickerKey: "kling-o3-standard",
    parameters: klingTextParameters,
    kind: "video",
    capability: "text_to_video",
    provider: "fal",
    endpoint: "fal-ai/kling-video/o3/standard/text-to-video",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "video.kling-o3.i2v.v1",
    studioId: "platform-kling-i2v",
    name: "Kling O3 · 图生视频",
    displayName: "Kling O3",
    family: "platform-kling",
    pickerKey: "kling-o3-standard",
    parameters: { aspectRatios: [], durationSeconds: [5] },
    kind: "video",
    capability: "image_to_video",
    provider: "fal",
    endpoint: "fal-ai/kling-video/o3/standard/image-to-video",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "image.nano-banana-2.t2i.v1",
    studioId: "nano-banana-2",
    name: "Nano Banana 2 · 文生图",
    displayName: "Nano Banana 2",
    family: "nano-banana-2",
    pickerKey: "nano-banana-2",
    parameters: imageParameters,
    kind: "image",
    capability: "text_to_image",
    provider: "fal",
    endpoint: "fal-ai/nano-banana-2",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "image.nano-banana-2.edit.v1",
    studioId: "nano-banana-2-edit",
    name: "Nano Banana 2 · 图片编辑",
    displayName: "Nano Banana 2",
    family: "nano-banana-2",
    pickerKey: "nano-banana-2",
    parameters: imageParameters,
    kind: "image",
    capability: "image_edit",
    provider: "fal",
    endpoint: "fal-ai/nano-banana-2/edit",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "image.nano-banana-pro.t2i.v1",
    studioId: "nano-banana-pro",
    name: "Nano Banana Pro · 文生图",
    displayName: "Nano Banana Pro",
    family: "nano-banana-pro",
    pickerKey: "nano-banana-pro",
    parameters: imageParameters,
    kind: "image",
    capability: "text_to_image",
    provider: "fal",
    endpoint: "fal-ai/nano-banana-pro",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "image.nano-banana-pro.edit.v1",
    studioId: "nano-banana-pro-edit",
    name: "Nano Banana Pro · 图片编辑",
    displayName: "Nano Banana Pro",
    family: "nano-banana-pro",
    pickerKey: "nano-banana-pro",
    parameters: imageParameters,
    kind: "image",
    capability: "image_edit",
    provider: "fal",
    endpoint: "fal-ai/nano-banana-pro/edit",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "video.seedance-2.t2v.v1",
    studioId: "platform-seedance-2-t2v",
    name: "Seedance 2.0 · 文生视频",
    displayName: "Seedance 2.0",
    family: "platform-seedance-2",
    pickerKey: "seedance-2-standard",
    parameters: seedanceParameters,
    kind: "video",
    capability: "text_to_video",
    provider: "fal",
    endpoint: "bytedance/seedance-2.0/text-to-video",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "video.seedance-2.i2v.v1",
    studioId: "platform-seedance-2-i2v",
    name: "Seedance 2.0 · 图生视频",
    displayName: "Seedance 2.0",
    family: "platform-seedance-2",
    pickerKey: "seedance-2-standard",
    parameters: seedanceParameters,
    kind: "video",
    capability: "image_to_video",
    provider: "fal",
    endpoint: "bytedance/seedance-2.0/image-to-video",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "video.hailuo-2.3.t2v.v1",
    studioId: "platform-hailuo-2.3-t2v",
    name: "MiniMax Hailuo 2.3 · 文生视频",
    displayName: "MiniMax Hailuo 2.3",
    family: "platform-hailuo-2.3",
    pickerKey: "hailuo-2.3-standard",
    parameters: hailuoParameters,
    kind: "video",
    capability: "text_to_video",
    provider: "fal",
    endpoint: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "video.hailuo-2.3.i2v.v1",
    studioId: "platform-hailuo-2.3-i2v",
    name: "MiniMax Hailuo 2.3 · 图生视频",
    displayName: "MiniMax Hailuo 2.3",
    family: "platform-hailuo-2.3",
    pickerKey: "hailuo-2.3-standard",
    parameters: hailuoParameters,
    kind: "video",
    capability: "image_to_video",
    provider: "fal",
    endpoint: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
    requiredEnv: ["FAL_KEY"],
  },
  {
    key: "voice.indextts2.clone.v1",
    studioId: "platform-indextts2",
    name: "IndexTTS 2 · 参考声音克隆",
    displayName: "IndexTTS 2 · 声音克隆",
    family: "platform-indextts2",
    pickerKey: "indextts2",
    parameters: { aspectRatios: [], durationSeconds: [] },
    kind: "voice",
    capability: "voice_clone",
    provider: "replicate",
    endpoint: "lucataco/indextts-2",
    requiredEnv: ["REPLICATE_API_TOKEN", "REPLICATE_INDEXTTS_VERSION"],
  },
] as const;
export type ModelKey = (typeof modelCatalog)[number]["key"];
export type ModelEntry = (typeof modelCatalog)[number];
export const modelKeys = modelCatalog.map((x) => x.key) as [
  ModelKey,
  ...ModelKey[],
];
export const generationParametersSchema = z
  .object({
    aspectRatio: z.enum(["1:1", "16:9", "9:16"]).optional(),
    durationSeconds: z.number().int().min(1).max(15).optional(),
    seed: z.number().int().min(0).max(4294967295).optional(),
  })
  .strict();
export const generationRequestSchema = z
  .object({
    modelKey: z.enum(modelKeys),
    prompt: z.string().trim().max(4000).default(""),
    assetIds: z.array(z.string().uuid()).max(1).default([]),
    voiceId: z.string().uuid().optional(),
    parameters: generationParametersSchema.default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    const model = modelCatalog.find((m) => m.key === value.modelKey)!;
    const allowedRatios: readonly string[] = model.parameters.aspectRatios;
    const allowedDurations: readonly number[] =
      model.parameters.durationSeconds;
    if (
      value.parameters.aspectRatio !== undefined &&
      !allowedRatios.includes(value.parameters.aspectRatio)
    )
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "aspectRatio"],
        message: "此模型不支持所选画面比例",
      });
    if (
      value.parameters.durationSeconds !== undefined &&
      !allowedDurations.includes(value.parameters.durationSeconds)
    )
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "durationSeconds"],
        message: "此模型不支持所选视频时长",
      });
    if (!value.prompt)
      ctx.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "请输入提示词或要生成的文本",
      });
    if (
      ["image_edit", "image_to_video"].includes(model.capability) &&
      value.assetIds.length !== 1
    )
      ctx.addIssue({
        code: "custom",
        path: ["assetIds"],
        message: "请选择一张参考图片",
      });
    if (model.kind === "voice" && !value.voiceId && value.assetIds.length !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["voiceId"],
        message: "请选择声音或上传参考录音",
      });
    if (model.kind === "voice" && value.prompt.length > 500)
      ctx.addIssue({
        code: "custom",
        path: ["prompt"],
        message: "首期文本限制为 500 字符",
      });
  });
export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export interface LocalAsset {
  id: string;
  name: string;
  kind: "image" | "video" | "audio";
  mime: string;
  bytes: number;
  createdAt: string;
  blob: Blob;
  url?: string;
  sourceJobId?: string | null;
  sourceJobAvailable?: boolean;
}
export interface LocalVoice {
  id: string;
  name: string;
  assetId: string;
  createdAt: string;
}
export const voiceRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  assetId: z.string().uuid(),
  createdAt: z.string().datetime().optional(),
});
export type NodeType =
  | "input.text"
  | "input.asset"
  | "input.voice"
  | "generate.image"
  | "generate.video"
  | "generate.voice";
export const workflowNodeSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum([
      "input.text",
      "input.asset",
      "input.voice",
      "generate.image",
      "generate.video",
      "generate.voice",
    ]),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    data: z
      .object({
        label: z.string().max(100),
        text: z.string().max(4000).default(""),
        assetId: z.string().uuid().optional(),
        voiceId: z.string().uuid().optional(),
        modelKey: z.enum(modelKeys).optional(),
        parameters: generationParametersSchema.optional(),
      })
      .strict(),
  })
  .strict();
export const workflowSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    nodes: z.array(workflowNodeSchema).max(20),
    edges: z
      .array(
        z
          .object({
            id: z.string().min(1),
            source: z.string(),
            target: z.string(),
            sourceHandle: z.string(),
            targetHandle: z.string(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type WorkflowGraph = z.infer<typeof workflowSchema>;
export interface LocalWorkflow {
  id: string;
  name: string;
  graph: WorkflowGraph;
  updatedAt: string;
  version: number;
  history?: { version: number; graph: WorkflowGraph; savedAt: string }[];
}
export interface ProviderConfiguration {
  id: string;
  name: string;
  configured: boolean;
  required: string[];
  missing: string[];
}
export interface ConfigurationStatus {
  mode: "local-workspace";
  workspaceBackend?: "server" | "browser";
  generationEnabled: boolean;
  enabledModelKeys?: string[];
  services: ProviderConfiguration[];
}
export * from "./tasks";
export * from "./operations";

export * from "./production";

export * from "./timeline";
