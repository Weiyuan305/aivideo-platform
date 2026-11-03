"use client";
import { useCallback } from "react";
import type { AssetListQuery } from "@aivideo/contracts";
import { loadAssetPage } from "@aivideo/core/pages";
import { useCursorPage } from "@/features/use-cursor-page";
const stores = ["assets", "tasks"];
export function useAssetPage(query: Partial<AssetListQuery>) {
  const key = JSON.stringify(query);
  const load = useCallback(
    (cursor?: string) => loadAssetPage({ ...JSON.parse(key), cursor }),
    [key],
  );
  return useCursorPage(key, load, stores, 5000);
}
