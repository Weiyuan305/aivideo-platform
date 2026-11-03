import { beforeAll, afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ServerWorkspace, DiskStorage } from "../../packages/server/src/index";
import { FixtureProvider } from "./fixture-provider";
import { createTask } from "../../packages/core/src/tasks";
import { createTemplate } from "../../packages/core/src/workflow";
import { workflowFromImage } from "../../packages/core/src/media-reuse";
const url = process.env.TEST_DATABASE_URL!;
const owner = "pages-" + crypto.randomUUID();
let app: ServerWorkspace, root: string;
beforeAll(async () => {
  if (!new URL(url).pathname.startsWith("/aivideo_test"))
    throw new Error("test DB required");
  root = await mkdtemp(join(tmpdir(), "aivideo-pages-"));
  app = new ServerWorkspace(url, new DiskStorage(root), new FixtureProvider());
  await app.ensureOwner(owner);
  const rows = Array.from({ length: 520 }, (_, i) => {
    const task =
      i % 10 === 0
        ? createTask({
            graph: { ...createTemplate("image-video"), name: "分页验收试运行" },
            mode: "dry-run",
          })
        : createTask({
            request: {
              modelKey: "image.flux2.t2i.v1",
              prompt: `分页验收 ${i} ${i === 1 ? "literal_%" : ""}`,
              assetIds: [],
              parameters: {},
            },
          });
    return {
      id: task.id,
      owner_user_id: owner,
      idempotency_key: task.idempotencyKey,
      fingerprint: task.id,
      status: task.status,
      payload: JSON.parse(JSON.stringify(task)),
    };
  });
  await app.sql`insert into jobs ${app.sql(rows, "id", "owner_user_id", "idempotency_key", "fingerprint", "status", "payload")}`;
});
afterAll(async () => {
  if (app)
    await app.sql`delete from job_outbox where job_id in (select id from jobs where owner_user_id=${owner})`;
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
it("paginates beyond 500 with timestamp ties and no duplicates after status changes or new submissions", async () => {
  const first = await app.listJobPage(owner, { limit: 37, q: "分页验收" });
  expect(first.total).toBe(520);
  expect(first.items).toHaveLength(37);
  await app.sql`update jobs set updated_at=now(),status='blocked',payload=jsonb_set(payload,'{status}','"blocked"') where id=${first.items[0].id}`;
  const added = await app.createJob(owner, {
    request: {
      modelKey: "image.flux2.t2i.v1",
      prompt: "分页验收 new",
      assetIds: [],
      parameters: {},
    },
  });
  const ids = first.items.map((t) => t.id);
  let cursor = first.nextCursor;
  while (cursor) {
    const page = await app.listJobPage(owner, {
      limit: 37,
      q: "分页验收",
      cursor,
    });
    ids.push(...page.items.map((t) => t.id));
    cursor = page.nextCursor;
  }
  expect(ids).toHaveLength(520);
  expect(new Set(ids).size).toBe(520);
  expect(ids).not.toContain(added.id);
  expect(
    (await app.listJobPage(owner, { q: "分页验收", mode: "provider" })).total,
  ).toBe(469);
});
it("searches literal wildcard characters and isolates filters and owners in cursors", async () => {
  const page = await app.listJobPage(owner, { q: "literal_%", limit: 1 });
  expect(page.total).toBe(1);
  const first = await app.listJobPage(owner, { limit: 1 });
  await expect(
    app.listJobPage(owner, { q: "changed", cursor: first.nextCursor! }),
  ).rejects.toThrow("游标");
  const other = "other-" + crypto.randomUUID();
  await app.ensureOwner(other);
  expect((await app.listJobPage(other, {})).total).toBe(0);
  await expect(
    app.listJobPage(other, { cursor: first.nextCursor! }),
  ).rejects.toThrow("游标");
  await expect(app.listJobPage(owner, { limit: 501 })).rejects.toThrow();
});
it("finds old assets beyond 500 and executes workflows using their actual reference IDs", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
    "base64",
  );
  const old = await app.upload(
    owner,
    new File([png], "old_reference_%.png", { type: "image/png" }),
  );
  await app.sql`update assets set created_at=now()-interval '1 day' where id=${old.id}`;
  const rows = Array.from({ length: 520 }, () => ({
    id: crypto.randomUUID(),
    owner_user_id: owner,
    name: "page.png",
    kind: "image",
    mime: "image/png",
    bytes: 1,
    object_key: "pages/" + crypto.randomUUID(),
  }));
  await app.sql`insert into assets ${app.sql(rows, "id", "owner_user_id", "name", "kind", "mime", "bytes", "object_key")}`;
  const found = await app.listAssetPage(owner, { q: "old_reference_%" });
  expect(found.total).toBe(1);
  expect(found.items[0].id).toBe(old.id);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await app.listAssetPage(owner, { limit: 83, cursor });
    ids.push(...page.items.map((a) => a.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(521);
  expect(new Set(ids).size).toBe(521);
  const graph = workflowFromImage(old);
  const task = await app.createJob(owner, { graph, mode: "provider" });
  for (let i = 0; i < 4; i++) await app.execute(task.id);
  expect((await app.getJob(owner, task.id)).status).toBe("succeeded");
});
