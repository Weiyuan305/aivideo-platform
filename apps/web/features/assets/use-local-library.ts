"use client";
import { useCallback, useEffect, useState } from "react";
import { listLocal, getLocal } from "@aivideo/core/local";
import { useWorkspaceQuery } from "@/features/use-workspace-query";
import type { LocalAsset, LocalVoice, LocalWorkflow } from "@aivideo/contracts";
const stores = ["assets", "voices", "workflows", "tasks"];
const empty = {
  assets: [] as LocalAsset[],
  voices: [] as LocalVoice[],
  workflows: [] as LocalWorkflow[],
};
type References = {
  assetIds?: string[];
  voiceIds?: string[];
  includeVoiceAssets?: boolean;
};
async function loadLibrary(references: References) {
  const [assets, voices, workflows] = await Promise.all([
    listLocal("assets"),
    listLocal("voices"),
    listLocal("workflows"),
  ]);
  const ids = new Set(references.assetIds ?? []);
  for (const voice of voices)
    if (
      references.includeVoiceAssets ||
      references.voiceIds?.includes(voice.id)
    )
      ids.add(voice.assetId);
  const missing = [...ids].filter((id) => !assets.some((a) => a.id === id));
  const referenced = await Promise.all(
    missing.map((id) => getLocal("assets", id)),
  );
  assets.push(...referenced.filter((a): a is LocalAsset => Boolean(a)));
  return {
    assets: assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    voices: voices.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    workflows: workflows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}
export function useLocalLibrary(references: References = {}) {
  const key = JSON.stringify(references);
  const load = useCallback(() => loadLibrary(JSON.parse(key)), [key]);
  const { data, ...query } = useWorkspaceQuery(load, empty, stores, 5000);
  return { ...data, ...query };
}
export function useBlobURL(blob?: Blob, remoteURL?: string) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob || remoteURL) {
      setUrl(undefined);
      return;
    }
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob, remoteURL]);
  return remoteURL ?? url;
}
