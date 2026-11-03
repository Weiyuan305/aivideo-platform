import {
  jobListQuerySchema,
  assetListQuerySchema,
  type JobListQuery,
  type AssetListQuery,
  type ListPage,
  type LocalTask,
  type LocalAsset,
} from "@aivideo/contracts";
import { listLocal } from "./local";
import {
  serverAsset,
  workspaceBackend,
  workspaceRequest,
} from "./workspace-client";
export type WorkspacePage<T> = ListPage<T> & { backend: "server" | "browser" };
function queryString(query: object) {
  return new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
function localPage<T extends { id: string; createdAt: string }>(
  items: T[],
  limit: number,
  cursor?: string,
): ListPage<T> {
  const sorted = items.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
  );
  let boundary: { at: string; id: string } | undefined;
  if (cursor) {
    try {
      boundary = JSON.parse(decodeURIComponent(cursor.slice(6)));
      if (
        !cursor.startsWith("local:") ||
        typeof boundary?.at !== "string" ||
        typeof boundary?.id !== "string"
      )
        throw new Error();
    } catch {
      throw new Error("分页游标无效，请回到第一页");
    }
  }
  const remaining = boundary
    ? sorted.filter(
        (x) =>
          x.createdAt < boundary!.at ||
          (x.createdAt === boundary!.at && x.id < boundary!.id),
      )
    : sorted;
  const page = remaining.slice(0, limit),
    last = page.at(-1);
  return {
    items: page,
    total: sorted.length,
    nextCursor:
      remaining.length > limit && last
        ? "local:" +
          encodeURIComponent(
            JSON.stringify({ at: last.createdAt, id: last.id }),
          )
        : null,
  };
}
export async function loadJobPage(
  raw: Partial<JobListQuery>,
): Promise<WorkspacePage<LocalTask>> {
  const q = jobListQuerySchema.parse(raw),
    backend = await workspaceBackend();
  if (backend === "server")
    return {
      ...(await workspaceRequest<ListPage<LocalTask>>(
        "/api/jobs?" + queryString(q),
      )),
      backend,
    };
  const all = await listLocal("tasks"),
    needle = q.q.toLowerCase();
  const filtered = all.filter(
    (t) =>
      (q.kind === "all" || t.kind === q.kind) &&
      (q.mode === "all" ||
        t.mode === q.mode ||
        (q.mode === "media" && t.mode !== "dry-run")) &&
      (!q.projectId || t.render?.projectId === q.projectId) &&
      (!q.episodeId || t.render?.episodeId === q.episodeId) &&
      (!q.workflowId || t.graph?.id === q.workflowId) &&
      (q.status === "all" ||
        (q.status === "outputs"
          ? t.outputAssetIds.length > 0
          : t.status === q.status)) &&
      `${t.title} ${t.request?.prompt ?? ""} ${t.id}`
        .toLowerCase()
        .includes(needle),
  );
  return {
    ...localPage(filtered, q.limit, q.cursor),
    backend,
    summary: {
      active: all.filter((t) =>
        [
          "queued",
          "running",
          "archiving",
          "reconciling",
          "cancel_requested",
        ].includes(t.status),
      ).length,
      blocked: all.filter((t) => t.status === "blocked").length,
      succeeded: all.filter((t) => t.status === "succeeded").length,
    },
  };
}
export async function loadAssetPage(
  raw: Partial<AssetListQuery>,
): Promise<WorkspacePage<LocalAsset>> {
  const q = assetListQuerySchema.parse(raw),
    backend = await workspaceBackend();
  if (backend === "server") {
    const result = await workspaceRequest<ListPage<LocalAsset>>(
      "/api/workspace/assets?" + queryString(q),
    );
    return { ...result, items: result.items.map(serverAsset), backend };
  }
  const needle = q.q.toLowerCase(),
    all = await listLocal("assets");
  return {
    ...localPage(
      all.filter(
        (a) =>
          (q.kind === "all" || a.kind === q.kind) &&
          `${a.name} ${a.id}`.toLowerCase().includes(needle),
      ),
      q.limit,
      q.cursor,
    ),
    backend,
  };
}
