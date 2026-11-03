import { beforeAll, afterAll, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  readdir,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ServerWorkspace,
  ProductionWorkspace,
  DiskStorage,
  captionPng,
  waveformPeaks,
} from "../../packages/server/src/index";
import {
  emptyTimeline,
  timelineMixGain,
} from "../../packages/core/src/timeline";
import { type Timeline } from "../../packages/contracts/src/index";
const exec = promisify(execFile),
  id = () => crypto.randomUUID();
const url = process.env.TEST_DATABASE_URL!,
  owner = "render-" + id(),
  other = "other-" + id();
let app: ServerWorkspace,
  service: ProductionWorkspace,
  root: string,
  red: string,
  blue: string,
  audio: string;
beforeAll(async () => {
  if (!new URL(url).pathname.startsWith("/aivideo_test"))
    throw new Error("isolated test DB required");
  root = await mkdtemp(join(tmpdir(), "aivideo-render-test-"));
  app = new ServerWorkspace(url, new DiskStorage(join(root, "storage")));
  service = new ProductionWorkspace(app);
  await app.ensureOwner(owner);
  await app.ensureOwner(other);
  const ff = async (args: string[]) =>
    exec(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      ...args,
    ]);
  await ff([
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:d=1",
    "-frames:v",
    "1",
    join(root, "red.png"),
  ]);
  await ff([
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=320x180:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    join(root, "blue.mp4"),
  ]);
  await ff([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=800:duration=2",
    "-c:a",
    "pcm_s16le",
    join(root, "voice.wav"),
  ]);
  const upload = async (name: string, mime: string) =>
    app.upload(
      owner,
      new File([await readFile(join(root, name))], name, { type: mime }),
    );
  red = (await upload("red.png", "image/png")).id;
  blue = (await upload("blue.mp4", "video/mp4")).id;
  audio = (await upload("voice.wav", "audio/wav")).id;
}, 30000);
afterAll(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function setup() {
  let p = await service.create(owner, id(), "合成验收"),
    episodeId = id();
  p = await service.change(owner, p.id, p.revision, {
    type: "episode.save",
    id: episodeId,
    name: "红蓝镜头",
    script: "",
  });
  const t: Timeline = {
    ...emptyTimeline(),
    clips: [
      {
        id: id(),
        assetId: red,
        kind: "image",
        name: "红色",
        sourceIn: 0,
        duration: 30,
        volume: 0,
      },
      {
        id: id(),
        assetId: blue,
        kind: "video",
        name: "蓝色",
        sourceIn: 0,
        duration: 30,
        volume: 0,
      },
    ],
  };
  t.audio = [
    {
      id: id(),
      name: "配音",
      assetId: audio,
      clipId: t.clips[1].id,
      start: 6,
      sourceIn: 0,
      duration: 15,
      volume: 0.8,
    },
  ];
  t.captions = [
    { id: id(), start: 9, duration: 15, text: "中文字幕 <安全> & test" },
  ];
  p = await service.change(owner, p.id, p.revision, {
    type: "timeline.save",
    episodeId,
    input: t,
  });
  return { p, episodeId, t };
}
it("renders ordered clips, anchored voice and burned Chinese captions into a private reusable MP4", async () => {
  const { p, episodeId, t } = await setup(),
    key = id();
  const job = await service.render(owner, p.id, episodeId, 1, key);
  expect((await service.render(owner, p.id, episodeId, 1, key)).id).toBe(
    job.id,
  );
  await service.change(owner, p.id, p.revision, {
    type: "timeline.save",
    episodeId,
    input: { ...t, clips: [...t.clips].reverse() },
  });
  await app.execute(job.id);
  const done = await app.getJob(owner, job.id);
  expect(done.error).toBeUndefined();
  expect(done.status).toBe("succeeded");
  expect(done.mode).toBe("render");
  expect(done.render?.timeline.clips[0].assetId).toBe(red);
  expect(
    (
      await app.listJobPage(owner, {
        mode: "media",
        projectId: p.id,
        episodeId,
      })
    ).items.map((x) => x.id),
  ).toContain(job.id);
  const asset = await app.getAsset(owner, done.outputAssetIds[0]);
  expect(asset.kind).toBe("video");
  expect(asset.sourceJobId).toBe(job.id);
  await expect(app.getAsset(other, asset.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const path = join(root, "result.mp4");
  await writeFile(path, (await app.storage.read(asset.objectKey)).bytes);
  if (process.env.RENDER_ACCEPTANCE_DIR) {
    await mkdir(process.env.RENDER_ACCEPTANCE_DIR, { recursive: true });
    await writeFile(
      join(process.env.RENDER_ACCEPTANCE_DIR, "render-verified.mp4"),
      (await app.storage.read(asset.objectKey)).bytes,
    );
  }
  const info = JSON.parse(
    (
      await exec(process.env.FFPROBE_PATH || "ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        path,
      ])
    ).stdout,
  );
  expect(Number(info.format.duration)).toBeCloseTo(2, 1);
  expect(
    info.streams.find((s: { codec_type: string }) => s.codec_type === "video"),
  ).toMatchObject({
    color_space: "bt709",
    color_transfer: "iec61966-2-1",
    color_primaries: "bt709",
  });
  expect(
    info.streams.find((s: { codec_type: string }) => s.codec_type === "video")
      .width,
  ).toBe(1280);
  const frame = async (time: number) =>
    (
      await exec(
        process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(time),
          "-i",
          path,
          "-frames:v",
          "1",
          "-vf",
          "scale=1280:720",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 4e6 },
      )
    ).stdout;
  const first = await frame(0.1),
    second = await frame(1.8),
    caption = await frame(0.5),
    pixel = (360 * 1280 + 640) * 3;
  expect(first[pixel]).toBeGreaterThan(200);
  expect(second[pixel + 2]).toBeGreaterThan(200);
  let whites = 0;
  for (let i = 400 * 1280 * 3; i < caption.length; i += 3)
    if (caption[i] > 170 && caption[i + 1] > 170 && caption[i + 2] > 170)
      whites++;
  expect(whites).toBeGreaterThan(15);
  const pcm = (
    await exec(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        "8000",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 4e6 },
    )
  ).stdout;
  const rms = (start: number, end: number) => {
    let sum = 0,
      n = 0;
    for (let i = Math.round(start * 8000); i < Math.round(end * 8000); i++) {
      sum += pcm.readFloatLE(i * 4) ** 2;
      n++;
    }
    return Math.sqrt(sum / n);
  };
  expect(rms(0.1, 0.8)).toBeLessThan(0.001);
  expect(rms(1.3, 1.6)).toBeGreaterThan(0.02);
  await app.execute(job.id);
  expect((await app.getJob(owner, job.id)).outputAssetIds).toEqual(
    done.outputAssetIds,
  );
  // Reuse the exported file as a new timeline clip and ensure source deletion is guarded.
  const current = await service.get(owner, p.id);
  await service.change(owner, p.id, current.revision, {
    type: "timeline.save",
    episodeId,
    input: {
      ...emptyTimeline(),
      clips: [{ ...t.clips[1], assetId: asset.id, duration: 60 }],
    },
  });
  await expect(
    app.removeResource(owner, "assets", asset.id),
  ).rejects.toMatchObject({ code: "RESOURCE_IN_USE" });
}, 120000);
it("rejects inaccessible references and stale timeline versions; cancels queued and running renders", async () => {
  const { p, episodeId, t } = await setup();
  await expect(
    service.render(other, p.id, episodeId, 1, id()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    service.render(owner, p.id, episodeId, 2, id()),
  ).rejects.toMatchObject({ code: "VERSION_MISMATCH" });
  await expect(
    service.change(owner, p.id, p.revision, {
      type: "timeline.save",
      episodeId,
      input: { ...t, clips: [{ ...t.clips[0], assetId: id() }], audio: [] },
    }),
  ).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  const queued = await service.render(owner, p.id, episodeId, 1, id());
  await app.act(owner, queued.id, "cancel");
  await app.execute(queued.id);
  expect((await app.getJob(owner, queued.id)).status).toBe("cancelled");
  const job = await service.render(owner, p.id, episodeId, 1, id());
  const running = app.execute(job.id);
  for (let i = 0; i < 100; i++) {
    if ((await app.getJob(owner, job.id)).status === "running") break;
    await new Promise((r) => setTimeout(r, 20));
  }
  await app.act(owner, job.id, "cancel");
  await running;
  expect((await app.getJob(owner, job.id)).status).toBe("cancelled");
  expect((await app.getJob(owner, job.id)).outputAssetIds).toEqual([]);
  const retry = await app.act(owner, job.id, "retry");
  expect(retry.render).toEqual(job.render);
  expect(retry.attempt).toBe(2);
}, 120000);
it("records invalid trim as a visible failure without publishing partial media", async () => {
  const { p, episodeId, t } = await setup();
  t.clips[1].sourceIn = 600;
  const next = await service.change(owner, p.id, p.revision, {
    type: "timeline.save",
    episodeId,
    input: t,
  });
  const job = await service.render(
    owner,
    p.id,
    episodeId,
    next.episodes[0].timeline!.version,
    id(),
  );
  await app.execute(job.id);
  const done = await app.getJob(owner, job.id);
  expect(done.status).toBe("failed");
  expect(done.error?.code).toBe("INVALID_TRIM");
  expect(done.outputAssetIds).toEqual([]);
  expect(
    (await readdir(tmpdir())).filter(
      (x) =>
        x.startsWith("aivideo-render-") &&
        !x.startsWith("aivideo-render-test-"),
    ),
  ).toEqual([]);
}, 120000);

it("reports an externally killed encoder, publishes no partial asset and retries the frozen render", async () => {
  const { p, episodeId } = await setup();
  const job = await service.render(owner, p.id, episodeId, 1, id());
  const killedEncoder = join(root, "killed-encoder");
  await writeFile(killedEncoder, '#!/bin/sh\nkill -KILL "$$"\n');
  await chmod(killedEncoder, 0o700);
  const original = process.env.FFMPEG_PATH;
  try {
    process.env.FFMPEG_PATH = killedEncoder;
    await app.execute(job.id);
  } finally {
    if (original === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = original;
  }
  const failed = await app.getJob(owner, job.id);
  expect(failed.status).toBe("failed");
  expect(failed.error).toMatchObject({ code: "MEDIA_PROCESS_TERMINATED" });
  expect(failed.error?.message).toContain("SIGKILL");
  expect(failed.outputAssetIds).toEqual([]);
  expect(
    (await app.sql`select id from assets where source_job_id=${job.id}`).length,
  ).toBe(0);
  const retry = await app.act(owner, job.id, "retry");
  expect(retry.render).toEqual(job.render);
  await app.execute(retry.id);
  expect((await app.getJob(owner, retry.id)).status).toBe("succeeded");
  expect(
    (await app.sql`select id from assets where source_job_id=${retry.id}`)
      .length,
  ).toBe(1);
}, 120000);

it("retries failed private archiving and recovers an interrupted archiving state without duplicate outputs", async () => {
  const { p, episodeId } = await setup(),
    job = await service.render(owner, p.id, episodeId, 1, id());
  const put = app.storage.put.bind(app.storage);
  app.storage.put = async (key, source, limit) => {
    if (key.startsWith(`outputs/${job.id}/`))
      throw new Error("simulated disk outage");
    return put(key, source, limit);
  };
  try {
    await app.execute(job.id);
  } finally {
    app.storage.put = put;
  }
  const failed = await app.getJob(owner, job.id);
  expect(failed.status).toBe("archive_failed");
  expect(failed.outputAssetIds).toEqual([]);
  await app.act(owner, job.id, "retry-archive");
  const queued = await app.getJob(owner, job.id);
  // A restart may leave the durable task at archiving before a DB publication.
  await app.sql`update jobs set status='archiving',payload=${app.sql.json({ ...queued, status: "archiving" } as never)} where id=${job.id}`;
  await app.execute(job.id);
  expect((await app.getJob(owner, job.id)).status).toBe("succeeded");
  expect(
    (await app.sql`select id from assets where source_job_id=${job.id}`).length,
  ).toBe(1);
}, 120000);

it.each(["crossfade", "wipe"] as const)(
  "exports %s with overlap timing, styled captions and overlapping voice tracks",
  async (kind) => {
    const { p, episodeId, t } = await setup();
    t.clips[1].transition = { kind, duration: 15 };
    t.captions[0] = {
      ...t.captions[0],
      start: 0,
      duration: 10,
      style: {
        fontSize: 48,
        color: "#ffff00",
        background: "#000000",
        backgroundOpacity: 0.5,
        position: "top",
        align: "left",
        bold: true,
      },
    };
    t.audio.push({
      ...t.audio[0],
      id: id(),
      name: "第二配音",
      clipId: undefined,
      start: 15,
      duration: 15,
      volume: 0.4,
    });
    const saved = await service.change(owner, p.id, p.revision, {
      type: "timeline.save",
      episodeId,
      input: t,
    });
    const job = await service.render(
      owner,
      p.id,
      episodeId,
      saved.episodes[0].timeline!.version,
      id(),
    );
    await app.execute(job.id);
    const done = await app.getJob(owner, job.id);
    expect(done.error).toBeUndefined();
    expect(done.status).toBe("succeeded");
    const asset = await app.getAsset(owner, done.outputAssetIds[0]);
    const path = join(root, `transition-${kind}.mp4`);
    await writeFile(path, (await app.storage.read(asset.objectKey)).bytes);
    const info = JSON.parse(
      (
        await exec(process.env.FFPROBE_PATH || "ffprobe", [
          "-v",
          "error",
          "-show_format",
          "-of",
          "json",
          path,
        ])
      ).stdout,
    );
    expect(Number(info.format.duration)).toBeCloseTo(1.5, 1);
    const frame = async (time: number) =>
      (
        await exec(
          process.env.FFMPEG_PATH || "ffmpeg",
          [
            "-v",
            "error",
            "-ss",
            String(time),
            "-i",
            path,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
          ],
          { encoding: "buffer", maxBuffer: 4e6 },
        )
      ).stdout;
    const middle = await frame(0.75),
      pixel = (360 * 1280 + 640) * 3;
    if (kind === "crossfade") {
      expect(middle[pixel]).toBeGreaterThan(65);
      expect(middle[pixel + 2]).toBeGreaterThan(65);
      expect(middle[pixel]).toBeLessThan(190);
    } else {
      expect(middle[(360 * 1280 + 200) * 3 + 2]).toBeGreaterThan(200);
      expect(middle[(360 * 1280 + 1000) * 3]).toBeGreaterThan(200);
    }
    const caption = await frame(0.1);
    let yellowTop = 0,
      yellowBottom = 0;
    for (let i = 0; i < caption.length; i += 3) {
      if (caption[i] > 150 && caption[i + 1] > 150 && caption[i + 2] < 100) {
        if (i < 250 * 1280 * 3) yellowTop++;
        if (i > 500 * 1280 * 3) yellowBottom++;
      }
    }
    expect(yellowTop).toBeGreaterThan(100);
    expect(yellowBottom).toBe(0);
    const pcm = (
      await exec(
        process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          path,
          "-vn",
          "-f",
          "f32le",
          "-ac",
          "1",
          "-ar",
          "8000",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 4e6 },
      )
    ).stdout;
    const rms = (a: number, b: number) => {
      let sum = 0,
        count = 0;
      for (let i = Math.round(a * 8000); i < Math.round(b * 8000); i++) {
        sum += pcm.readFloatLE(i * 4) ** 2;
        count++;
      }
      return Math.sqrt(sum / count);
    };
    expect(rms(0.1, 0.4)).toBeLessThan(0.001);
    expect(rms(0.55, 0.65)).toBeGreaterThan(0.01);
    expect(rms(0.8, 0.95)).toBeGreaterThan(rms(0.55, 0.65));
  },
  120000,
);

it("generates bounded waveform peaks and rejects non-audio or invalid caption input", async () => {
  const asset = await app.getAsset(owner, audio);
  const data = await waveformPeaks(
    asset,
    app.storage,
    new AbortController().signal,
  );
  expect(data.duration).toBeCloseTo(2, 1);
  expect(data.peaks.length).toBeGreaterThan(90);
  expect(data.peaks.length).toBeLessThanOrEqual(101);
  expect(Math.max(...data.peaks)).toBeGreaterThan(0.1);
  expect(
    await waveformPeaks(asset, app.storage, new AbortController().signal),
  ).toEqual(data);
  await expect(
    waveformPeaks(
      await app.getAsset(owner, red),
      app.storage,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  await expect(
    waveformPeaks(
      await app.getAsset(owner, blue),
      app.storage,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "NO_AUDIO" });
  await expect(
    captionPng({ format: "portrait", text: "", style: {} }),
  ).rejects.toMatchObject({ code: "INVALID_CAPTION" });
  const png = await captionPng({
    format: "portrait",
    text: "中文 <安全> & 换行\n第二行",
  });
  expect(png.subarray(1, 4).toString()).toBe("PNG");
});

it("keeps mono channel levels and shared mix gain consistent with browser playback", async () => {
  const { p, episodeId, t } = await setup();
  t.audio = [
    {
      id: id(),
      assetId: audio,
      name: "mono voice",
      start: 0,
      sourceIn: 0,
      duration: 60,
      volume: 0.8,
    },
    {
      id: id(),
      assetId: audio,
      name: "overlap",
      start: 15,
      sourceIn: 15,
      duration: 30,
      volume: 0.4,
    },
  ];
  t.captions = [];
  const saved = await service.change(owner, p.id, p.revision, {
    type: "timeline.save",
    episodeId,
    input: t,
  });
  const job = await service.render(
    owner,
    p.id,
    episodeId,
    saved.episodes[0].timeline!.version,
    id(),
  );
  await app.execute(job.id);
  const done = await app.getJob(owner, job.id);
  expect(done.error).toBeUndefined();
  const asset = await app.getAsset(owner, done.outputAssetIds[0]);
  const output = join(root, "mix-parity.mp4");
  await writeFile(output, (await app.storage.read(asset.objectKey)).bytes);
  const decode = async (path: string) =>
    (
      await exec(
        process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          path,
          "-vn",
          "-af",
          "pan=mono|c0=c0",
          "-ar",
          "48000",
          "-f",
          "f32le",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 4e6 },
      )
    ).stdout;
  const original = await decode(join(root, "voice.wav")),
    actual = await decode(output);
  const rms = (b: Buffer, a: number, z: number) => {
    let v = 0,
      n = 0;
    for (let i = Math.round(a * 48000); i < Math.round(z * 48000); i++) {
      v += b.readFloatLE(i * 4) ** 2;
      n++;
    }
    return Math.sqrt(v / n);
  };
  const gain = timelineMixGain(t);
  for (const [a, b, weight] of [
    [0.15, 0.35, 0.8],
    [0.65, 0.85, 1.2],
    [1.7, 1.9, 0.8],
  ]) {
    const ratio = rms(actual, a, b) / rms(original, a, b);
    expect(Math.abs(ratio - gain * weight)).toBeLessThan(0.015);
  }
}, 120000);

it("preserves original video audio level through a crossfade and stops captions on the exact frame", async () => {
  const { p, episodeId, t } = await setup();
  const source = join(root, "video-tone.mp4");
  await exec(process.env.FFMPEG_PATH || "ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=30:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=400:sample_rate=48000:duration=2",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-c:a",
    "aac",
    source,
  ]);
  const uploaded = await app.upload(
    owner,
    new File([await readFile(source)], "video-tone.mp4", { type: "video/mp4" }),
  );
  t.clips = t.clips.map((c, i) => ({
    ...c,
    assetId: uploaded.id,
    kind: "video",
    volume: i ? 0.4 : 0.8,
    ...(i ? { transition: { kind: "crossfade" as const, duration: 15 } } : {}),
  }));
  t.audio = [];
  t.captions = [
    {
      id: id(),
      start: 6,
      duration: 6,
      text: "边界校验",
      style: {
        fontSize: 48,
        color: "#ffffff",
        background: "#000000",
        backgroundOpacity: 1,
        position: "center",
        align: "center",
        bold: true,
      },
    },
  ];
  const saved = await service.change(owner, p.id, p.revision, {
    type: "timeline.save",
    episodeId,
    input: t,
  });
  const job = await service.render(
    owner,
    p.id,
    episodeId,
    saved.episodes[0].timeline!.version,
    id(),
  );
  await app.execute(job.id);
  const done = await app.getJob(owner, job.id);
  expect(done.error).toBeUndefined();
  const asset = await app.getAsset(owner, done.outputAssetIds[0]),
    output = join(root, "video-audio-parity.mp4");
  await writeFile(output, (await app.storage.read(asset.objectKey)).bytes);
  const pcm = (
    await exec(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        output,
        "-vn",
        "-af",
        "pan=mono|c0=c0",
        "-ar",
        "48000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 4e6 },
    )
  ).stdout;
  const rms = (a: number, b: number) => {
    let sum = 0,
      n = 0;
    for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) {
      sum += pcm.readFloatLE(i * 4) ** 2;
      n++;
    }
    return Math.sqrt(sum / n);
  };
  const initial = rms(0.15, 0.25);
  expect(Math.abs(rms(0.7, 0.8) / initial - 0.75)).toBeLessThan(0.04);
  expect(Math.abs(rms(1.2, 1.3) / initial - 0.5)).toBeLessThan(0.03);
  for (const [frame, shown] of [
    [5, false],
    [6, true],
    [11, true],
    [12, false],
  ] as const) {
    const pixels = (
      await exec(
        process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(frame / 30),
          "-i",
          output,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 4e6 },
      )
    ).stdout;
    let white = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (pixels[i] > 180 && pixels[i + 1] > 180 && pixels[i + 2] > 180)
        white++;
    expect(white > 100).toBe(shown);
  }
}, 120000);

