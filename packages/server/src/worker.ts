import { PgBoss } from "pg-boss";
import { randomUUID } from "node:crypto";
import type { ServerWorkspace } from "./service";
/** Durable queue transport. Hosted dispatchers can use the same outbox/execute contract. */
export async function startWorker(
  workspace: ServerWorkspace,
  url: string,
  options: {
    schema?: string;
    expireSeconds?: number;
    onError?: (error: Error) => void;
    heartbeatMs?: number;
  } = {},
) {
  const boss = new PgBoss({
    connectionString: url,
    schema: options.schema ?? "pgboss",
    max: 3,
    maintenanceIntervalSeconds: options.expireSeconds ? 1 : 30,
    superviseIntervalSeconds: options.expireSeconds ? 1 : 10,
    monitorIntervalSeconds: options.expireSeconds ? 1 : 10,
  });
  boss.on("error", (e) => options.onError?.(e));
  await boss.start();
  const queue = "aivideo.execute";
  await boss.createQueue(queue, {
    retryLimit: 8,
    retryDelay: 1,
    retryBackoff: true,
    expireInSeconds: options.expireSeconds ?? 600,
    heartbeatSeconds: 10,
  });
  await boss.work<{ id: string }>(
    queue,
    { pollingIntervalSeconds: 0.5, batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) await workspace.execute(job.data.id);
    },
  );
  const workerId = randomUUID();
  let lastDispatch: Date | undefined,
    lastError: Date | undefined,
    dispatchFailed = false;
  let stopped = false,
    dispatching = false;
  async function dispatch() {
    if (stopped || dispatching) return;
    dispatching = true;
    try {
      for (const item of await workspace.pendingDispatches()) {
        await boss.send(
          queue,
          { id: item.jobId },
          {
            id: item.id,
            retryLimit: 8,
            retryDelay: 1,
            retryBackoff: true,
            expireInSeconds: options.expireSeconds ?? 600,
          },
        );
        await workspace.dispatched(item.id);
      }
      lastDispatch = new Date();
      dispatchFailed = false;
    } catch (e) {
      lastError = new Date();
      dispatchFailed = true;
      options.onError?.(
        e instanceof Error ? e : new Error("outbox dispatch failed"),
      );
    } finally {
      dispatching = false;
    }
  }
  const timer = setInterval(() => void dispatch(), 500);
  await dispatch();
  let pulsing = false;
  async function heartbeat() {
    if (stopped || pulsing) return;
    pulsing = true;
    try {
      const connected = Boolean(await boss.getQueue(queue));
      const ready =
        connected &&
        !dispatchFailed &&
        Boolean(lastDispatch) &&
        Date.now() - lastDispatch!.getTime() < 15_000;
      await workspace.sql`insert into worker_heartbeats(id,queue_schema,heartbeat_at,dispatch_at,error_at,transport_ready)
        values(${workerId},${options.schema ?? "pgboss"},now(),${lastDispatch ?? null},${lastError ?? null},${ready})
        on conflict(id) do update set heartbeat_at=now(),dispatch_at=excluded.dispatch_at,error_at=excluded.error_at,transport_ready=excluded.transport_ready`;
    } catch (e) {
      lastError = new Date();
      options.onError?.(e instanceof Error ? e : new Error("heartbeat failed"));
    } finally {
      pulsing = false;
    }
  }
  await heartbeat();
  const heartbeatTimer = setInterval(
    () => void heartbeat(),
    options.heartbeatMs ?? 5000,
  );
  return {
    boss,
    workerId,
    dispatch,
    async stop() {
      stopped = true;
      clearInterval(timer);
      clearInterval(heartbeatTimer);
      await boss.stop({ graceful: true, timeout: 5000 });
      await workspace.sql`update worker_heartbeats set stopped_at=now(),transport_ready=false where id=${workerId}`.catch(
        () => options.onError?.(new Error("worker stop heartbeat failed")),
      );
    },
  };
}
