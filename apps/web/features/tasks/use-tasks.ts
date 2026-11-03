"use client";
import { useCallback } from "react";
import type { LocalTask } from "@aivideo/contracts";
import { getLocal } from "@aivideo/core/local";
import { useWorkspaceQuery } from "@/features/use-workspace-query";
import { loadJobPage } from "@aivideo/core/pages";
import { isTerminal } from "@aivideo/core/tasks";
const stores = ["tasks"];
const empty: LocalTask[] = [];
const shouldPollTask = (task: LocalTask | undefined) =>
  !task || !isTerminal(task.status);
export function useTasks(workflowId?: string) {
  const load = useCallback(
    async () =>
      workflowId ? (await loadJobPage({ workflowId, limit: 5 })).items : [],
    [workflowId],
  );
  const query = useWorkspaceQuery(load, empty, stores, 1500);
  return { ...query, tasks: query.data };
}
export function useTask(id?: string) {
  const load = useCallback(
    () => (id ? getLocal("tasks", id) : Promise.resolve(undefined)),
    [id],
  );
  const query = useWorkspaceQuery(
    load,
    undefined,
    stores,
    1500,
    shouldPollTask,
  );
  return { ...query, task: query.data?.id === id ? query.data : undefined };
}
