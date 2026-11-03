import { randomUUID } from "node:crypto";
import type { ServerWorkspace } from "../service";
import { inspectHealth } from "../health";
import { OpsStore, type Notification } from "./state";
export interface Signal {
  component: string;
  healthy: boolean;
  message: string;
}
export async function collectSignals(
  app: ServerWorkspace,
  options: { healthURL: string; store?: OpsStore; backupMaxAgeHours?: number },
): Promise<Signal[]> {
  const [health, web] = await Promise.all([
    inspectHealth(app),
    fetch(options.healthURL, {
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    })
      .then(async (r) => {
        const b = await r.json();
        return (
          (r.ok || r.status === 503) &&
          typeof b.generationEnabled === "boolean" &&
          Boolean(b.database && b.storage)
        );
      })
      .catch(() => false),
  ]);
  const signals: Signal[] = [
    {
      component: "web",
      healthy: web,
      message: web ? "Web 已恢复响应" : "Web 健康入口无法读取",
    },
    {
      component: "database",
      healthy: health.database.status === "healthy",
      message:
        health.database.status === "healthy"
          ? "数据库已恢复"
          : "数据库连接或查询失败",
    },
    {
      component: "storage",
      healthy: health.storage.status === "healthy",
      message:
        health.storage.status === "healthy"
          ? "素材存储已恢复"
          : "素材存储读写或清理失败",
    },
  ];
  if (health.database.status === "healthy") {
    signals.push({
      component: "worker",
      healthy: health.worker.status === "healthy",
      message:
        health.worker.status === "healthy"
          ? "后台已恢复"
          : "后台停止、心跳过期或分发异常",
    });
    try {
      const [row] =
        await app.sql`select count(*) filter(where status in ('archive_failed','unknown'))::int as attention, coalesce(extract(epoch from now()-min(created_at) filter(where status='queued')),0) as age from jobs`;
      const healthy = row.attention === 0 && Number(row.age) <= 60;
      signals.push({
        component: "queue",
        healthy,
        message: healthy
          ? "任务队列已恢复"
          : "任务排队过久、归档失败或提交待核对",
      });
    } catch {
      signals.push({
        component: "queue",
        healthy: false,
        message: "无法检查任务队列",
      });
    }
  }
  if (options.store) {
    const { backup } = await options.store.read(),
      now = Date.now();
    const running =
      backup.status === "running" &&
      now - Date.parse(backup.lastAttemptAt || "") < 2 * 60 * 60_000;
    const healthy =
      running ||
      (backup.status !== "failed" &&
        Boolean(backup.lastSuccessAt) &&
        now - Date.parse(backup.lastSuccessAt!) <=
          (options.backupMaxAgeHours ?? 26) * 60 * 60_000);
    signals.push({
      component: "backup",
      healthy,
      message: healthy
        ? "备份已恢复或正在执行"
        : "没有有效近期备份、备份失败或运行超时",
    });
  }
  return signals;
}
export class Monitor {
  private inFlight?: Promise<void>;
  constructor(
    private options: {
      store: OpsStore;
      collect: () => Promise<Signal[]>;
      webhook?: string;
      token?: string;
      clock?: () => number;
      onEvent?: (notification: Notification) => void;
    },
  ) {
    if (options.webhook) {
      const u = new URL(options.webhook);
      if (
        u.protocol !== "https:" &&
        !(
          u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
        )
      )
        throw new Error("Webhook 必须使用 HTTPS（本机验收可使用 HTTP）");
    }
  }
  tick() {
    if (!this.inFlight)
      this.inFlight = this.run().finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
  private async run() {
    const now = this.options.clock?.() ?? Date.now(),
      at = new Date(now).toISOString();
    let signals: Signal[];
    try {
      signals = await this.options.collect();
    } catch {
      signals = [
        {
          component: "monitor",
          healthy: false,
          message: "监控检测失败，请检查运维配置",
        },
      ];
    }
    const created: Notification[] = [];
    await this.options.store.change((state) => {
      state.lastCheckAt = at;
      state.notificationMode = this.options.webhook ? "webhook" : "local";
      for (const signal of signals) {
        const probe = state.probes[signal.component] ?? { bad: 0, good: 0 };
        probe.bad = signal.healthy ? 0 : probe.bad + 1;
        probe.good = signal.healthy ? probe.good + 1 : 0;
        state.probes[signal.component] = probe;
        const active = state.incidents.find(
          (i) => i.component === signal.component && !i.resolvedAt,
        );
        let incident = active,
          transition: Notification["transition"] | undefined;
        if (probe.bad >= 2 && !active) {
          incident = {
            id: randomUUID(),
            component: signal.component,
            message: signal.message,
            openedAt: at,
          };
          state.incidents.push(incident);
          transition = "opened";
        }
        if (probe.good >= 2 && active) {
          active.resolvedAt = at;
          transition = "resolved";
        }
        if (transition && incident) {
          const n: Notification = {
            id: randomUUID(),
            incidentId: incident.id,
            component: signal.component,
            message: signal.message,
            transition,
            at,
            status: this.options.webhook ? "pending" : "local",
            attempts: 0,
            nextAttemptAt: now,
          };
          state.notifications.push(n);
          created.push(n);
        }
      }
    });
    for (const n of created) this.options.onEvent?.(n);
    if (!this.options.webhook) return;
    // Preserve event order; at-least-once delivery uses stable notification IDs.
    for (const event of (await this.options.store.read()).notifications
      .filter((n) => n.status === "pending")
      .slice(0, 5)) {
      if (event.nextAttemptAt > now) break;
      let delivered = false;
      try {
        const response = await fetch(this.options.webhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": event.id,
            ...(this.options.token
              ? { Authorization: "Bearer " + this.options.token }
              : {}),
          },
          body: JSON.stringify({
            version: 1,
            id: event.id,
            incidentId: event.incidentId,
            component: event.component,
            transition: event.transition,
            message: event.message,
            at: event.at,
          }),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        delivered = response.ok;
        await response.body?.cancel();
      } catch {
        /* Retry without persisting endpoint, token or raw response. */
      }
      await this.options.store.change((s) => {
        const n = s.notifications.find((n) => n.id === event.id)!;
        n.attempts++;
        n.status = delivered ? "delivered" : "pending";
        n.nextAttemptAt =
          now + Math.min(3600, 30 * 2 ** Math.min(n.attempts - 1, 7)) * 1000;
      });
      if (!delivered) break;
    }
  }
}
