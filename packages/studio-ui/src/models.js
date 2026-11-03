import { modelCatalog } from "@aivideo/contracts";

// Platform-owned UI projection of the shared, versioned API capability catalog.
// A selectable form does not imply live provider availability.
const prompt = { type: "string", title: "提示词", name: "prompt" };
const image = {
  type: "string",
  field: "image",
  title: "参考图片",
  name: "image_url",
};
function projectModel(entry) {
  const { aspectRatios, durationSeconds } = entry.parameters;
  const needsImage = ["image_edit", "image_to_video"].includes(
    entry.capability,
  );
  const needsVoice = entry.capability === "voice_clone";
  return {
    id: entry.studioId,
    provider: entry.provider,
    provider_name: entry.provider === "agnes" ? "Agnes AI" : entry.provider === "fal" ? "fal" : "Replicate",
    name: entry.displayName,
    family: entry.family,
    pickerKey: entry.pickerKey,
    endpoint: entry.studioId,
    required: [
      "prompt",
      ...(needsImage ? ["image_url"] : []),
      ...(needsVoice ? ["audio_url"] : []),
    ],
    ...(needsImage ? { imageField: "image_url", maxImages: 1 } : {}),
    inputs: {
      prompt: needsVoice ? { ...prompt, title: "要生成的文本" } : prompt,
      ...(needsImage ? { image_url: image } : {}),
      ...(needsVoice
        ? {
            audio_url: {
              type: "string",
              field: "audio",
              title: "参考声音",
              name: "audio_url",
            },
          }
        : {}),
      ...(aspectRatios.length
        ? {
            aspect_ratio: {
              type: "string",
              enum: [...aspectRatios],
              default: aspectRatios[0],
              title: "画面比例",
            },
          }
        : {}),
      ...(durationSeconds.length
        ? {
            duration: {
              type: "string",
              enum: durationSeconds.map(String),
              default: String(durationSeconds[0]),
              title: "时长",
            },
          }
        : {}),
    },
  };
}
const modelsFor = (capability) =>
  modelCatalog
    .filter((entry) => entry.capability === capability)
    .map(projectModel);
export const t2iModels = modelsFor("text_to_image");
export const i2iModels = modelsFor("image_edit");
export const t2vModels = modelsFor("text_to_video");
export const i2vModels = modelsFor("image_to_video");
export const v2vModels = [];
export const audioModels = modelsFor("voice_clone");
export const getModelById = (id) => t2iModels.find((m) => m.id === id);
export const getI2IModelById = (id) => i2iModels.find((m) => m.id === id);
export const getVideoModelById = (id) => t2vModels.find((m) => m.id === id);
export const getI2VModelById = (id) => i2vModels.find((m) => m.id === id);
export const getV2VModelById = () => undefined;
export const getAudioModelById = (id) => audioModels.find((m) => m.id === id);
const ratiosFor = (model) => model?.inputs.aspect_ratio?.enum || [];
const durationsFor = (model) => model?.inputs.duration?.enum || [];
export const getAspectRatiosForModel = (id) => ratiosFor(getModelById(id));
export const getSelectableAspectRatiosForModel = getAspectRatiosForModel;
export const getAspectRatiosForI2IModel = (id) =>
  ratiosFor(getI2IModelById(id));
export const getSelectableAspectRatiosForI2IModel = getAspectRatiosForI2IModel;
export const getAspectRatiosForVideoModel = (id) =>
  ratiosFor(getVideoModelById(id));
export const getAspectRatiosForI2VModel = (id) =>
  ratiosFor(getI2VModelById(id));
export const getDurationsForModel = (id) => durationsFor(getVideoModelById(id));
export const getDurationsForI2VModel = (id) =>
  durationsFor(getI2VModelById(id));
export const getResolutionsForModel = () => [];
export const getResolutionsForI2IModel = getResolutionsForModel;
export const getResolutionsForVideoModel = getResolutionsForModel;
export const getResolutionsForI2VModel = getResolutionsForModel;
export const getQualityFieldForModel = () => null;
export const getQualityFieldForI2IModel = getQualityFieldForModel;
export const getEffectsForI2IModel = () => [];
export const getEffectsForI2VModel = getEffectsForI2IModel;
export const getDefaultEffectForI2IModel = () => "";
export const getDefaultEffectForI2VModel = getDefaultEffectForI2IModel;
export const getMaxImagesForI2IModel = () => 1;
export const getMaxImagesForI2VModel = () => 1;
