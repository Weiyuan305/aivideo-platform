import { expect, it } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ServerWorkspace,
  DiskStorage,
  inspectHealth,
} from "../../packages/server/src/index";
import { probeStorage } from "../../packages/server/src/health";
import { startWorker } from "../../packages/server/src/worker";
import { FixtureProvider } from "./fixture-provider";
const url = process.env.TEST_DATABASE_URL!;
if (!url || !new URL(url).pathname.startsWith("/aivideo_test"))
  throw new Error("health tests require an isolated test DB");
it("performs real storage write/read/delete and reports DB/storage failures without exposing secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-health-"));
  const disk = new DiskStorage(root);
  const offline = new ServerWorkspace(
    "postgresql://fixture:do-not-expose@127.0.0.1:1/unavailable",
    disk,
  );
  try {
    await probeStorage(disk);
    expect(await readdir(join(root, "health-probes"))).toEqual([]);
    const report = await inspectHealth(offline);
    expect(report.database.status).toBe("unhealthy");
    expect(report.storage.status).toBe("healthy");
    expect(JSON.stringify(report)).not.toContain("do-not-expose");
    const blocker = join(root, "blocker");
    await writeFile(blocker, "owned test file");
    const broken = new ServerWorkspace(url, new DiskStorage(blocker));
    try {
      expect((await inspectHealth(broken)).storage.status).toBe("unhealthy");
    } finally {
      await broken.close();
    }
  } finally {
    await offline.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("records real worker heartbeat and graceful stop, and isolates queue statistics by owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-worker-health-"));
  const app = new ServerWorkspace(
    url,
    new DiskStorage(root),
    new FixtureProvider(),
  );
  const a = "health-" + crypto.randomUUID(),
    b = "health-" + crypto.randomUUID();
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  try {
    await app.ensureOwner(a);
    await app.ensureOwner(b);
    await app.createJob(a, {
      request: {
        modelKey: "image.flux2.t2i.v1",
        prompt: "queue health",
        assetIds: [],
        parameters: {},
      },
    });
    const mine = await inspectHealth(app, a),
      other = await inspectHealth(app, b);
    expect(mine.queue?.queued).toBe(1);
    expect(mine.queue?.pendingDispatch).toBe(1);
    expect(other.queue?.queued).toBe(0);
    expect(other.queue?.pendingDispatch).toBe(0);
    worker = await startWorker(app, url, {
      schema: "health_" + crypto.randomUUID().replaceAll("-", ""),
      heartbeatMs: 100,
    });
    expect((await inspectHealth(app, a)).worker.status).toBe("healthy");
    const id = worker.workerId;
    await worker.stop();
    worker = undefined;
    const [row] =
      await app.sql`select stopped_at,transport_ready from worker_heartbeats where id=${id}`;
    expect(row.stopped_at).not.toBeNull();
    expect(row.transport_ready).toBe(false);
  } finally {
    await worker?.stop();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("flags an aged queue, archive failures and unresolved submissions as needing attention", async () => {
  const root = await mkdtemp(join(tmpdir(), "aivideo-queue-health-"));
  const app = new ServerWorkspace(url, new DiskStorage(root));
  const owner = "queue-health-" + crypto.randomUUID();
  try {
    await app.ensureOwner(owner);
    const job = await app.createJob(owner, {
      request: {
        modelKey: "image.flux2.t2i.v1",
        prompt: "health transitions",
        assetIds: [],
        parameters: {},
      },
    });
    await app.sql`update jobs set created_at=now()-interval '2 minutes' where id=${job.id}`;
    expect((await inspectHealth(app, owner)).queue?.status).toBe("backlogged");
    for (const status of ["archive_failed", "unknown"] as const) {
      await app.sql`update jobs set status=${status} where id=${job.id}`;
      const queue = (await inspectHealth(app, owner)).queue!;
      expect(queue.queued).toBe(0);
      expect(
        queue[status === "archive_failed" ? "archiveFailed" : "unknown"],
      ).toBe(1);
      expect(queue.status).toBe("backlogged");
    }
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
