import { mkdir, open, readFile, rename, unlink, link } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  BackupStatus,
  Incident,
  OperationsSummary,
} from "@aivideo/contracts";
export interface Notification {
  id: string;
  incidentId: string;
  transition: "opened" | "resolved";
  component: string;
  message: string;
  at: string;
  status: "pending" | "delivered" | "local";
  attempts: number;
  nextAttemptAt: number;
}
export interface OpsState {
  version: 1;
  sequence: number;
  lastCheckAt?: string;
  notificationMode: "local" | "webhook";
  probes: Record<string, { bad: number; good: number }>;
  incidents: Incident[];
  notifications: Notification[];
  backup: BackupStatus;
  lastRestore?: OperationsSummary["lastRestore"];
}
const empty = (): OpsState => ({
  version: 1,
  sequence: 0,
  notificationMode: "local",
  probes: {},
  incidents: [],
  notifications: [],
  backup: { status: "idle" },
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function processLockAlive(root: string, name: string) {
  try {
    const owner = JSON.parse(await readFile(join(root, name), "utf8"));
    if (!Number.isInteger(owner.pid) || owner.pid < 1) return false;
    try {
      process.kill(owner.pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code !== "ESRCH";
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error("进程锁记录无效");
  }
}
export async function fileLock(root: string, name: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, name),
    token = randomUUID();
  const candidate = join(root, token + ".lock-candidate");
  const file = await open(candidate, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ pid: process.pid, token }));
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    for (let tries = 0; tries < 250; tries++) {
      try {
        // Atomic hard link publishes a complete owner record, even across crashes.
        await link(candidate, path);
        return async () => {
          try {
            if (JSON.parse(await readFile(path, "utf8")).token === token)
              await unlink(path);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          const owner = JSON.parse(await readFile(path, "utf8"));
          try {
            process.kill(owner.pid, 0);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH")
              await unlink(path);
          }
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" &&
            !(error instanceof SyntaxError)
          )
            throw error;
        }
        await wait(20);
      }
    }
    throw new Error("运维状态正被其他进程占用");
  } finally {
    await unlink(candidate).catch(() => {});
  }
}
export class OpsStore {
  constructor(public root: string) {
    if (!isAbsolute(root)) throw new Error("OPS_STATE_ROOT 必须是绝对路径");
  }
  async read(): Promise<OpsState> {
    try {
      const state = JSON.parse(
        await readFile(join(this.root, "state.json"), "utf8"),
      );
      if (
        state.version !== 1 ||
        !Array.isArray(state.incidents) ||
        !Array.isArray(state.notifications) ||
        !state.probes ||
        !state.backup
      )
        throw new Error("运维状态文件无效");
      return state;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw new Error("运维状态文件无法读取或格式无效");
    }
  }
  async change(fn: (state: OpsState) => void) {
    const unlock = await fileLock(this.root, "state.lock");
    const temp = join(this.root, randomUUID() + ".part");
    try {
      const state = await this.read();
      fn(state);
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(state));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, join(this.root, "state.json"));
      return state;
    } finally {
      await unlink(temp).catch(() => {});
      await unlock();
    }
  }
  async summary(now = Date.now()): Promise<OperationsSummary> {
    const state = await this.read();
    return {
      monitor: {
        status: !state.lastCheckAt
          ? "missing"
          : now - Date.parse(state.lastCheckAt) > 120_000
            ? "stale"
            : "healthy",
        lastCheckAt: state.lastCheckAt,
      },
      incidents: state.incidents.slice(-10).reverse(),
      activeIncidents: state.incidents.filter((i) => !i.resolvedAt).length,
      pendingNotifications: state.notifications.filter(
        (n) => n.status === "pending",
      ).length,
      notificationMode: state.notificationMode,
      backup: state.backup,
      lastRestore: state.lastRestore,
    };
  }
}
