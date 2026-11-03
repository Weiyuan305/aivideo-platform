import { modelCatalog } from "@aivideo/contracts";
import { submitGenerationTask } from "@aivideo/core/task-client";
import {
  saveFile,
  getLocal,
  assetReference,
  referenceID,
} from "@aivideo/core/local";

export async function uploadFile(_unused, file, onProgress) {
  if (file.localAssetId) {
    const existing = await getLocal("assets", file.localAssetId);
    if (existing) {
      onProgress?.(100);
      return assetReference(existing.id);
    }
  }
  const named =
    file instanceof File
      ? file
      : new File([file], "参考素材.png", { type: file.type || "image/png" });
  const asset = await saveFile(named);
  onProgress?.(100);
  return assetReference(asset.id);
}
export function buildGenerationInput(params, kind) {
  const id = params.model || params._modelId;
  const model = modelCatalog.find((m) => m.studioId === id);
  if (!model) throw new Error("此模型未登记，请选择平台提供的模型");
  const reference =
    params.image_url || params.images_list?.[0] || params.audio_url;
  const assetId = referenceID(reference);
  const input = {
    modelKey: model.key,
    prompt: params.prompt || "",
    assetIds: assetId ? [assetId] : [],
    parameters: {},
  };
  if (
    kind !== "voice" &&
    model.parameters.aspectRatios.length > 0 &&
    params.aspect_ratio
  )
    input.parameters.aspectRatio = params.aspect_ratio;
  if (kind === "video")
    input.parameters.durationSeconds = Number(
      params.duration ?? model.parameters.durationSeconds[0],
    );
  return input;
}
async function requestGeneration(params, kind) {
  const task = await submitGenerationTask(buildGenerationInput(params, kind));
  if(task.backend === "server")return {pending:true,taskId:task.id};
  const error = new Error(
    `${task.error?.message || "生成执行尚未接通"} 已保存到任务中心。`,
  );
  error.code = task.error?.code || "GENERATION_NOT_ENABLED";
  error.taskId = task.id;
  throw error;
}
export const generateImage = (_unused, params) =>
  requestGeneration(params, "image");
export const generateI2I = generateImage;
export const generateVideo = (_unused, params) =>
  requestGeneration(params, "video");
export const generateI2V = generateVideo;
export const generateAudio = (_unused, params) =>
  requestGeneration(params, "voice");
export async function processV2V() {
  throw new Error("首期尚未开放视频转视频");
}
