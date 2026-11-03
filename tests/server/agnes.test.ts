import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerWorkspace } from "../../packages/server/src/service";
import { DiskStorage } from "../../packages/server/src/storage";
import { AgnesProvider } from "../../packages/server/src/agnes";

const url = process.env.TEST_DATABASE_URL!;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
  "base64",
);
describe("Agnes durable synchronous result and error closure", () => {
  let app: ServerWorkspace,
    root: string,
    calls = 0,
    status = 200,
    queueFull = false,
    failDownload = false;
  const owner = "agnes-test-" + crypto.randomUUID();
  const request = {
    modelKey: "image.agnes-2.5.t2i.v1" as const,
    prompt: "cup",
    assetIds: [],
    parameters: {},
  };
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.startsWith("/aivideo_test"))
      throw new Error("isolated test database required");
    root = await mkdtemp(join(tmpdir(), "aivideo-agnes-"));
    const storage = new DiskStorage(root);
    const provider = new AgnesProvider({
      key: "fixture-not-a-real-key",
      storage,
      referenceURL: async () => undefined,
      validateURL: async (url) => url,
      fetch: async (url, init) => {
        if (init?.method === "POST") {
          calls++;
          return Response.json(
            queueFull
              ? {
                  error: { message: "image queue is full, please retry later" },
                }
              : { data: [{ url: "https://media.example/image.png" }] },
            { status },
          );
        }
        if (failDownload) throw new Error("storage unavailable");
        return new Response(png, { headers: { "content-type": "image/png" } });
      },
    });
    app = new ServerWorkspace(url, storage, provider);
    await app.ensureOwner(owner);
  });
  afterAll(async () => {
    if (app)
      await app.sql`delete from job_outbox where job_id in (select id from jobs where owner_user_id=${owner})`;
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("persists synchronous image output before archival and retries only the download", async () => {
    failDownload = true;
    const job = await app.createJob(owner, { request });
    await app.execute(job.id);
    expect((await app.getJob(owner, job.id)).status).toBe("archive_failed");
    const [operation] =
      await app.sql`select * from provider_operations where job_id=${job.id}`;
    expect(operation.state).toBe("generated");
    expect(operation.outputs[0].url).toBe("https://media.example/image.png");
    const count = calls;
    failDownload = false;
    await app.act(owner, job.id, "retry-archive");
    await app.execute(job.id);
    const done = await app.getJob(owner, job.id);
    expect(done.status).toBe("succeeded");
    expect(calls).toBe(count);
    const asset = await app.getAsset(owner, done.outputAssetIds[0]);
    expect(
      Buffer.from((await app.storage.read(asset.objectKey)).bytes),
    ).toEqual(png);
  });
  it("records a definitive 401 as failed while a 502 stays unknown and cannot be resubmitted", async () => {
    for (const code of [401, 502]) {
      status = code;
      const job = await app.createJob(owner, { request });
      await app.execute(job.id);
      const done = await app.getJob(owner, job.id);
      expect(done.status).toBe(code === 401 ? "failed" : "unknown");
      const count = calls;
      await app.execute(job.id);
      if (code === 502) {
        await expect(app.act(owner, job.id, "retry")).rejects.toThrow("核对");
        await app.act(owner, job.id, "reconcile");
        await app.execute(job.id);
      }
      expect(calls).toBe(count);
    }
    status = 200;
  });
  it("records explicit queue rejection and completes only after a manual retry", async () => {
    status = 503;
    queueFull = true;
    const job = await app.createJob(owner, { request });
    await app.execute(job.id);
    const failed = await app.getJob(owner, job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("AGNES_QUEUE_FULL");
    const count = calls;
    await app.execute(job.id);
    expect(calls).toBe(count);
    status = 200;
    queueFull = false;
    const retry = await app.act(owner, job.id, "retry");
    await app.execute(retry.id);
    const done = await app.getJob(owner, retry.id);
    expect(done.attempt).toBe(failed.attempt + 1);
    expect(done.status).toBe("succeeded");
    expect(done.outputAssetIds).toHaveLength(1);
    expect(calls).toBe(count + 1);
  });
  it("keeps reserved models blocked without creating an external operation", async () => {
    const count = calls;
    const job = await app.createJob(owner, {
      request: { ...request, modelKey: "image.flux2.t2i.v1" },
    });
    await app.execute(job.id);
    expect((await app.getJob(owner, job.id)).status).toBe("blocked");
    const operations =
      await app.sql`select key from provider_operations where job_id=${job.id}`;
    expect(operations).toHaveLength(0);
    expect(calls).toBe(count);
  });
});
