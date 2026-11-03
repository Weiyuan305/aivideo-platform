import {
  mkdir,
  open,
  rename,
  unlink,
  readFile,
  readdir,
} from "node:fs/promises";
import { resolve, sep, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Upload } from "@aws-sdk/lib-storage";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ServiceError } from "./types";
export interface StoredBytes {
  bytes: number;
  sha256: string;
}
export interface ObjectStorage {
  put(
    key: string,
    source: AsyncIterable<Uint8Array>,
    limit: number,
  ): Promise<StoredBytes>;
  read(key: string): Promise<{ bytes: Uint8Array }>;
  stream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<AsyncIterable<Uint8Array>>;
  remove(key: string): Promise<void>;
  inputURL?(key: string): Promise<string>;
  assertEmpty?(): Promise<void>;
}
function validKey(key: string) {
  if (
    !/^[a-zA-Z0-9/_-]+$/.test(key) ||
    key.split("/").some((p) => !p || p === "..")
  )
    throw new ServiceError("INVALID_OBJECT_KEY", "无效文件标识");
}
export class DiskStorage implements ObjectStorage {
  constructor(private root: string) {}
  async assertEmpty() {
    if (!isAbsolute(this.root)) throw new Error("恢复存储必须使用绝对路径");
    try {
      if ((await readdir(this.root)).length)
        throw new Error("恢复目标存储必须为空");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  private path(key: string) {
    validKey(key);
    const base = resolve(this.root),
      target = resolve(base, key);
    if (!target.startsWith(base + sep)) throw new Error("非法存储路径");
    return target;
  }
  async put(key: string, source: AsyncIterable<Uint8Array>, limit: number) {
    const target = this.path(key);
    await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
    const tmp = target + "." + randomUUID() + ".part";
    const file = await open(tmp, "wx", 0o600),
      hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of source) {
        bytes += chunk.byteLength;
        if (bytes > limit)
          throw new ServiceError("FILE_TOO_LARGE", "文件超过允许大小", 413);
        hash.update(chunk);
        await file.writeFile(chunk);
      }
      if (!bytes) throw new ServiceError("EMPTY_FILE", "文件不能为空");
      await file.sync();
      await file.close();
      await rename(tmp, target);
      return { bytes, sha256: hash.digest("hex") };
    } catch (e) {
      await file.close().catch(() => {});
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
  async read(key: string) {
    return { bytes: new Uint8Array(await readFile(this.path(key))) };
  }
  async stream(key: string, range?: { start: number; end: number }) {
    const file = await open(this.path(key), "r");
    return file.createReadStream({ autoClose: true, ...range });
  }
  async remove(key: string) {
    await unlink(this.path(key)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
export class S3Storage implements ObjectStorage {
  private client: S3Client;
  async assertEmpty() {
    const result = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }),
    );
    if (result.KeyCount !== 0 || result.IsTruncated || result.Contents?.length)
      throw new Error("恢复目标 S3 bucket 必须为空");
  }
  constructor(
    private bucket: string,
    config: {
      endpoint?: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
  ) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 5000, requestTimeout: 60000 },
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  async put(key: string, source: AsyncIterable<Uint8Array>, limit: number) {
    validKey(key);
    let bytes = 0;
    const hash = createHash("sha256");
    const body = Readable.from(
      (async function* () {
        for await (const c of source) {
          bytes += c.length;
          if (bytes > limit)
            throw new ServiceError("FILE_TOO_LARGE", "文件超过允许大小", 413);
          hash.update(c);
          yield c;
        }
        if (!bytes) throw new ServiceError("EMPTY_FILE", "文件不能为空");
      })(),
    );
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: body },
      queueSize: 1,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    }).done();
    return { bytes, sha256: hash.digest("hex") };
  }

  async stream(key: string, range?: { start: number; end: number }) {
    validKey(key);
    const value = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }),
    );
    if (!value.Body) throw new Error("存储文件不存在");
    return value.Body as AsyncIterable<Uint8Array>;
  }
  async read(key: string) {
    const chunks = [];
    for await (const c of await this.stream(key)) chunks.push(c);
    return { bytes: new Uint8Array(Buffer.concat(chunks)) };
  }
  async remove(key: string) {
    validKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  async inputURL(key: string) {
    validKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 900 },
    );
  }
}
export const maxBytes = (kind: string) =>
  (({ image: 20, audio: 30, video: 100 })[kind] ?? 0) * 1024 * 1024;
export function storageFromEnv(env: NodeJS.ProcessEnv): ObjectStorage {
  if (env.S3_BUCKET) {
    for (const key of ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
      if (!env[key]) throw new Error(`缺少 ${key}`);
    return new S3Storage(env.S3_BUCKET, {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || "auto",
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    });
  }
  if (!env.PRIVATE_STORAGE_ROOT)
    throw new Error("请配置 PRIVATE_STORAGE_ROOT 或 S3_BUCKET");
  if (!isAbsolute(env.PRIVATE_STORAGE_ROOT))
    throw new Error(
      "PRIVATE_STORAGE_ROOT 必须是绝对路径，供 Web 和 worker 共用",
    );
  return new DiskStorage(env.PRIVATE_STORAGE_ROOT);
}

/** Verify file signatures before storing declared media; no decoding/inference service. */
export async function* checkedMedia(
  source: AsyncIterable<Uint8Array>,
  mime: string,
) {
  const iterator = source[Symbol.asyncIterator](),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 16) {
    const n = await iterator.next();
    if (n.done) break;
    chunks.push(n.value);
    size += n.value.length;
  }
  const bytes = Buffer.concat(chunks),
    ascii = bytes.toString("latin1");
  const valid =
    mime === "image/png"
      ? bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === "image/webp"
          ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP"
          : ["audio/wav", "audio/x-wav"].includes(mime)
            ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE"
            : ["audio/mpeg", "audio/mp3"].includes(mime)
              ? ascii.startsWith("ID3") ||
                (bytes[0] === 255 && (bytes[1] & 224) === 224)
              : mime === "audio/ogg"
                ? ascii.startsWith("OggS")
                : ["audio/webm", "video/webm"].includes(mime)
                  ? bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]))
                  : mime === "video/mp4"
                    ? ascii.slice(4, 8) === "ftyp"
                    : false;
  if (!valid) {
    await iterator.return?.();
    throw new ServiceError("INVALID_MEDIA", "文件内容与声明的媒体格式不匹配");
  }
  try {
    for (const c of chunks) yield c;
    for (;;) {
      const n = await iterator.next();
      if (n.done) break;
      yield n.value;
    }
  } finally {
    await iterator.return?.();
  }
}

/** Cap a provider download without buffering an entire video in memory. */
export async function* boundedSource(
  source: AsyncIterable<Uint8Array>,
  timeoutMs = 60000,
) {
  const iterator = source[Symbol.asyncIterator]();
  const deadline = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("归档下载超时");
      const item = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("归档下载超时")),
            remaining,
          );
        }),
      ]);
      clearTimeout(timer);
      if (item.done) break;
      yield item.value;
    }
  } finally {
    clearTimeout(timer);
    // A hung upstream iterator must not hold the worker forever during cleanup.
    void iterator.return?.().catch(() => {});
    if (source instanceof Readable) source.destroy();
  }
}

export async function* webChunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      yield item.value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
