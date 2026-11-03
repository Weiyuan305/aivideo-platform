import { ServerWorkspace, storageFromEnv } from "../packages/server/src/index";
import {
  OpsStore,
  fileLock,
  processLockAlive,
} from "../packages/server/src/ops/state";
import { Monitor, collectSignals } from "../packages/server/src/ops/monitor";
import {
  createBackup,
  verifyBackup,
  restoreBackup,
} from "../packages/server/src/ops/backup";
const [command, directory] = process.argv.slice(2);
const env = process.env;
function required(key: string) {
  const value = env[key];
  if (!value) throw new Error(`${key} 未配置`);
  return value;
}
function hours(key: string, fallback: number) {
  const n = Number(env[key] || fallback);
  if (!Number.isFinite(n) || n < 1 || n > 8760)
    throw new Error(`${key} 必须在 1 到 8760 之间`);
  return n;
}
async function main() {
  if (command === "status") {
    console.log(
      JSON.stringify(await new OpsStore(required("OPS_STATE_ROOT")).summary()),
    );
    return;
  }
  if (command === "verify") {
    if (!directory) throw new Error("请指定备份目录");
    const m = await verifyBackup(directory);
    console.log(
      JSON.stringify({ verified: true, id: m.id, assets: m.objects.length }),
    );
    return;
  }
  if (command === "restore") {
    if (!directory) throw new Error("请指定备份目录");
    const targetEnv: NodeJS.ProcessEnv = {
      PRIVATE_STORAGE_ROOT: env.RESTORE_STORAGE_ROOT,
      S3_BUCKET: env.RESTORE_S3_BUCKET,
      S3_ENDPOINT: env.RESTORE_S3_ENDPOINT,
      S3_REGION: env.RESTORE_S3_REGION,
      S3_ACCESS_KEY_ID: env.RESTORE_S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: env.RESTORE_S3_SECRET_ACCESS_KEY,
    };
    console.log(
      JSON.stringify(
        await restoreBackup(directory, {
          databaseURL: required("RESTORE_DATABASE_URL"),
          storage: storageFromEnv(targetEnv),
          pgBinDir: env.PG_BIN_DIR,
          stateRoot: env.OPS_STATE_ROOT,
        }),
      ),
    );
    return;
  }
  if (!["backup", "monitor"].includes(command))
    throw new Error("命令必须为 monitor / backup / verify / restore");
  const url = required("DATABASE_URL"),
    stateRoot = required("OPS_STATE_ROOT"),
    store = new OpsStore(stateRoot);
  const app = new ServerWorkspace(url, storageFromEnv(env));
  const backup = () =>
    createBackup(app, url, {
      root: required("BACKUP_ROOT"),
      stateRoot,
      pgBinDir: env.PG_BIN_DIR,
    });
  if (command === "backup") {
    try {
      const m = await backup();
      console.log(JSON.stringify({ backupId: m.id, assets: m.objects.length }));
    } finally {
      await app.close();
    }
    return;
  }
  const unlock = await fileLock(stateRoot, "monitor.lock");
  let retryInterrupted =
    (await store.read()).backup.status === "running" &&
    !(await processLockAlive(stateRoot, "backup.lock"));
  if (retryInterrupted)
    await store.change((s) => {
      s.backup = {
        ...s.backup,
        status: "failed",
        message: "上次备份被中断，等待重新执行",
      };
    });
  const interval = Number(env.OPS_CHECK_INTERVAL_SECONDS || 30);
  if (!Number.isFinite(interval) || interval < 5 || interval > 60)
    throw new Error("监控间隔必须在 5 到 60 秒之间");
  const backupEvery = hours("BACKUP_INTERVAL_HOURS", 24) * 60 * 60_000;
  const monitor = new Monitor({
    store,
    webhook: env.OPS_WEBHOOK_URL,
    token: env.OPS_WEBHOOK_TOKEN,
    collect: () =>
      collectSignals(app, {
        healthURL: new URL(
          "/api/health",
          env.BETTER_AUTH_URL || "http://127.0.0.1:3000",
        ).toString(),
        store,
        backupMaxAgeHours: hours("BACKUP_MAX_AGE_HOURS", 26),
      }),
    onEvent: (n) =>
      console.log(
        JSON.stringify({
          event: "alert",
          id: n.id,
          component: n.component,
          transition: n.transition,
          message: n.message,
        }),
      ),
  });
  let stopping = false,
    activeBackup: Promise<unknown> | undefined,
    wake: () => void = () => {};
  const stop = () => {
    stopping = true;
    wake();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  console.log(
    "AIvideo operations ready; local alerts enabled; model adapters disabled",
  );
  try {
    while (!stopping) {
      await monitor.tick();
      const state = await store.read(),
        now = Date.now();
      if (
        env.BACKUP_ROOT &&
        !activeBackup &&
        (retryInterrupted ||
          !state.backup.lastAttemptAt ||
          now - Date.parse(state.backup.lastAttemptAt) >
            (state.backup.status === "failed" ? 60 * 60_000 : backupEvery))
      ) {
        retryInterrupted = false;
        activeBackup = backup()
          .catch(() => console.error("周期备份失败，状态已记录"))
          .finally(() => {
            activeBackup = undefined;
          });
      }
      await new Promise<void>((r) => {
        const timer = setTimeout(r, interval * 1000);
        wake = () => {
          clearTimeout(timer);
          r();
        };
        if (stopping) wake();
      });
    }
  } finally {
    await activeBackup;
    await app.close();
    await unlock();
  }
}
try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "运维操作失败");
  process.exitCode = 1;
}
