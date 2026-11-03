import { beforeAll, afterAll, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ServerWorkspace,
  ProductionWorkspace,
  DiskStorage,
} from "../../packages/server/src/index";
import {
  createBackup,
  verifyBackup,
  restoreBackup,
} from "../../packages/server/src/ops/backup";
import { FixtureProvider } from "./fixture-provider";
import { createTemplate } from "../../packages/core/src/workflow";
import { s3Fixture } from "./s3-fixture";
import { OpsStore } from "../../packages/server/src/ops/state";
import { Monitor, collectSignals } from "../../packages/server/src/ops/monitor";
const base = process.env.TEST_DATABASE_URL!;
if (!base || !new URL(base).pathname.startsWith("/aivideo_test"))
  throw new Error("isolated test database required");
const pgBinDir = process.env.PG_BIN_DIR;
let root: string, app: ServerWorkspace, admin: ServerWorkspace;
const databases: string[] = [];
function databaseURL(name: string) {
  const u = new URL(base);
  u.pathname = "/" + name;
  return u.toString();
}
const sourceName =
  "aivideo_test_backup_" + crypto.randomUUID().replaceAll("-", "");
const sourceURL = databaseURL(sourceName);
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "aivideo-backup-"));
  admin = new ServerWorkspace(base, new DiskStorage(join(root, "admin")));
  await admin.sql`create database ${admin.sql(sourceName)}`;
  databases.push(sourceName);
  await promisify(execFile)(
    process.execPath,
    ["node_modules/drizzle-kit/bin.cjs", "migrate"],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: sourceURL } },
  );
  app = new ServerWorkspace(
    sourceURL,
    new DiskStorage(join(root, "source")),
    new FixtureProvider(),
  );
  await app.ensureOwner("backup-owner");
  await app.ensureOwner("other-owner");
}, 60000);
afterAll(async () => {
  await app?.close();
  if (admin) {
    for (const name of databases)
      await admin.sql`drop database if exists ${admin.sql(name)} with (force)`;
    await admin.close();
  }
  if (root) await rm(root, { recursive: true, force: true });
});
const request = {
  modelKey: "image.flux2.t2i.v1" as const,
  prompt: "恢复后的图片",
  assetIds: [],
  parameters: {},
};
let directory: string;
it("restores an actual database dump and all referenced media, then reuses assets and resumes durable jobs", async () => {
  for (const modelKey of [
    "image.flux2.t2i.v1",
    "video.kling-o3.t2v.v1",
  ] as const) {
    const task = await app.createJob("backup-owner", {
      request: { ...request, modelKey },
    });
    await app.execute(task.id);
  }
  const audio = await app.upload(
    "backup-owner",
    new File([Buffer.from("RIFF0000WAVEfmt fixture")], "reference.wav", {
      type: "audio/wav",
    }),
  );
  await app.saveVoice("backup-owner", {
    id: crypto.randomUUID(),
    name: "恢复参考声",
    assetId: audio.id,
    createdAt: new Date().toISOString(),
  });
  const clone = await app.createJob("backup-owner", {
    request: {
      ...request,
      modelKey: "voice.indextts2.clone.v1",
      assetIds: [audio.id],
    },
  });
  await app.execute(clone.id);
  await app.saveWorkflow("backup-owner", createTemplate("image-video"));
  const pending = await app.createJob("backup-owner", { request });
  await app.sql`update job_outbox set delivered=true where job_id=${pending.id}`;
  const production = new ProductionWorkspace(app);
  const project = await production.create(
    "backup-owner",
    crypto.randomUUID(),
    "备份项目",
  );
  const reference = (await app.listAssets("backup-owner")).find(
    (a) => a.kind === "image",
  )!;
  const savedProject = await production.change(
    "backup-owner",
    project.id,
    project.revision,
    {
      type: "definition.save",
      id: crypto.randomUUID(),
      kind: "character",
      input: {
        name: "恢复角色",
        description: "固定设定",
        assetIds: [reference.id],
      },
    },
  );
  const originalStream = app.storage.stream.bind(app.storage);
  let inserted = false;
  const imageBytes = (
    await app.storage.read(
      (await app.listAssets("backup-owner")).find((a) => a.kind === "image")!
        .objectKey,
    )
  ).bytes;
  app.storage.stream = async (key, range) => {
    if (!inserted) {
      inserted = true;
      await app.upload(
        "backup-owner",
        new File(
          [imageBytes as Uint8Array<ArrayBuffer>],
          "after-snapshot.png",
          { type: "image/png" },
        ),
      );
    }
    return originalStream(key, range);
  };
  const manifest = await createBackup(app, sourceURL, {
    root: join(root, "backups"),
    stateRoot: join(root, "state"),
    pgBinDir,
  });
  app.storage.stream = originalStream;
  directory = join(root, "backups", manifest.id);
  expect((await verifyBackup(directory)).objects).toHaveLength(4);
  expect(await app.listAssets("backup-owner")).toHaveLength(5);
  const restoredName =
    "aivideo_test_restore_" + crypto.randomUUID().replaceAll("-", "");
  const restoredURL = databaseURL(restoredName),
    storage = new DiskStorage(join(root, "restored"));
  databases.push(restoredName);
  const report = await restoreBackup(directory, {
    databaseURL: restoredURL,
    storage,
    pgBinDir,
  });
  expect(report.assets).toBe(4);
  const restored = new ServerWorkspace(
    restoredURL,
    storage,
    new FixtureProvider(),
  );
  try {
    expect(await restored.listLibrary("backup-owner", "voices")).toHaveLength(
      1,
    );
    expect(
      await restored.listLibrary("backup-owner", "workflows"),
    ).toHaveLength(1);
    expect(await restored.listAssets("other-owner")).toHaveLength(0);
    expect(
      await new ProductionWorkspace(restored).get("backup-owner", project.id),
    ).toEqual(savedProject);
    await expect(
      restored.removeResource("backup-owner", "assets", reference.id),
    ).rejects.toMatchObject({ code: "RESOURCE_IN_USE" });

    for (const asset of await restored.listAssets("backup-owner"))
      expect((await storage.read(asset.objectKey)).bytes.length).toBe(
        asset.bytes,
      );
    expect(await restored.pendingDispatches()).toContainEqual(
      expect.objectContaining({ jobId: pending.id }),
    );
    await restored.execute(pending.id);
    expect((await restored.getJob("backup-owner", pending.id)).status).toBe(
      "succeeded",
    );
    const image = (await restored.listAssets("backup-owner")).find(
      (a) => a.kind === "image",
    )!;
    const reused = await restored.createJob("backup-owner", {
      request: {
        ...request,
        modelKey: "image.flux2.edit.v1",
        assetIds: [image.id],
      },
    });
    await restored.execute(reused.id);
    expect((await restored.getJob("backup-owner", reused.id)).status).toBe(
      "succeeded",
    );
    expect(await restored.sql`select * from worker_heartbeats`).toHaveLength(0);
    expect(
      await restored.sql`select * from drizzle.__drizzle_migrations`,
    ).not.toHaveLength(0);
  } finally {
    await restored.close();
  }
  await expect(
    restoreBackup(directory, {
      databaseURL: sourceURL,
      storage: new DiskStorage(join(root, "forbidden")),
      pgBinDir,
    }),
  ).rejects.toThrow();
  await expect(
    restoreBackup(directory, {
      databaseURL: restoredURL,
      storage: new DiskStorage(join(root, "forbidden2")),
      pgBinDir,
    }),
  ).rejects.toThrow();
  const nonempty = join(root, "nonempty");
  await writeFile(nonempty, "occupied");
  const forbiddenName =
    "aivideo_test_restore_" + crypto.randomUUID().replaceAll("-", "");
  await expect(
    restoreBackup(directory, {
      databaseURL: databaseURL(forbiddenName),
      storage: new DiskStorage(nonempty),
      pgBinDir,
    }),
  ).rejects.toThrow();
  expect(
    await admin.sql`select datname from pg_database where datname=${forbiddenName}`,
  ).toHaveLength(0);
});
it("restores to an empty S3-compatible bucket, reads every object back and backs up the restored S3 workspace", async () => {
  const fixture = await s3Fixture(),
    name = "aivideo_test_restore_" + crypto.randomUUID().replaceAll("-", "");
  databases.push(name);
  const storage = fixture.storage("restored-bucket");
  let restored: ServerWorkspace | undefined;
  try {
    const manifest = await verifyBackup(directory);
    await restoreBackup(directory, {
      databaseURL: databaseURL(name),
      storage,
      pgBinDir,
    });
    await expect(storage.assertEmpty()).rejects.toThrow();
    for (const item of manifest.objects)
      expect((await storage.read(item.key)).bytes.length).toBe(item.bytes);
    restored = new ServerWorkspace(databaseURL(name), storage);
    const roundtrip = await createBackup(restored, databaseURL(name), {
      root: join(root, "s3-backup"),
      stateRoot: join(root, "s3-state"),
      pgBinDir,
    });
    expect(roundtrip.objects).toEqual(manifest.objects);
    expect(
      (await verifyBackup(join(root, "s3-backup", roundtrip.id))).objects,
    ).toHaveLength(4);
  } finally {
    await restored?.close();
    await fixture.close();
  }
});
it("rejects corrupted media/dumps and never publishes an incomplete backup", async () => {
  const manifest = await verifyBackup(directory),
    file = join(directory, "objects", manifest.objects[0].key);
  const bytes = await readFile(file);
  await writeFile(file, "corrupted");
  await expect(verifyBackup(directory)).rejects.toThrow();
  await writeFile(file, bytes);
  const dump = join(directory, "database.dump"),
    original = await readFile(dump);
  await writeFile(dump, "corrupted");
  await expect(verifyBackup(directory)).rejects.toThrow();
  await writeFile(dump, original);
  const asset = (await app.listAssets("backup-owner"))[0];
  await app.storage.remove(asset.objectKey);
  await expect(
    createBackup(app, sourceURL, {
      root: join(root, "failed"),
      stateRoot: join(root, "state"),
      pgBinDir,
    }),
  ).rejects.toThrow();
  expect(await readdir(join(root, "failed"))).toHaveLength(0);
});
it("records a backup destination failure outside that destination and preserves the last successful backup", async () => {
  const blocker = join(root, "backup-blocker");
  await writeFile(blocker, "not a directory");
  const store = new OpsStore(join(root, "state")),
    before = (await store.read()).backup.lastSuccessAt;
  await store.change((s) => {
    s.backup.status = "succeeded";
  });
  await expect(
    createBackup(app, sourceURL, {
      root: blocker,
      stateRoot: store.root,
      pgBinDir,
    }),
  ).rejects.toThrow();
  expect((await store.read()).backup.status).toBe("failed");
  expect((await store.read()).backup.lastSuccessAt).toBe(before);
  const monitor = new Monitor({
    store,
    collect: () =>
      collectSignals(app, {
        healthURL: "http://127.0.0.1:1/api/health",
        store,
      }),
  });
  await monitor.tick();
  await monitor.tick();
  expect(
    (await store.read()).incidents.find((i) => i.component === "backup")
      ?.resolvedAt,
  ).toBeUndefined();
  expect(
    (await store.read()).incidents.some((i) => i.component === "backup"),
  ).toBe(true);
  const manifest = await verifyBackup(directory);
  for (const asset of await app.listAssets("backup-owner")) {
    try {
      await app.storage.read(asset.objectKey);
    } catch {
      const copy = manifest.objects.find((o) => o.sha256 === asset.sha256)!;
      const bytes = await readFile(join(directory, "objects", copy.key));
      await app.storage.put(
        asset.objectKey,
        (async function* () {
          yield bytes;
        })(),
        asset.bytes,
      );
    }
  }
  await createBackup(app, sourceURL, {
    root: join(root, "recovered"),
    stateRoot: store.root,
    pgBinDir,
  });
  await monitor.tick();
  await monitor.tick();
  expect(
    (await store.read()).incidents.find((i) => i.component === "backup")
      ?.resolvedAt,
  ).toBeTruthy();
});
