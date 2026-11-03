import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerWorkspace } from "../../packages/server/src/service";
import { DiskStorage } from "../../packages/server/src/storage";
import { FixtureProvider } from "./fixture-provider";
import { createTemplate } from "../../packages/core/src/workflow";
const url = process.env.TEST_DATABASE_URL!;
let app: ServerWorkspace, provider: FixtureProvider, root: string;
const request = {
  modelKey: "image.flux2.t2i.v1" as const,
  prompt: "测试归档",
  assetIds: [],
  parameters: {},
};
describe("real PostgreSQL task and archive closure", () => {
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.startsWith("/aivideo_test"))
      throw new Error("isolated test database required");
    root = await mkdtemp(join(tmpdir(), "aivideo-archive-"));
    provider = new FixtureProvider();
    app = new ServerWorkspace(url, new DiskStorage(root), provider);
    await app.ensureOwner("alice");
    await app.ensureOwner("bob");
  });
  afterAll(async () => {
    // These cases call execute directly; their test-only outbox rows must not be
    // picked up by a later suite with a different private storage directory.
    if (app)
      await app.sql`delete from job_outbox where job_id in (select id from jobs where owner_user_id in ('alice','bob'))`;
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("atomically deduplicates submissions and stores the dispatch record", async () => {
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      app.createJob("alice", { request }, key),
      app.createJob("alice", { request }, key),
    ]);
    expect(a.id).toBe(b.id);
    expect(await app.pendingDispatches()).toContainEqual(
      expect.objectContaining({ jobId: a.id }),
    );
    await expect(
      app.createJob(
        "alice",
        { request: { ...request, prompt: "different" } },
        key,
      ),
    ).rejects.toThrow("幂等");
  });
  it("archives real fixture bytes, survives service reconstruction and isolates owners", async () => {
    const task = await app.createJob("alice", { request });
    await app.execute(task.id);
    const done = await app.getJob("alice", task.id);
    expect(done.status).toBe("succeeded");
    expect(done.outputAssetIds).toHaveLength(1);
    const asset = await app.getAsset("alice", done.outputAssetIds[0]);
    expect(asset.bytes).toBeGreaterThan(0);
    expect((await app.storage.read(asset.objectKey)).bytes.length).toBe(
      asset.bytes,
    );
    await expect(app.getJob("bob", task.id)).rejects.toThrow("不存在");
    await expect(app.getAsset("bob", asset.id)).rejects.toThrow("不存在");
    const restored = new ServerWorkspace(url, new DiskStorage(root), provider);
    expect((await restored.getJob("alice", task.id)).outputAssetIds).toEqual(
      done.outputAssetIds,
    );
    await restored.close();
  });
  it("retries archive without submitting a second provider generation", async () => {
    const task = await app.createJob("alice", { request });
    const original = app.storage.put.bind(app.storage);
    let failures = 1;
    app.storage.put = async (...args) => {
      if (failures-- > 0) throw new Error("disk unavailable");
      return original(...args);
    };
    await app.execute(task.id);
    expect((await app.getJob("alice", task.id)).status).toBe("archive_failed");
    const count = provider.submissions;
    await app.act("alice", task.id, "retry-archive");
    await app.execute(task.id);
    expect((await app.getJob("alice", task.id)).status).toBe("succeeded");
    expect(provider.submissions).toBe(count);
    app.storage.put = original;
  });
  it("keeps archived media and reports a deleted source task without a dangling link", async () => {
    const task = await app.createJob("alice", { request });
    await app.execute(task.id);
    const done = await app.getJob("alice", task.id);
    const id = done.outputAssetIds[0];
    expect((await app.getAsset("alice", id)).sourceJobAvailable).toBe(true);
    await app.act("alice", task.id, "delete");
    const retained = await app.getAsset("alice", id);
    expect(retained.sourceJobId).toBe(task.id);
    expect(retained.sourceJobAvailable).toBe(false);
    expect((await app.storage.read(retained.objectKey)).bytes.length).toBe(
      retained.bytes,
    );
  });
  it("keeps late completed results when cancellation races with completion", async () => {
    provider.beforePoll = async () => {
      await app.act("alice", task.id, "cancel");
    };
    const task = await app.createJob("alice", { request });
    await app.execute(task.id);
    provider.beforePoll = undefined;
    expect((await app.getJob("alice", task.id)).status).toBe("succeeded");
    expect(
      (await app.getJob("alice", task.id)).events.some((e) =>
        e.message.includes("取消"),
      ),
    ).toBe(true);
  });
  it("never automatically resubmits an uncertain submission", async () => {
    provider.failSubmit = true;
    const task = await app.createJob("alice", { request });
    await app.execute(task.id);
    expect((await app.getJob("alice", task.id)).status).toBe("unknown");
    const count = provider.submissions;
    await app.execute(task.id);
    await expect(app.act("alice", task.id, "retry")).rejects.toThrow("核对");
    await app.act("alice", task.id, "reconcile");
    await app.execute(task.id);
    expect(provider.submissions).toBe(count);
    provider.failSubmit = false;
  });

  it("deduplicates normalized callbacks and preserves completed provider state", async () => {
    const task = await app.createJob("alice", { request });
    provider.beforePoll = async () => {
      throw new Error("temporary query failure");
    };
    // Record a submitted checkpoint without waiting for a live external API.
    const key = `${task.id}:${task.idempotencyKey}`,
      requestId = "image:" + crypto.randomUUID();
    await app.sql`insert into provider_operations(key,job_id,provider,state,request_id) values(${key},${task.id},${provider.id},'submitted',${requestId})`;
    const state = await provider.poll(requestId).catch(() => ({
      status: "succeeded" as const,
      outputs: [
        {
          key: "fixture-output",
          name: "fixture.png",
          kind: "image" as const,
          mime: "image/png",
        },
      ],
    }));
    provider.beforePoll = undefined;
    const eventId = crypto.randomUUID();
    expect(
      await app.recordProviderEvent(provider.id, eventId, requestId, state),
    ).toEqual({ duplicate: false });
    expect(
      await app.recordProviderEvent(provider.id, eventId, requestId, state),
    ).toEqual({ duplicate: true });
    await app.recordProviderEvent(provider.id, crypto.randomUUID(), requestId, {
      status: "failed",
    });
    const count = provider.submissions;
    await app.execute(task.id);
    expect((await app.getJob("alice", task.id)).status).toBe("succeeded");
    expect(provider.submissions).toBe(count);
  });
  it("isolates identical client keys across owners and provider checkpoints", async () => {
    const key = crypto.randomUUID();
    const alice = await app.createJob("alice", { request }, key);
    const bob = await app.createJob("bob", { request }, key);
    await app.execute(alice.id);
    await app.execute(bob.id);
    const a = await app.getJob("alice", alice.id),
      b = await app.getJob("bob", bob.id);
    expect(a.outputAssetIds).toHaveLength(1);
    expect(b.outputAssetIds).toHaveLength(1);
    expect(a.outputAssetIds[0]).not.toBe(b.outputAssetIds[0]);
    const ops =
      await app.sql`select request_id from provider_operations where job_id in (${alice.id},${bob.id})`;
    expect(new Set(ops.map((o) => o.request_id)).size).toBe(2);
  });
  it("confirms provider cancellation and deduplicates an explicit retry action", async () => {
    const poll = provider.poll.bind(provider);
    provider.poll = async () => ({ status: "cancelled" });
    const task = await app.createJob("alice", { request });
    try {
      await app.execute(task.id);
    } finally {
      provider.poll = poll;
    }
    expect((await app.getJob("alice", task.id)).status).toBe("cancelled");
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([
      app.act("alice", task.id, "retry", key),
      app.act("alice", task.id, "retry", key),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.groupId).toBe(task.groupId);
    expect(a.attempt).toBe(2);
    await app.execute(a.id);
    expect((await app.getJob("alice", a.id)).status).toBe("succeeded");
  });
  it("records a failed callback without polling or resubmitting it", async () => {
    const task = await app.createJob("alice", { request }),
      key = `${task.id}:${task.idempotencyKey}`,
      requestId = "image:" + crypto.randomUUID();
    await app.sql`insert into provider_operations(key,job_id,provider,state,request_id) values(${key},${task.id},${provider.id},'submitted',${requestId})`;
    const state = {
      status: "failed" as const,
      error: { code: "FIXTURE_FAILURE", message: "fixture provider failed" },
    };
    const eventId = crypto.randomUUID();
    await app.recordProviderEvent(provider.id, eventId, requestId, state);
    await expect(
      app.recordProviderEvent(provider.id, eventId, requestId, {
        status: "cancelled",
      }),
    ).rejects.toThrow("重复事件");
    const count = provider.submissions;
    await app.execute(task.id);
    expect((await app.getJob("alice", task.id)).error?.code).toBe(
      "FIXTURE_FAILURE",
    );
    expect(provider.submissions).toBe(count);
  });
  it("retains the frozen workflow for retries after its saved draft is removed", async () => {
    const graph = createTemplate("image-video");
    await app.saveWorkflow("alice", graph);
    const task = await app.createJob("alice", {
      graph,
      mode: "dry-run",
      workflowVersion: 1,
    });
    await app.act("alice", task.id, "cancel");
    const count = provider.submissions;
    await app.execute(task.id);
    expect(provider.submissions).toBe(count);
    await app.removeResource("alice", "workflows", graph.id);
    const retry = await app.act("alice", task.id, "retry");
    for (let i = 0; i < 3; i++) await app.execute(retry.id);
    const done = await app.getJob("alice", retry.id);
    expect(done.status).toBe("succeeded");
    expect(done.workflowVersion).toBe(1);
    expect(done.outputAssetIds).toEqual([]);
  });
  it("retries a workflow archive at the failed node while retaining upstream assets", async () => {
    const graph = createTemplate("image-video"),
      task = await app.createJob("alice", { graph, mode: "provider" });
    await app.execute(task.id);
    await app.execute(task.id);
    const upstream = (await app.getJob("alice", task.id)).outputAssetIds;
    expect(upstream).toHaveLength(1);
    const put = app.storage.put.bind(app.storage);
    app.storage.put = async () => {
      throw new Error("storage offline");
    };
    try {
      await app.execute(task.id);
    } finally {
      app.storage.put = put;
    }
    const failed = await app.getJob("alice", task.id);
    expect(failed.status).toBe("archive_failed");
    expect(failed.outputAssetIds).toEqual(upstream);
    const count = provider.submissions;
    await app.act("alice", task.id, "retry-archive");
    await app.execute(task.id);
    const done = await app.getJob("alice", task.id);
    expect(done.status).toBe("succeeded");
    expect(done.outputAssetIds).toHaveLength(2);
    expect(done.outputAssetIds[0]).toBe(upstream[0]);
    expect(provider.submissions).toBe(count);
  });
  it("serializes cancellation with the final submission checkpoint", async () => {
    for (let i = 0; i < 10; i++) {
      const task = await app.createJob("alice", { request });
      await Promise.all([
        app.execute(task.id),
        app.act("alice", task.id, "cancel"),
      ]);
      await app.execute(task.id);
      const done = await app.getJob("alice", task.id);
      expect(["cancelled", "succeeded"]).toContain(done.status);
      const ops =
        await app.sql`select key from provider_operations where job_id=${task.id}`;
      if (done.status === "cancelled") expect(ops).toHaveLength(0);
      else expect(done.outputAssetIds).toHaveLength(1);
    }
  });
});
