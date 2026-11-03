import { it, expect } from "vitest";
import { advancePreviewPosition } from "../apps/web/features/timeline/playback-clock";
import {
  emptyTimeline,
  validateTimeline,
  absoluteStart,
  timelineSrt,
  removeClip,
  appendAdopted,
  totalFrames,
  clipStarts,
  compositionAt,
  normalizeClipOrder,
  timelineMixGain,
} from "../packages/core/src/timeline";
import {
  newProduction,
  applyProductionCommand,
  productionReferences,
} from "../packages/core/src/production";
import {
  createTask,
  referencesForTask,
  retryTaskSnapshot,
} from "../packages/core/src/tasks";
import {
  shotInputSchema,
  type Timeline,
} from "../packages/contracts/src/index";
const id = () => crypto.randomUUID();
it("waits for asynchronous media startup and follows audio through slow preview callbacks", () => {
  let position = 0;
  // A 250 ms delayed play() must not make the timeline seek ahead of the voice.
  for (let i = 0; i < 5; i++)
    position = advancePreviewPosition(position, 50, 0);
  expect(position).toBe(0);
  // The next callback is late, but audio really advanced by one second.
  position = advancePreviewPosition(position, 1200, 30);
  expect(position).toBe(30);
  // Switching clock sources cannot briefly run backwards.
  expect(advancePreviewPosition(position, 100, 29)).toBe(30);
  // A silent still / held tail retains the complete elapsed interval.
  expect(advancePreviewPosition(position, 500)).toBe(45);
});
function timeline(): Timeline {
  return {
    ...emptyTimeline(),
    clips: [
      {
        id: id(),
        assetId: id(),
        kind: "image",
        name: "开场",
        sourceIn: 0,
        duration: 60,
        volume: 1,
      },
      {
        id: id(),
        assetId: id(),
        kind: "video",
        name: "结尾",
        sourceIn: 0,
        duration: 90,
        volume: 0,
      },
    ],
  };
}
it("anchors voice and captions to reordered clips and exports frame-accurate SRT", () => {
  const t = timeline(),
    caption = {
      id: id(),
      clipId: t.clips[1].id,
      start: 15,
      duration: 30,
      text: "你好\n世界",
    };
  t.captions = [caption];
  t.audio = [
    {
      id: id(),
      assetId: id(),
      clipId: caption.clipId,
      name: "配音",
      start: 15,
      duration: 30,
      sourceIn: 0,
      volume: 0.8,
    },
  ];
  expect(absoluteStart(t, caption)).toBe(75);
  t.clips.reverse();
  validateTimeline(t);
  expect(absoluteStart(t, caption)).toBe(15);
  expect(timelineSrt(t)).toContain("00:00:00,500 --> 00:00:01,500\n你好\n世界");
  const removed = removeClip(t, caption.clipId);
  expect(removed.captions).toEqual([]);
  expect(removed.audio).toEqual([]);
});
it("overlaps transitions, mixes both layers and shifts anchored audio and SRT", () => {
  const t = timeline();
  t.clips[1].transition = { kind: "crossfade", duration: 30 };
  t.clips[1].volume = 1;
  t.captions = [
    {
      id: id(),
      clipId: t.clips[1].id,
      start: 15,
      duration: 30,
      text: "转场后",
    },
  ];
  validateTimeline(t);
  expect(totalFrames(t)).toBe(120);
  expect(clipStarts(t).get(t.clips[1].id)).toBe(30);
  expect(timelineSrt(t)).toContain("00:00:01,500 --> 00:00:02,500");
  const layers = compositionAt(t, 45);
  expect(layers).toHaveLength(2);
  expect(layers[0].gain).toBe(0.5);
  expect(layers[1]).toMatchObject({ opacity: 0.5, gain: 0.5, sourceFrame: 15 });
  t.clips[1].transition.kind = "wipe";
  expect(compositionAt(t, 45)[1]).toMatchObject({ opacity: 1, reveal: 0.5 });
  expect(compositionAt(t, 120)).toEqual([]);
  t.clips = normalizeClipOrder([...t.clips].reverse());
  expect(t.clips[0].transition).toBeUndefined();
  validateTimeline(t);
});
it("rejects overlapping transitions, unsafe caption style and new subtitle collisions", () => {
  const t = timeline();
  t.clips[1].transition = { kind: "crossfade", duration: 60 };
  expect(() => validateTimeline(t)).toThrow("转场总时长");
  t.clips[1].transition.duration = 30;
  t.captions = [
    { id: id(), start: 0, duration: 60, text: "一" },
    { id: id(), clipId: t.clips[1].id, start: 0, duration: 30, text: "二" },
  ];
  expect(() => validateTimeline(t)).toThrow("字幕时间不能重叠");
  t.captions = [{ ...t.captions[0], style: { color: '" />' } as never }];
  expect(() => validateTimeline(t)).toThrow("剪辑参数无效");
  t.captions = [];
  expect(removeClip(t, t.clips[0].id).clips[0].transition).toBeUndefined();
});
it("rejects overlaps, invalid anchors, overlong media and duplicate ids", () => {
  const t = timeline();
  t.captions = [
    { id: id(), start: 0, duration: 30, text: "一" },
    { id: id(), start: 29, duration: 30, text: "二" },
  ];
  expect(() => validateTimeline(t)).toThrow("重叠");
  t.captions = [{ ...t.captions[0], clipId: id() }];
  expect(() => validateTimeline(t)).toThrow("不存在");
  t.captions = [{ ...t.captions[0], clipId: t.clips[0].id, start: 59 }];
  expect(() => validateTimeline(t)).toThrow("超出");
  t.captions = [];
  t.clips[0].duration = 18000;
  expect(() => validateTimeline(t)).toThrow("10 分钟");
  t.clips[0].duration = 60;
  t.clips[1].id = t.clips[0].id;
  expect(() => validateTimeline(t)).toThrow("重复");
});
it("imports adopted takes once, freezes timeline version and protects referenced assets", () => {
  let p = newProduction(id(), "短剧");
  const episodeId = id(),
    shotId = id(),
    assetId = id(),
    candidateId = id();
  const change = (c: Parameters<typeof applyProductionCommand>[1]) =>
    (p = applyProductionCommand(p, c));
  change({ type: "episode.save", id: episodeId, name: "第一集", script: "" });
  change({
    type: "shot.save",
    episodeId,
    shotId,
    input: shotInputSchema.parse({ name: "镜头", durationSeconds: 2 }),
  });
  change({
    type: "candidate.add",
    episodeId,
    shotId,
    id: candidateId,
    assetId,
    label: "采用",
  });
  change({ type: "candidate.select", episodeId, shotId, candidateId });
  const t = appendAdopted(emptyTimeline(), p.episodes[0], [
    { id: assetId, kind: "image" },
  ]);
  expect(
    appendAdopted(t, p.episodes[0], [{ id: assetId, kind: "image" }]).clips,
  ).toHaveLength(1);
  change({ type: "timeline.save", episodeId, input: t });
  const render = {
    projectId: p.id,
    episodeId,
    projectName: p.name,
    episodeName: "第一集",
    version: 1,
    timeline: t,
  };
  const task = createTask({ render });
  expect(task.mode).toBe("render");
  expect(referencesForTask(task).assetIds.has(assetId)).toBe(true);
  change({
    type: "timeline.save",
    episodeId,
    input: { ...t, format: "portrait" },
  });
  expect(task.render?.timeline.format).toBe("landscape");
  expect(p.episodes[0].timeline?.version).toBe(2);
  expect(productionReferences(p).assets.has(assetId)).toBe(true);
  expect(retryTaskSnapshot({ ...task, status: "failed" }).render).toEqual(
    render,
  );
});

