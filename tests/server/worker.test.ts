import { it, expect } from "vitest";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ServerWorkspace, DiskStorage } from "../../packages/server/src/index";
import { FixtureProvider } from "./fixture-provider";
import { createTemplate } from "../../packages/core/src/workflow";
async function until<T>(
  get: () => Promise<T>,
  accept: (value: T) => boolean,
  ms = 20000,
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await get();
    if (accept(value)) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out waiting for durable worker");
}
async function launch(root: string, schema: string, delay = 0) {
  const process = fork(resolve("tests/server/worker-process.mts"), [], {
    execArgv: ["--import", "tsx"],
    env: {
      ...globalThis.process.env,
      TEST_STORAGE_ROOT: root,
      TEST_QUEUE_SCHEMA: schema,
      FIXTURE_DELAY_MS: String(delay),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let errors = "";
  process.stderr?.on("data", (d) => (errors += String(d)));
  await new Promise<void>((r, reject) => {
    const timer = setTimeout(
      () => reject(new Error("worker startup timeout: " + errors)),
      10000,
    );
    process.once("message", () => {
      clearTimeout(timer);
      r();
    });
    process.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`worker exited ${code}: ${errors}`));
    });
  });
  return process;
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const done = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await done;
}
it("outbox is durable and an independent worker resumes a killed provider checkpoint without resubmitting", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-worker-")),
    url = process.env.TEST_DATABASE_URL!,
    schema = "boss_" + crypto.randomUUID().replaceAll("-", "");
  if (!url || !new URL(url).pathname.startsWith("/aivideo_test"))
    throw new Error("isolated test database required");
  const app = new ServerWorkspace(
    url,
    new DiskStorage(root),
    new FixtureProvider(),
  );
  const owner = "worker-" + crypto.randomUUID();
  await app.ensureOwner(owner);
  let child: ChildProcess | undefined;
  try {
    const task = await app.createJob(owner, {
      request: {
        modelKey: "image.flux2.t2i.v1",
        prompt: "后台重启测试",
        assetIds: [],
        parameters: {},
      },
    });
    expect((await app.getJob(owner, task.id)).status).toBe("queued");
    child = await launch(root, schema, 20000);
    await until(async () => {
      const [row] =
        await app.sql`select request_id from provider_operations where job_id=${task.id}`;
      return row?.request_id;
    }, Boolean);
    const died = new Promise((r) => child!.once("exit", r));
    child.kill("SIGKILL");
    await died;
    child = undefined;
    const [before] =
      await app.sql`select request_id from provider_operations where job_id=${task.id}`;
    expect((await app.getJob(owner, task.id)).status).toBe("running");
    child = await launch(root, schema);
    const done = await until(
      () => app.getJob(owner, task.id),
      (t) => t.status === "succeeded",
    );
    expect(done.outputAssetIds).toHaveLength(1);
    const [after] =
      await app.sql`select request_id from provider_operations where job_id=${task.id}`;
    expect(after.request_id).toBe(before.request_id);
    const [{ count }] =
      await app.sql`select count(*)::int as count from provider_operations where job_id=${task.id}`;
    expect(count).toBe(1);
    const graph = createTemplate("image-video");
    const run = await app.createJob(owner, { graph, mode: "dry-run" });
    const dry = await until(
      () => app.getJob(owner, run.id),
      (t) => t.status === "succeeded",
    );
    expect(dry.nodes.every((n) => n.status === "succeeded")).toBe(true);
    expect(dry.outputAssetIds).toEqual([]);
  } finally {
    await stop(child);
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 45000);
