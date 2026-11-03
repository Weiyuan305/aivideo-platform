import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundedSource, type ObjectStorage } from "./storage";
import { mediaProcess, probeMedia } from "./render";
import { ServiceError, type StoredAsset } from "./types";
type Peaks = { duration: number; peaks: number[] };
const cache = new Map<string, Peaks>();
let active = 0;
// Peaks, not decoded PCM, are sent to the browser. No permanent derivative files.
export async function waveformPeaks(
  asset: StoredAsset,
  storage: ObjectStorage,
  requestSignal: AbortSignal,
): Promise<Peaks> {
  if (asset.kind === "image")
    throw new ServiceError("INVALID_MEDIA", "图片没有音频波形");
  const cached = cache.get(asset.objectKey);
  if (cached) return cached;
  if (active >= 2)
    throw new ServiceError("PREVIEW_BUSY", "波形分析繁忙，请稍后重试", 429);
  active++;
  let root: string | undefined;
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(30000)]);
  try {
    root = await mkdtemp(join(tmpdir(), "aivideo-waveform-"));
    const path = join(root, "input.media");
    await pipeline(
      Readable.from(boundedSource(await storage.stream(asset.objectKey))),
      createWriteStream(path, { mode: 0o600 }),
      { signal },
    );
    const info = await probeMedia(path, signal);
    const duration = Number(info.format.duration);
    if (!info.streams.some((s) => s.codec_type === "audio"))
      throw new ServiceError("NO_AUDIO", "此素材没有音轨");
    if (!Number.isFinite(duration) || duration <= 0 || duration > 600)
      throw new ServiceError(
        "WAVEFORM_LIMIT",
        "波形预览支持 10 分钟以内音频，仍可使用时间字段裁剪",
      );
    const pcm = join(root, "audio.pcm");
    await mediaProcess(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,wav,mp3,ogg",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-t",
        "600",
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "s16le",
        pcm,
      ],
      signal,
    );
    const data = await readFile(pcm);
    const peaks: number[] = [];
    // 50 samples/second, <= 30,000 points and <= 9.6 MB temporary decoded audio.
    for (let i = 0; i < data.length; i += 320) {
      let peak = 0;
      for (let j = i; j + 1 < Math.min(i + 320, data.length); j += 2)
        peak = Math.max(peak, Math.abs(data.readInt16LE(j)) / 32768);
      peaks.push(Math.round(peak * 10000) / 10000);
    }
    const result = { duration, peaks };
    if (cache.size >= 24) cache.delete(cache.keys().next().value!);
    cache.set(asset.objectKey, result);
    return result;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(
      "WAVEFORM_FAILED",
      "音频波形分析失败，请检查素材或重试",
      503,
    );
  } finally {
    active--;
    if (root) await rm(root, { recursive: true, force: true });
  }
}
