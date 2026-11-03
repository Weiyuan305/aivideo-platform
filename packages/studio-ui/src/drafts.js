import { modelCatalog } from "@aivideo/contracts";
import { getLocal, assetReference } from "@aivideo/core/local";
import { scopedPersistKey } from "./persistKey.js";
export async function restoreStudioRequest(request) {
  const model = modelCatalog.find((m) => m.key === request.modelKey);
  if (!model) throw new Error("模型不在当前目录中");
  const voice = request.voiceId && (await getLocal("voices", request.voiceId));
  if (request.voiceId && !voice)
    throw new Error("引用声音已不存在，请重新选择");
  const assetId = request.assetIds[0] || voice?.assetId;
  if (assetId && !(await getLocal("assets", assetId)))
    throw new Error("引用素材已不存在，请重新上传");
  const refs = assetId ? [assetReference(assetId)] : [];
  const state =
    model.kind === "voice"
      ? {
          selectedModelId: model.studioId,
          params: {
            prompt: request.prompt,
            ...(refs[0] ? { audio_url: refs[0] } : {}),
          },
          internalHistory: [],
        }
      : {
          prompt: request.prompt,
          selectedFamilyId: model.family,
          imageMode: ["image_edit", "image_to_video"].includes(
            model.capability,
          ),
          selectedAr:
            request.parameters.aspectRatio ?? model.parameters.aspectRatios[0],
          uploadedImageUrls: refs,
          localHistory: [],
          ...(model.kind === "video"
            ? {
                selectedModel: model.studioId,
                selectedDuration: String(
                  request.parameters.durationSeconds ??
                    model.parameters.durationSeconds[0],
                ),
                v2vMode: false,
              }
            : { selectedModelId: model.studioId, batchSize: 1 }),
        };
  const base =
    model.kind === "voice"
      ? "hg_audio_studio_persistent"
      : model.kind === "video"
        ? "hg_video_studio_persistent"
        : "hg_image_studio_persistent";
  localStorage.setItem(scopedPersistKey(base), JSON.stringify(state));
  return `/studio/${model.kind}`;
}
