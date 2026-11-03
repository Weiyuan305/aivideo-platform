"use client";
import { useCallback } from "react";
import type { JobListQuery } from "@aivideo/contracts";
import { loadJobPage } from "@aivideo/core/pages";
import { useCursorPage } from "@/features/use-cursor-page";
const stores = ["tasks"];
export function useTaskPage(query: Partial<JobListQuery>) {
  const key = JSON.stringify(query);
  const load = useCallback(
    (cursor?: string) => loadJobPage({ ...JSON.parse(key), cursor }),
    [key],
  );
  return useCursorPage(key, load, stores, 3000);
}
