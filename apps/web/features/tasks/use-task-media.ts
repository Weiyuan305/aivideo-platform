"use client";
import { useCallback } from "react";
import type { LocalTask, LocalAsset } from "@aivideo/contracts";
import { referencesForTask } from "@aivideo/core/tasks";
import { loadTaskMedia, type TaskReferences } from "@aivideo/core/task-media";
import { getLocal } from "@aivideo/core/local";
import { useWorkspaceQuery } from "@/features/use-workspace-query";
const stores = ["assets", "voices", "tasks"];
const empty = { assets: [] as LocalAsset[], missing: [] as string[] };
export function useTaskMedia(task?: LocalTask) {
  const refs = task ? referencesForTask(task) : undefined;
  const key = JSON.stringify({
    assetIds: [...(refs?.assetIds ?? [])].sort(),
    voiceIds: [...(refs?.voiceIds ?? [])].sort(),
  });
  const load = useCallback(
    () =>
      loadTaskMedia(JSON.parse(key) as TaskReferences, {
        asset: (id) => getLocal("assets", id),
        voice: (id) => getLocal("voices", id),
      }),
    [key],
  );
  const { data, ...query } = useWorkspaceQuery(load, empty, stores, 5000);
  return { ...data, ...query };
}