it("flattens transparent images onto the same black matte used by live preview", async () => {
  const { p, episodeId, t } = await setup(),
    source = join(root, "transparent.png");
  await exec(process.env.FFMPEG_PATH || "ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=red@0.0:s=320x180,format=rgba",
    "-frames:v",
    "1",
    source,
  ]);
  const uploaded = await app.upload(
    owner,
    new File([await readFile(source)], "transparent.png", {
      type: "image/png",
    }),
  );
  t.clips = [{ ...t.clips[0], assetId: uploaded.id }];
  t.audio = [];
  t.captions = [];
  const saved = await service.change(owner, p.id, p.revision, {
    type: "timeline.save",
    episodeId,
    input: t,
  });
  const job = await service.render(
    owner,
    p.id,
    episodeId,
    saved.episodes[0].timeline!.version,
    id(),
  );
  await app.execute(job.id);
  const done = await app.getJob(owner, job.id);
  expect(done.error).toBeUndefined();
  const asset = await app.getAsset(owner, done.outputAssetIds[0]),
    output = join(root, "transparent.mp4");
  await writeFile(output, (await app.storage.read(asset.objectKey)).bytes);
  const pixels = (
    await exec(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        "0.2",
        "-i",
        output,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 4e6 },
    )
  ).stdout;
  expect(Math.max(...pixels.subarray(0, 3000))).toBeLessThan(4);
}, 120000);
