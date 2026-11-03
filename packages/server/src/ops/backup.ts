import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  lstat,
  realpath,
  chmod,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve, join, sep, isAbsolute } from "node:path";
import postgres from "postgres";
import { backupManifestSchema, type BackupManifest } from "@aivideo/contracts";
import type { ServerWorkspace } from "../service";
import { DiskStorage, type ObjectStorage } from "../storage";
import { OpsStore, fileLock } from "./state";
import { pgTool } from "./pg-tools";

export async function hashFile(path: string) {
  return hashSource(createReadStream(path));
}
async function hashSource(source: AsyncIterable<Uint8Array>) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const c of source) {
    hash.update(c);
    bytes += c.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}
async function privateJSON(path: string, value: unknown) {
  const { open } = await import("node:fs/promises");
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function createBackup(
  app: ServerWorkspace,
  url: string,
  options: { root: string; stateRoot: string; pgBinDir?: string },
) {
  if (!isAbsolute(options.root)) throw new Error("BACKUP_ROOT 必须是绝对路径");
  const store = new OpsStore(options.stateRoot),
    id = randomUUID(),
    directory = join(options.root, id),
    partial = join(options.root, ".partial-" + id);
  const unlock = await fileLock(options.stateRoot, "backup.lock");
  let staged = false;
  try {
    await store.change((s) => {
      s.backup = {
        ...s.backup,
        status: "running",
        lastAttemptAt: new Date().toISOString(),
        message: undefined,
      };
    });
    await mkdir(options.root, { recursive: true, mode: 0o700 });
    await mkdir(partial, { mode: 0o700 });
    staged = true;
    const manifest = await app.sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const [lock] =
          await tx`select pg_try_advisory_xact_lock(hashtextextended('aivideo-consistent-backup',0)) as locked`;
        if (!lock.locked) throw new Error("另一个备份正在运行");
        const [{ snapshot }] =
          await tx`select pg_export_snapshot() as snapshot`;
        const objects: BackupManifest["objects"] = [],
          target = new DiskStorage(join(partial, "objects"));
        // pg_dump and asset enumeration consume exactly the same MVCC snapshot.
        await pgTool(
          "pg_dump",
          url,
          [
            "--format=custom",
            "--no-owner",
            "--no-acl",
            "--schema=public",
            "--schema=drizzle",
            "--exclude-table-data=public.worker_heartbeats",
            "--snapshot=" + snapshot,
            "--file=" + join(partial, "database.dump"),
          ],
          options.pgBinDir,
        );
        await chmod(join(partial, "database.dump"), 0o600);
        for await (const batch of tx`select id,object_key as key,bytes,sha256 from assets order by id`.cursor(
          100,
        )) {
          for (const row of batch) {
            const copied = await target.put(
              row.key,
              await app.storage.stream(row.key),
              row.bytes,
            );
            if (copied.bytes !== row.bytes || copied.sha256 !== row.sha256)
              throw new Error("素材内容校验失败");
            objects.push({
              id: row.id,
              key: row.key,
              bytes: row.bytes,
              sha256: row.sha256,
            });
          }
        }
        return backupManifestSchema.parse({
          version: 1,
          id,
          createdAt: new Date().toISOString(),
          database: await hashFile(join(partial, "database.dump")),
          objects,
        });
      },
    );
    await privateJSON(join(partial, "manifest.json"), manifest);
    await rename(partial, directory);
    await store.change((s) => {
      s.backup = {
        status: "succeeded",
        lastAttemptAt: s.backup.lastAttemptAt,
        lastSuccessAt: new Date().toISOString(),
        backupId: id,
        assetCount: manifest.objects.length,
        bytes:
          manifest.database.bytes +
          manifest.objects.reduce((n, o) => n + o.bytes, 0),
      };
    });
    return manifest;
  } catch {
    if (staged)
      await rm(partial, { recursive: true, force: true }).catch(() => {});
    await store.change((s) => {
      s.backup = {
        ...s.backup,
        status: "failed",
        message: "备份失败，请检查数据库工具、素材完整性和备份磁盘",
      };
    });
    throw new Error("备份失败，未发布不完整备份");
  } finally {
    await unlock();
  }
}
async function ownedFile(root: string, relative: string) {
  const path = resolve(root, relative),
    base = await realpath(root),
    actual = await realpath(path);
  if (!actual.startsWith(base + sep) || !(await lstat(path)).isFile())
    throw new Error("备份路径无效");
  return path;
}
export async function verifyBackup(directory: string): Promise<BackupManifest> {
  const manifestFile = await ownedFile(directory, "manifest.json");
  if ((await lstat(manifestFile)).size > 64 * 1024 * 1024)
    throw new Error("备份清单过大");
  const manifest = backupManifestSchema.parse(
    JSON.parse(await readFile(manifestFile, "utf8")),
  );
  const ids = new Set<string>(),
    keys = new Set<string>();
  for (const item of [
    { ...manifest.database, key: "database.dump", id: "database" },
    ...manifest.objects.map((o) => ({ ...o, key: "objects/" + o.key })),
  ]) {
    if (ids.has(item.id) || keys.has(item.key))
      throw new Error("备份清单包含重复条目");
    ids.add(item.id);
    keys.add(item.key);
    const actual = await hashFile(await ownedFile(directory, item.key));
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256)
      throw new Error("备份哈希或大小校验失败");
  }
  return manifest;
}
export async function restoreBackup(
  directory: string,
  options: {
    databaseURL: string;
    storage: ObjectStorage;
    pgBinDir?: string;
    stateRoot?: string;
  },
) {
  const u = new URL(options.databaseURL),
    name = decodeURIComponent(u.pathname.slice(1));
  if (
    !/^aivideo_(?:test_)?restore_[a-zA-Z0-9_]+$/.test(name) ||
    name.length > 63
  )
    throw new Error("只允许恢复到新的 aivideo_restore_* 数据库");
  const manifest = await verifyBackup(directory);
  if (!options.storage.assertEmpty) throw new Error("目标存储不支持空目标校验");
  const adminURL = new URL(u);
  adminURL.pathname = "/postgres";
  const admin = postgres(adminURL.toString(), {
    max: 1,
    connect_timeout: 3,
    prepare: false,
  });
  const target = postgres(options.databaseURL, {
    max: 1,
    connect_timeout: 3,
    prepare: false,
  });
  let created = false;
  let stage = "目标检查";
  try {
    if (
      (await admin`select datname from pg_database where datname=${name}`)
        .length
    )
      throw new Error("恢复目标数据库已存在，拒绝覆盖");
    await options.storage.assertEmpty();
    await admin`create database ${admin(name)} template template0`;
    created = true;
    stage = "数据库导入";
    // template0 still supplies public; the dump recreates it with app objects.
    // This only runs after CREATE DATABASE succeeds, never on an existing DB.
    await target`drop schema public`;
    await pgTool(
      "pg_restore",
      options.databaseURL,
      [
        "--dbname=" + name,
        "--single-transaction",
        "--exit-on-error",
        "--no-owner",
        "--no-acl",
        join(directory, "database.dump"),
      ],
      options.pgBinDir,
    );
    stage = "素材清单核对";
    const rows =
      await target`select id,object_key as key,bytes,sha256 from assets order by id`;
    if (
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          key: r.key,
          bytes: r.bytes,
          sha256: r.sha256,
        })),
      ) !== JSON.stringify(manifest.objects)
    )
      throw new Error("数据库与素材清单不一致");
    for (const item of manifest.objects) {
      stage = "素材恢复";
      const restored = await options.storage.put(
        item.key,
        createReadStream(await ownedFile(directory, "objects/" + item.key)),
        item.bytes,
      );
      if (restored.sha256 !== item.sha256 || restored.bytes !== item.bytes)
        throw new Error("恢复素材校验失败");
      const readback = await hashSource(await options.storage.stream(item.key));
      if (readback.sha256 !== item.sha256 || readback.bytes !== item.bytes)
        throw new Error("恢复素材读回校验失败");
    }
    // Persistent checkpoints remain authoritative; transient transport is rebuilt.
    stage = "任务调度恢复";
    await target.begin(async (tx) => {
      await tx`truncate worker_heartbeats`;
      await tx`update job_outbox set delivered=false where job_id in (select id from jobs where status in ('queued','running','archiving','reconciling','cancel_requested'))`;
      await tx`insert into job_outbox(job_id) select id from jobs j where status in ('queued','running','archiving','reconciling','cancel_requested') and not exists(select 1 from job_outbox o where o.job_id=j.id)`;
    });
    const report = {
      verifiedAt: new Date().toISOString(),
      backupId: manifest.id,
      assets: manifest.objects.length,
    };
    if (options.stateRoot)
      await new OpsStore(options.stateRoot).change((s) => {
        s.lastRestore = report;
      });
    return report;
  } catch (e) {
    if (created)
      throw new Error(
        `恢复未完成（${stage}），隔离目标已保留；当前工作区未切换`,
        { cause: e },
      );
    throw e;
  } finally {
    await target.end();
    await admin.end();
  }
}
