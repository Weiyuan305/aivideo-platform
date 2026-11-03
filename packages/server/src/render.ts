import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { captionPng } from "./caption";
import {
  videoColorFilter,
  outputColorArgs,
  outputColorFilter,
  type MediaColor,
} from "./render-color";
import type { RenderSnapshot } from "@aivideo/contracts";
import {
  validateTimeline,
  dimensions,
  totalFrames,
  absoluteStart,
  timelineAssetIds,
  timelineMixGain,
} from "@aivideo/core/timeline";
import { boundedSource, type ObjectStorage } from "./storage";
import { ServiceError, type StoredAsset } from "./types";

// Only local files copied from the authenticated private asset store enter FFmpeg.
const formats =
  "mov,matroska,webm,wav,mp3,ogg,png_pipe,jpeg_pipe,webp_pipe,image2";
const inputFlags = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  formats,
  "-threads",
  "1",
];
export async function mediaProcess(
  binary: string,
  args: string[],
  signal: AbortSignal,
  cwd?: string,
) {
  signal.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
      killSignal: "SIGKILL",
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 480000);
    child.stdout.on("data", (b) => {
      out = (out + b).slice(-1000000);
    });
    child.stderr.on("data", (b) => {
      err = (err + b).slice(-4000);
    });
    const kill = () => child.kill("SIGKILL");
    process.once("exit", kill);
    let processError: Error | undefined;
    child.once("error", (error) => {
      processError = error;
    });
    child.once("close", (code, terminationSignal) => {
      clearTimeout(timer);
      process.off("exit", kill);
      if (signal.aborted) reject(signal.reason);
      else if (processError) reject(processError);
      else if (code === 0) resolve(out);
      else if (terminationSignal)
        reject(
          new ServiceError(
            "MEDIA_PROCESS_TERMINATED",
            `${binary.endsWith("ffprobe") ? "媒体探测" : "媒体编码"}进程被 ${terminationSignal} 终止，请检查 worker 资源或系统日志后重试`,
          ),
        );
      else
        reject(
          new Error(
            `${binary.endsWith("ffprobe") ? "媒体探测" : "媒体编码"}失败 (${code}): ${err.slice(-1500)}`,
          ),
        );
    });
  });
}
export async function probeMedia(path: string, signal: AbortSignal) {
  const text = await mediaProcess(
    process.env.FFPROBE_PATH || "ffprobe",
    [
      "-v",
      "error",
      ...inputFlags,
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      path,
    ],
    signal,
  );
  return JSON.parse(text) as {
    streams: (MediaColor & {
      codec_type: string;
      width?: number;
      height?: number;
      channels?: number;
      duration?: string;
    })[];
    format: { duration?: string };
  };
}
const seconds = (frames: number) => (frames / 30).toFixed(6);

