import type postgres from "postgres";
import { createHash } from "node:crypto";
import {
  jobListQuerySchema,
  assetListQuerySchema,
  type LocalTask,
  type ListPage,
} from "@aivideo/contracts";
import { ServiceError, type StoredAsset } from "./types";
type SQL = ReturnType<typeof postgres>;
type Cursor = { v: 1; at: string; id: string; scope: string };
function scopeFor(owner: string, resource: string, query: object) {
  return createHash("sha256")
    .update(JSON.stringify([owner, resource, query]))
    .digest("hex");
}
function cursorFor(row: { at: string; id: string }, scope: string) {
  return Buffer.from(JSON.stringify({ v: 1, ...row, scope })).toString(
    "base64url",
  );
}
function decodeCursor(value: string | undefined, scope: string) {
  if (!value) return undefined;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      cursor?.v !== 1 ||
      cursor.scope !== scope ||
      typeof cursor.at !== "string" ||
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(cursor.at) ||
      typeof cursor.id !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor.id)
    )
      throw new Error();
    const time = new Date(cursor.at.replace(" ", "T") + "Z");
    if (
      !Number.isFinite(+time) ||
      time.toISOString().slice(0, 19) !==
        cursor.at.replace(" ", "T").slice(0, 19)
    )
      throw new Error();
    return cursor as Cursor;
  } catch {
    throw new ServiceError(
      "INVALID_CURSOR",
      "分页游标无效或筛选已改变，请回到第一页",
    );
  }
}
function parsed<T>(
  schema: {
    safeParse: (
      raw: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  raw: unknown,
): T {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new ServiceError("INVALID_QUERY", "分页或搜索参数无效");
  return result.data;
}
const patternFor = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
export async function queryJobs(
  sql: SQL,
  owner: string,
  raw: unknown,
): Promise<ListPage<LocalTask>> {
  const q = parsed(jobListQuerySchema, raw);
  const scope = scopeFor(owner, "jobs", {
    q: q.q,
    kind: q.kind,
    status: q.status,
    mode: q.mode,
    workflowId: q.workflowId,
    projectId: q.projectId,
    episodeId: q.episodeId,
  });
  const cursor = decodeCursor(q.cursor, scope);
  const pattern = patternFor(q.q);
  const where = sql`owner_user_id=${owner}
    and (${q.kind}='all' or payload->>'kind'=${q.kind})
    and (${q.mode}='all' or payload->>'mode'=${q.mode} or (${q.mode}='media' and payload->>'mode'!='dry-run'))
    and (${q.projectId ?? null}::text is null or payload#>>'{render,projectId}'=${q.projectId ?? null})
    and (${q.episodeId ?? null}::text is null or payload#>>'{render,episodeId}'=${q.episodeId ?? null})
    and (${q.workflowId ?? null}::text is null or payload#>>'{graph,id}'=${q.workflowId ?? null})
    and (${q.status}='all' or status=${q.status} or (${q.status}='outputs' and jsonb_array_length(payload->'outputAssetIds')>0))
    and (${q.q}='' or payload->>'title' ilike ${pattern} or payload#>>'{request,prompt}' ilike ${pattern} or id::text ilike ${pattern})`;
  const [rows, [count], [summary]] = await Promise.all([
    sql`select id,to_char(created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') as at,payload from jobs where ${where}
      ${cursor ? sql`and (created_at,id)<(${cursor.at + "+00"}::text::timestamptz,${cursor.id}::uuid)` : sql``}
      order by created_at desc nulls last,id desc nulls last limit ${q.limit + 1}`,
    sql`select count(*)::int as total from jobs where ${where}`,
    sql`select count(*) filter(where status in ('queued','running','archiving','reconciling','cancel_requested'))::int as active,
      count(*) filter(where status='blocked')::int as blocked,count(*) filter(where status='succeeded')::int as succeeded
      from jobs where owner_user_id=${owner}`,
  ]);
  const page = rows.slice(0, q.limit);
  return {
    items: page.map((r) => r.payload as LocalTask),
    total: count.total,
    nextCursor:
      rows.length > q.limit
        ? cursorFor({ at: page.at(-1)!.at, id: page.at(-1)!.id }, scope)
        : null,
    summary: summary as unknown as ListPage<LocalTask>["summary"],
  };
}
export async function queryAssets(
  sql: SQL,
  owner: string,
  raw: unknown,
): Promise<ListPage<StoredAsset>> {
  const q = parsed(assetListQuerySchema, raw);
  const scope = scopeFor(owner, "assets", { q: q.q, kind: q.kind });
  const cursor = decodeCursor(q.cursor, scope),
    pattern = patternFor(q.q);
  const where = sql`owner_user_id=${owner} and (${q.kind}='all' or kind=${q.kind}) and (${q.q}='' or name ilike ${pattern} or id::text ilike ${pattern})`;
  const [rows, [count]] = await Promise.all([
    sql`select id,owner_user_id as "ownerId",name,kind,mime,bytes,object_key as "objectKey",sha256,created_at as "createdAt",to_char(created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US') as at,
      source_job_id as "sourceJobId",exists(select 1 from jobs where jobs.id=assets.source_job_id and jobs.owner_user_id=assets.owner_user_id) as "sourceJobAvailable"
      from assets where ${where} ${cursor ? sql`and (created_at,id)<(${cursor.at + "+00"}::text::timestamptz,${cursor.id}::uuid)` : sql``}
      order by created_at desc nulls last,id desc nulls last limit ${q.limit + 1}`,
    sql`select count(*)::int as total from assets where ${where}`,
  ]);
  const page = rows.slice(0, q.limit);
  return {
    items: page.map(
      ({ at, ...row }) =>
        ({
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        }) as StoredAsset,
    ),
    total: count.total,
    nextCursor:
      rows.length > q.limit
        ? cursorFor({ at: page.at(-1)!.at, id: page.at(-1)!.id }, scope)
        : null,
  };
}
