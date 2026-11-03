import { it, expect } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpsStore } from "../../packages/server/src/ops/state";
import { Monitor, collectSignals } from "../../packages/server/src/ops/monitor";
import { ServerWorkspace, DiskStorage } from "../../packages/server/src/index";
import { spawn, type ChildProcess } from "node:child_process";

it("persists debounced incidents, retries ordered webhook delivery and closes recovery after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-monitor-"));
  const received: { id: string; transition: string }[] = [];
  let reject: boolean | "timeout" = "timeout";
  let bad = true,
    now = Date.now();
  const receiver = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (reject === "timeout") return;
    if (reject) {
      res.writeHead(503);
      res.end();
      return;
    }
    received.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  const options = {
    store: new OpsStore(root),
    collect: async () => [
      {
        component: "database",
        healthy: !bad,
        message: bad ? "数据库不可用" : "数据库恢复",
      },
    ],
    webhook: `http://127.0.0.1:${(receiver.address() as { port: number }).port}`,
    clock: () => now,
  };
  try {
    let monitor = new Monitor(options);
    await monitor.tick();
    expect((await options.store.read()).incidents).toHaveLength(0);
    await monitor.tick();
    expect((await options.store.read()).incidents).toHaveLength(1);
    expect((await options.store.read()).notifications[0].attempts).toBe(1);
    await monitor.tick();
    expect((await options.store.read()).incidents).toHaveLength(1);
    monitor = new Monitor({ ...options, store: new OpsStore(root) });
    reject = true;
    now += 120_000;
    await monitor.tick();
    expect((await options.store.read()).notifications[0].attempts).toBe(2);
    reject = false;
    now += 120_000;
    await monitor.tick();
    expect(received.map((r) => r.transition)).toEqual(["opened"]);
    bad = false;
    await monitor.tick();
    expect(
      (await options.store.read()).incidents[0].resolvedAt,
    ).toBeUndefined();
    await monitor.tick();
    expect(received.map((r) => r.transition)).toEqual(["opened", "resolved"]);
    expect((await options.store.read()).incidents[0].resolvedAt).toBeTruthy();
    await monitor.tick();
    expect(received).toHaveLength(2);
    const serialized = JSON.stringify(await options.store.read());
    expect(serialized).not.toContain(options.webhook);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        options.store.change((s) => {
          s.sequence++;
        }),
      ),
    );
    expect((await options.store.read()).sequence).toBe(5);
  } finally {
    await new Promise<void>((r) => receiver.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});

it("restarts the standalone monitor after SIGKILL without losing local incidents or retaining a dead process lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-monitor-process-")),
    store = new OpsStore(root);
  let child: ChildProcess | undefined;
  const start = () => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/ops.mts", "monitor"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://fixture:test-only@127.0.0.1:1/offline",
          PRIVATE_STORAGE_ROOT: join(root, "files"),
          S3_BUCKET: "",
          OPS_STATE_ROOT: root,
          OPS_CHECK_INTERVAL_SECONDS: "5",
          BETTER_AUTH_URL: "http://127.0.0.1:1",
          BACKUP_ROOT: "",
          OPS_WEBHOOK_URL: "",
        },
        stdio: "ignore",
      },
    );
    return p;
  };
  const until = async (fn: () => Promise<boolean>) => {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("monitor process did not reach expected state");
  };
  try {
    child = start();
    await until(async () =>
      Boolean(
        (await store.read()).incidents.find((i) => i.component === "database"),
      ),
    );
    const before = await store.read(),
      exit = new Promise((r) => child!.once("exit", r));
    child.kill("SIGKILL");
    await exit;
    child = start();
    await until(
      async () => (await store.read()).lastCheckAt !== before.lastCheckAt,
    );
    expect(
      (await store.read()).incidents.filter((i) => i.component === "database"),
    ).toHaveLength(1);
    expect((await store.summary()).monitor.status).toBe("healthy");
    expect((await store.summary(Date.now() + 121_000)).monitor.status).toBe(
      "stale",
    );
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = new Promise((r) => child!.once("exit", r));
      child.kill("SIGTERM");
      await exit;
    }
    await rm(root, { recursive: true, force: true });
  }
});

it("detects actual database and Web failure while recording alerts outside the database", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-offline-monitor-"));
  await writeFile(join(root, "blocked"), "storage is a file");
  const app = new ServerWorkspace(
    "postgresql://fixture:secret-must-not-leak@127.0.0.1:1/offline",
    new DiskStorage(join(root, "blocked")),
  );
  const store = new OpsStore(join(root, "state"));
  try {
    const monitor = new Monitor({
      store,
      collect: () =>
        collectSignals(app, { healthURL: "http://127.0.0.1:1/api/health" }),
    });
    await monitor.tick();
    await monitor.tick();
    const state = await store.read();
    expect(
      state.incidents.filter((i) => !i.resolvedAt).map((i) => i.component),
    ).toEqual(expect.arrayContaining(["database", "web", "storage"]));
    expect(JSON.stringify(state)).not.toContain("secret-must-not-leak");
    expect(state.notifications.every((n) => n.status === "local")).toBe(true);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