export async function withRenderedMovie<T>(
  options: {
    snapshot: RenderSnapshot;
    storage: ObjectStorage;
    asset: (id: string) => Promise<StoredAsset>;
    signal: AbortSignal;
    progress: (message: string) => Promise<void>;
  },
  accept: (path: string) => Promise<T>,
): Promise<T> {
  const { snapshot, storage, asset, progress } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timer = setTimeout(
    () =>
      controller.abort(
        new ServiceError(
          "RENDER_TIMEOUT",
          "合成超过 8 分钟，请缩短分集或降低素材复杂度",
        ),
      ),
    480000,
  );
  const signal = controller.signal;
  const root = await mkdtemp(join(tmpdir(), "aivideo-render-"));
  const ff = (args: string[]) =>
    mediaProcess(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-filter_complex_threads",
        "1",
        "-filter_threads",
        "1",
        ...args,
      ],
      signal,
      root,
    );
  try {
    const t = validateTimeline(snapshot.timeline, true),
      [w, h] = dimensions[t.format],
      total = totalFrames(t);
    const inputs = new Map<
      string,
      {
        path: string;
        duration: number;
        hasAudio: boolean;
        mono: boolean;
        color?: MediaColor;
      }
    >();
    let bytes = 0;
    for (const id of timelineAssetIds(t)) {
      signal.throwIfAborted();
      const a = await asset(id);
      bytes += a.bytes;
      if (bytes > 1024 * 1024 * 1024)
        throw new ServiceError(
          "RENDER_LIMIT",
          "本次合成输入超过 1 GB，请拆分分集",
        );
      const path = join(root, `${inputs.size}.media`);
      await pipeline(
        Readable.from(boundedSource(await storage.stream(a.objectKey))),
        createWriteStream(path, { mode: 0o600 }),
        { signal },
      );
      const info = await probeMedia(path, signal),
        video = info.streams.find((s) => s.codec_type === "video");
      if (
        a.kind !== "audio" &&
        (!video ||
          !video.width ||
          !video.height ||
          video.width * video.height > 3840 * 2160)
      )
        throw new ServiceError(
          "INVALID_MEDIA",
          "画面无法解码或超过 4K 像素限制",
        );
      const duration = Number(info.format.duration ?? video?.duration ?? 0),
        hasAudio = info.streams.some((s) => s.codec_type === "audio");
      if (
        a.kind === "audio" &&
        (!hasAudio || !Number.isFinite(duration) || duration <= 0)
      )
        throw new ServiceError("INVALID_MEDIA", "配音素材无法解码或时长无效");
      let visualPath = path;
      if (a.kind === "image") {
        visualPath = `${path}.png`;
        // Match the browser canvas: honor image orientation/profile, then matte black.
        await sharp(path)
          .rotate()
          .flatten({ background: "#000000" })
          .toColourspace("srgb")
          .png()
          .toFile(visualPath);
      }
      inputs.set(id, {
        path: visualPath,
        duration,
        hasAudio,
        color: video,
        mono:
          info.streams.find((s) => s.codec_type === "audio")?.channels === 1,
      });
    }
    const segments: { path: string; duration: number }[] = [];
    for (let i = 0; i < t.clips.length; i++) {
      const clip = t.clips[i],
        input = inputs.get(clip.assetId)!;
      if (
        clip.kind === "video" &&
        (!Number.isFinite(input.duration) ||
          clip.sourceIn / 30 >= input.duration)
      )
        throw new ServiceError(
          "INVALID_TRIM",
          `${clip.name} 的裁剪入点超过素材时长`,
        );
      await progress(`正在合成镜头 ${i + 1}/${t.clips.length}：${clip.name}`);
      const path = `segment-${i}.mkv`,
        duration = seconds(clip.duration);
      const args = [
        ...inputFlags,
        ...(clip.kind === "image"
          ? ["-loop", "1", "-framerate", "30"]
          : ["-ss", seconds(clip.sourceIn)]),
        "-i",
        input.path,
      ];
      const hasAudio = clip.kind === "video" && input.hasAudio;
      if (!hasAudio)
        args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
      args.push(
        "-vf",
        `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2${clip.kind === "image" ? ":out_color_matrix=bt709" : ""},${clip.kind === "video" ? videoColorFilter(input.color ?? {}) + "," : ""}pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${duration},format=yuv420p,${outputColorFilter}`,
        "-af",
        `aresample=48000,${input.mono ? "pan=stereo|c0=c0|c1=c0" : "aformat=channel_layouts=stereo"},volume=${clip.volume},apad`,
        "-map",
        "0:v:0",
        "-map",
        hasAudio ? "0:a:0" : "1:a:0",
        "-t",
        duration,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-threads",
        "2",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        ...outputColorArgs,
        path,
      );
      await ff(args);
      segments.push({ path, duration: clip.duration });
    }
    // Render each overlap using only two inputs. Avoid a 100-input xfade graph
    // or repeatedly re-encoding the entire movie as more clips are appended.
    const pieces: { path: string; duration: number }[] = [];
    const intermediate = [
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-threads",
      "2",
      "-c:a",
      "pcm_s16le",
      ...outputColorArgs,
    ];
    for (let i = 0; i < t.clips.length; i++) {
      const clip = t.clips[i];
      const incoming = clip.transition?.duration ?? 0;
      const outgoing = t.clips[i + 1]?.transition?.duration ?? 0;
      if (incoming) {
        await progress(`正在合成转场 ${i}/${t.clips.length - 1}`);
        const previous = t.clips[i - 1];
        const path = `transition-${i}.mkv`;
        const effect =
          clip.transition!.kind === "crossfade"
            ? "transition=fade"
            : "transition=custom:expr='if(lte(X,W*(1-P)),B,A)'";
        await ff([
          ...inputFlags,
          "-ss",
          seconds(previous.duration - incoming),
          "-i",
          segments[i - 1].path,
          ...inputFlags,
          "-i",
          segments[i].path,
          "-filter_complex",
          `[0:v]trim=duration=${seconds(incoming)},setpts=PTS-STARTPTS,settb=1/30[a];[1:v]trim=duration=${seconds(incoming)},setpts=PTS-STARTPTS,settb=1/30[b];[a][b]xfade=${effect}:duration=${seconds(incoming)}:offset=0,format=yuv420p[v];[0:a]atrim=duration=${seconds(incoming)},asetpts=PTS-STARTPTS[aa];[1:a]atrim=duration=${seconds(incoming)},asetpts=PTS-STARTPTS[bb];[aa][bb]acrossfade=d=${seconds(incoming)}:c1=tri:c2=tri[au]`,
          "-map",
          "[v]",
          "-map",
          "[au]",
          "-t",
          seconds(incoming),
          ...intermediate,
          path,
        ]);
        pieces.push({ path, duration: incoming });
      }
      const duration = clip.duration - incoming - outgoing;
      if (!incoming && !outgoing) pieces.push(segments[i]);
      else {
        const path = `body-${i}.mkv`;
        await ff([
          ...inputFlags,
          "-ss",
          seconds(incoming),
          "-i",
          segments[i].path,
          "-t",
          seconds(duration),
          "-map",
          "0:v",
          "-map",
          "0:a",
          ...intermediate,
          path,
        ]);
        pieces.push({ path, duration });
      }
    }
    await writeFile(
      join(root, "segments.ffconcat"),
      "ffconcat version 1.0\n" +
        pieces
          .map((p) => `file ${p.path}\nduration ${seconds(p.duration)}`)
          .join("\n"),
    );
    // One subtitle image stream avoids opening hundreds of PNG inputs at once.
    let captionManifest: string | undefined;
    if (t.captions.length) {
      const blank = join(root, "blank.png");
      await sharp({
        create: {
          width: w,
          height: h,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toFile(blank);
      let at = 0;
      const lines = ["ffconcat version 1.0"];
      const add = (file: string, frames: number) => {
        if (frames > 0)
          lines.push(
            `file ${file}`,
            "option framerate 30",
            `duration ${seconds(frames)}`,
          );
      };
      const captions = [...t.captions].sort(
        (a, b) => absoluteStart(t, a) - absoluteStart(t, b),
      );
      for (let i = 0; i < captions.length; i++) {
        signal.throwIfAborted();
        const c = captions[i],
          start = absoluteStart(t, c);
        add("blank.png", start - at);
        const file = `caption-${i}.png`;
        await writeFile(
          join(root, file),
          await captionPng({ format: t.format, text: c.text, style: c.style }),
        );
        add(file, c.duration);
        at = start + c.duration;
      }
      add("blank.png", total - at);
      lines.push("file blank.png", "option framerate 30");
      captionManifest = "captions.ffconcat";
      await writeFile(join(root, captionManifest), lines.join("\n"));
    }
    await progress("正在混合配音、烧录字幕并编码成片");
    const args = [
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      "concat",
      "-safe",
      "1",
      // Concat inputs otherwise auto-create a decoder thread pool per stream.
      "-threads",
      "1",
      "-i",
      "segments.ffconcat",
    ];
    if (captionManifest)
      args.push(
        "-protocol_whitelist",
        "file,pipe",
        "-f",
        "concat",
        "-safe",
        "0",
        "-threads",
        "1",
        "-i",
        captionManifest,
      );
    const filters: string[] = [];
    if (captionManifest)
      filters.push(
        "[1:v]fps=30,scale=out_color_matrix=bt709,format=yuva420p[sub]",
        `[0:v][sub]overlay=eof_action=pass:shortest=0:format=yuv420,${outputColorFilter}[v]`,
      );
    else filters.push(`[0:v]${outputColorFilter}[v]`);
    const audioLabels = ["[0:a]"];
    for (let i = 0; i < t.audio.length; i++) {
      const a = t.audio[i],
        input = inputs.get(a.assetId)!;
      if (a.sourceIn / 30 + a.duration / 30 > input.duration + 1 / 30)
        throw new ServiceError(
          "INVALID_TRIM",
          `${a.name} 的配音裁剪范围超过素材时长`,
        );
      args.push(
        ...inputFlags,
        "-ss",
        seconds(a.sourceIn),
        "-t",
        seconds(a.duration),
        "-i",
        input.path,
      );
      const idx = i + (captionManifest ? 2 : 1),
        label = `a${i}`;
      filters.push(
        `[${idx}:a]asetpts=PTS-STARTPTS,aresample=48000,${input.mono ? "pan=stereo|c0=c0|c1=c0" : "aformat=channel_layouts=stereo"},volume=${a.volume},adelay=${Math.round((absoluteStart(t, a) / 30) * 1000)}:all=1[${label}]`,
      );
      audioLabels.push(`[${label}]`);
    }
    filters.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:normalize=0,volume=${timelineMixGain(t)}[a]`,
    );
    args.push(
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      seconds(total),
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      ...outputColorArgs,
      "-fs",
      "104857601",
      "output.mp4",
    );
    await ff(args);
    const output = join(root, "output.mp4");
    if ((await stat(output)).size > 100 * 1024 * 1024)
      throw new ServiceError("RENDER_LIMIT", "成片超过 100 MB，请缩短分集");
    const result = await probeMedia(output, signal);
    if (Math.abs(Number(result.format.duration) - total / 30) > 0.15)
      throw new ServiceError(
        "RENDER_INCOMPLETE",
        "成片时长不完整，未归档，请缩短分集后重试",
      );
    signal.throwIfAborted();
    return await accept(output);
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    await rm(root, { recursive: true, force: true });
  }
}
