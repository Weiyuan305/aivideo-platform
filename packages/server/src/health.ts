import { randomUUID } from "node:crypto";
import type {
  WorkspaceHealth,
  HealthCheck,
  WorkerHealth,
} from "@aivideo/contracts";
import type { ServerWorkspace } from "./service";
import type { ObjectStorage } from "./storage";
export const WORKER_STALE_MS = 20_000;
async function deadline<T>(work: Promise<T>, ms = 4000, cancel?: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel?.();
          reject(new Error("probe timeout"));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
async function check(
  message: string,
  work: Promise<unknown>,
  cancel?: () => void,
): Promise<HealthCheck> {
  const start = Date.now();
  try {
    await deadline(work, 4000, cancel);
    return {
      status: "healthy",
      message,
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      status: "unhealthy",
      message: "检查失败或超时，请检查服务配置与权限",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  }
}
export async function probeStorage(storage: ObjectStorage) {
  const key = "health-probes/" + randomUUID(),
    bytes = Buffer.from("aivideo-health-probe");
  try {
    await storage.put(
      key,
      (async function* () {
        yield bytes;
      })(),
      bytes.length,
    );
    if (!Buffer.from((await storage.read(key)).bytes).equals(bytes))
      throw new Error("probe mismatch");
  } finally {
    await storage.remove(key);
  }
}
const storageChecks = new WeakMap<
  ObjectStorage,
  { expires: number; pending: Promise<HealthCheck>; settled: boolean }
>();
function storageCheck(storage: ObjectStorage) {
  const previous = storageChecks.get(storage);
  if (previous && (!previous.settled || previous.expires > Date.now()))
    return previous.pending;
  const work = probeStorage(storage);
  const entry = {
    expires: Date.now() + 30_000,
    pending: check("临时对象写入、读取校验与清理通过", work),
    settled: false,
  };
  storageChecks.set(storage, entry);
  void work.then(
    () => {
      entry.settled = true;
    },
    () => {
      entry.settled = true;
    },
  );
  return entry.pending;
}
export function classifyWorker(
  rows: {
    heartbeatAt: string | Date;
    stoppedAt: string | Date | null;
    transportReady: boolean;
    errorAt?: string | Date | null;
  }[],
  now = Date.now(),
  staleMs = WORKER_STALE_MS,
): WorkerHealth {
  const running = rows.filter((r) => !r.stoppedAt),
    fresh = running.filter(
      (r) => now - new Date(r.heartbeatAt).getTime() <= staleMs,
    );
  const last = rows.reduce<(typeof rows)[number] | undefined>(
    (a, b) =>
      !a || +new Date(b.heartbeatAt) > +new Date(a.heartbeatAt) ? b : a,
    undefined,
  );
  const active = fresh.filter((r) => r.transportReady).length;
  const status = active
    ? "healthy"
    : fresh.length
      ? "unhealthy"
      : running.length
        ? "stale"
        : rows.length
          ? "stopped"
          : "missing";
  const messages = {
    healthy: "后台在线，队列连接与分发检查通过",
    unhealthy: "后台存活，但队列连接或分发异常",
    stale: "后台心跳已过期，请检查或重启 worker",
    stopped: "后台已停止，请启动 worker",
    missing: "尚未发现后台，请启动 worker",
  };
  return {
    status,
    message: messages[status],
    activeWorkers: active,
    ...(last
      ? { lastHeartbeatAt: new Date(last.heartbeatAt).toISOString() }
      : {}),
    ...(last?.errorAt
      ? { lastErrorAt: new Date(last.errorAt).toISOString() }
      : {}),
  };
}
export async function inspectHealth(
  app: ServerWorkspace,
  owner?: string,
): Promise<WorkspaceHealth> {
  const ping = app.sql`select 1`;
  const [database, storage] = await Promise.all([
    check("数据库连接与查询通过", ping, () => {
      void ping.cancel();
    }),
    storageCheck(app.storage),
  ]);
  const report: WorkspaceHealth = {
    status: "unavailable",
    generationEnabled: app.provider.id !== "disabled",
    checkedAt: new Date().toISOString(),
    database,
    storage,
    worker: { status: "unknown", message: "数据库不可用，无法判断后台" },
  };
  if (database.status !== "healthy") return report;
  try {
    const rows = await deadline(
      app.sql`select heartbeat_at as "heartbeatAt",stopped_at as "stoppedAt",transport_ready as "transportReady",error_at as "errorAt" from worker_heartbeats order by heartbeat_at desc limit 100`,
    );
    report.worker = classifyWorker(rows as never);
  } catch {
    report.worker = {
      status: "unknown",
      message: "无法读取后台状态，请确认数据库迁移已应用",
    };
  }
  if (owner) {
    try {
      const [[counts], [outbox]] = await deadline(
        Promise.all([
          app.sql`select count(*) filter(where status='queued')::int as queued,
          count(*) filter(where status in ('running','reconciling','cancel_requested'))::int as running,
          count(*) filter(where status='archiving')::int as archiving,
          count(*) filter(where status='archive_failed')::int as "archiveFailed",
          count(*) filter(where status='unknown')::int as unknown,
          greatest(coalesce(extract(epoch from now()-min(created_at) filter(where status='queued')),0),0)::int as "oldestQueuedSeconds"
          from jobs where owner_user_id=${owner}`,
          app.sql`select count(*)::int as pending from job_outbox o join jobs j on j.id=o.job_id where j.owner_user_id=${owner} and not o.delivered and j.status in ('queued','running','archiving','archive_failed','reconciling','cancel_requested')`,
        ]),
      );
      report.queue = {
        ...counts,
        pendingDispatch: outbox.pending,
        status:
          counts.oldestQueuedSeconds > 60 ||
          counts.archiveFailed > 0 ||
          counts.unknown > 0
            ? "backlogged"
            : "healthy",
      } as WorkspaceHealth["queue"];
    } catch {
      report.queue = {
        status: "unknown",
        queued: 0,
        running: 0,
        archiving: 0,
        archiveFailed: 0,
        unknown: 0,
        pendingDispatch: 0,
        oldestQueuedSeconds: 0,
      };
    }
  }
  report.status =
    storage.status !== "healthy"
      ? "unavailable"
      : report.worker.status !== "healthy" ||
          report.queue?.status === "backlogged" ||
          report.queue?.status === "unknown"
        ? "degraded"
        : "healthy";
  return report;
}