it("shares fixed mix headroom across preview/export, respects anchors and ignores silent image layers", () => {
  const t = timeline();
  t.audio = [
    {
      id: id(),
      assetId: id(),
      name: "voice",
      start: 0,
      sourceIn: 0,
      duration: 60,
      volume: 0.8,
    },
  ];
  expect(timelineMixGain(t)).toBe(1);
  t.audio.push({ ...t.audio[0], id: id(), volume: 0.6 });
  expect(timelineMixGain(t)).toBeCloseTo(0.95 / 1.4);
  t.audio[1].start = 60;
  expect(timelineMixGain(t)).toBe(1);
  t.clips[1].volume = 1;
  t.audio[1].clipId = t.clips[1].id;
  t.audio[1].start = 0;
  expect(timelineMixGain(t)).toBeCloseTo(0.95 / 1.6);
  t.clips[1].transition = { kind: "crossfade", duration: 15 };
  for (let f = 0; f < totalFrames(t); f++) {
    const sum =
      compositionAt(t, f).reduce(
        (n, l) => n + (l.clip.kind === "video" ? l.gain : 0),
        0,
      ) +
      t.audio.reduce(
        (n, a) =>
          n +
          (f >= absoluteStart(t, a) && f < absoluteStart(t, a) + a.duration
            ? a.volume
            : 0),
        0,
      );
    expect(sum * timelineMixGain(t)).toBeLessThanOrEqual(0.950001);
  }
});
