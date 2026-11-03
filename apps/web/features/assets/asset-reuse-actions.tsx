"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LocalAsset } from "@aivideo/contracts";
import { getLocal } from "@aivideo/core/local";
import {
  mediaReuseTargets,
  mediaDraftRequest,
  workflowFromImage,
  replaceWorkflowDraft,
  type ReuseTarget,
} from "@aivideo/core/media-reuse";
import { restoreStudioRequest } from "@aivideo/studio-ui/drafts";
const labels = {
  image: "编辑此图片",
  video: "以此图生成视频",
  voice: "克隆此声音",
};
export function AssetReuseActions({
  asset,
  onError,
}: {
  asset: LocalAsset;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function reuse(target: ReuseTarget | "workflow") {
    if (busy) return;
    setBusy(true);
    onError("");
    try {
      const current = await getLocal("assets", asset.id);
      if (!current) throw new Error("素材已不存在，请刷新后重新选择");
      if (target === "workflow") {
        replaceWorkflowDraft(workflowFromImage(current), localStorage);
        router.push("/workflows");
      } else
        router.push(
          await restoreStudioRequest(mediaDraftRequest(current, target)),
        );
    } catch (e) {
      onError(e instanceof Error ? e.message : "无法复用素材");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="asset-reuse-actions">
      {mediaReuseTargets(asset).map((target) => (
        <button
          key={target}
          className="action subtle"
          disabled={busy}
          onClick={() => void reuse(target)}
        >
          {labels[target]}
        </button>
      ))}
      {asset.kind === "image" && (
        <button
          className="action subtle"
          disabled={busy}
          onClick={() => void reuse("workflow")}
        >
          用于工作流
        </button>
      )}
    </div>
  );
}
