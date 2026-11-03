import {
  modelCatalog,
  workflowSchema,
  type GenerationRequest,
  type LocalAsset,
  type WorkflowGraph,
} from "@aivideo/contracts";
import { createTemplate } from "./workflow";
export type ReuseTarget = "image" | "video" | "voice";
export function mediaReuseTargets(
  asset: Pick<LocalAsset, "kind">,
): ReuseTarget[] {
  return asset.kind === "image"
    ? ["image", "video"]
    : asset.kind === "audio"
      ? ["voice"]
      : [];
}
/** Prefill a draft only; the user must supply text and explicitly submit. */
export function mediaDraftRequest(
  asset: Pick<LocalAsset, "id" | "kind">,
  target: ReuseTarget,
): GenerationRequest {
  if (!mediaReuseTargets(asset).includes(target))
    throw new Error("此素材不支持该生成方式");
  const key =
    target === "image"
      ? "image.agnes-2.5.edit.v1"
      : target === "video"
        ? "video.agnes-2.5.i2v.v1"
        : "voice.indextts2.clone.v1";
  const model = modelCatalog.find((m) => m.key === key)!;
  return {
    modelKey: model.key,
    prompt: "",
    assetIds: [asset.id],
    parameters: {
      ...(model.parameters.aspectRatios.length
        ? { aspectRatio: model.parameters.aspectRatios[0] }
        : {}),
      ...(model.parameters.durationSeconds.length
        ? { durationSeconds: model.parameters.durationSeconds[0] }
        : {}),
    },
  };
}
export const workflowDraftKey = "aivideo-workflow-draft-v1";
export const previousWorkflowDraftKey = "aivideo-workflow-previous-draft-v1";
export function replaceWorkflowDraft(
  graph: WorkflowGraph,
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const previous = storage.getItem(workflowDraftKey);
  if (previous) storage.setItem(previousWorkflowDraftKey, previous);
  storage.setItem(
    workflowDraftKey,
    JSON.stringify(workflowSchema.parse(graph)),
  );
}
export function workflowFromImage(
  asset: Pick<LocalAsset, "id" | "kind">,
): WorkflowGraph {
  if (asset.kind !== "image") throw new Error("当前工作流参考素材仅支持图片");
  const graph = createTemplate("image-video");
  graph.name = "参考图片生成视频";
  graph.nodes = graph.nodes
    .filter((n) => n.id !== "prompt")
    .map((n) =>
      n.id === "image"
        ? {
            id: n.id,
            type: "input.asset",
            position: n.position,
            data: { label: "参考图片", text: "", assetId: asset.id },
          }
        : n,
    );
  graph.edges = graph.edges.filter((e) => e.source !== "prompt");
  return graph;
}
