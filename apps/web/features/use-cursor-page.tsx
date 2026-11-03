"use client";
import { useCallback, useEffect, useState } from "react";
import type { WorkspacePage } from "@aivideo/core/pages";
import { useWorkspaceQuery } from "./use-workspace-query";
const empty = {
  items: [],
  total: 0,
  nextCursor: null,
  backend: "browser" as const,
};
export function useDebouncedSearch(value: string) {
  const [search, setSearch] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(value.trim()), 250);
    return () => clearTimeout(timer);
  }, [value]);
  return search;
}
export function useCursorPage<T>(
  key: string,
  loader: (cursor?: string) => Promise<WorkspacePage<T>>,
  stores: readonly string[],
  pollMs: number,
) {
  const [navigation, setNavigation] = useState({
    key,
    index: 0,
    stack: [undefined] as (string | undefined)[],
  });
  const current =
    navigation.key === key ? navigation : { key, index: 0, stack: [undefined] };
  // Discard the previous filter's cursor stack, including when switching back.
  if (navigation.key !== key) setNavigation(current);
  const cursor = current.stack[current.index];
  const load = useCallback(() => loader(cursor), [loader, cursor]);
  const query = useWorkspaceQuery(
    load,
    empty as WorkspacePage<T>,
    stores,
    pollMs,
  );
  function reset() {
    if (current.index === 0) void query.refresh();
    else setNavigation({ key, index: 0, stack: [undefined] });
  }
  function previous() {
    if (!current.index) return;
    setNavigation({ ...current, index: current.index - 1 });
    window.scrollTo({ top: 0 });
  }
  function next() {
    if (!query.loaded || !query.data.nextCursor) return;
    setNavigation({
      key,
      index: current.index + 1,
      stack: [
        ...current.stack.slice(0, current.index + 1),
        query.data.nextCursor,
      ],
    });
    window.scrollTo({ top: 0 });
  }
  return {
    ...query,
    ...query.data,
    page: current.index + 1,
    previous,
    next,
    reset,
    hasPrevious: current.index > 0,
  };
}
export function Pagination({
  page,
  total,
  loaded,
  hasPrevious,
  nextCursor,
  previous,
  next,
  reset,
}: {
  page: number;
  total: number;
  loaded: boolean;
  hasPrevious: boolean;
  nextCursor: string | null;
  previous: () => void;
  next: () => void;
  reset: () => void;
}) {
  return (
    <nav className="pagination toolbar" aria-label="列表分页">
      <span>
        第 {page} 页 · 共 {total} 条记录
      </span>
      <button
        className="action secondary"
        disabled={!loaded || !hasPrevious}
        onClick={previous}
      >
        上一页
      </button>
      <button
        className="action secondary"
        disabled={!loaded || !nextCursor}
        onClick={next}
      >
        下一页
      </button>
      <button className="action subtle" onClick={reset}>
        刷新列表
      </button>
    </nav>
  );
}
