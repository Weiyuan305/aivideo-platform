import {
  timelineSchema,
  type Timeline,
  type TimelineClip,
  type Production,
  type LocalAsset,
  type CaptionStyle,
} from "@aivideo/contracts";
export const emptyTimeline = (): Timeline => ({
  fps: 30,
  format: "landscape",
  clips: [],
  audio: [],
  captions: [],
});
export const dimensions = {
  landscape: [1280, 720],
  portrait: [720, 1280],
  square: [720, 720],
} as const;
export const totalFrames = (t: Timeline) =>
  t.clips.reduce(
    (sum, c, i) => sum + c.duration - (i ? (c.transition?.duration ?? 0) : 0),
    0,
  );
export function clipStarts(t: Timeline) {
  let at = 0;
  return new Map(
    t.clips.map((c, i) => {
      if (i) at -= c.transition?.duration ?? 0;
      const start = at;
      at += c.duration;
      return [c.id, start];
    }),
  );
}
export function absoluteStart(
  t: Timeline,
  track: { start: number; clipId?: string },
) {
  return (
    track.start + (track.clipId ? (clipStarts(t).get(track.clipId) ?? 0) : 0)
  );
}
export function validateTimeline(
  raw: Timeline,
  requireClips = false,
): Timeline {
  const parsed = timelineSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      "剪辑参数无效：请检查名称、字幕文字、时长和条目数量（最多 100 个镜头、20 段配音、200 条字幕）",
    );
  const t = parsed.data,
    total = totalFrames(t);
  if (requireClips && !t.clips.length) throw new Error("请先添加镜头");
  if (total > 18000) throw new Error("首期单集成片最多 10 分钟，请拆分分集");
  const ids = [...t.clips, ...t.audio, ...t.captions].map((x) => x.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("时间线条目标识不能重复");
  for (const [i, c] of t.clips.entries()) {
    if (c.kind === "image" && c.sourceIn !== 0)
      throw new Error("图片的裁剪入点必须为 0");
    if (!i && c.transition) throw new Error("首个镜头不能设置入场转场");
    const incoming = c.transition?.duration ?? 0;
    const outgoing = t.clips[i + 1]?.transition?.duration ?? 0;
    if (incoming + outgoing >= c.duration)
      throw new Error(`${c.name} 的入场和出场转场总时长必须小于镜头时长`);
  }
  for (const track of [...t.audio, ...t.captions]) {
    const clip = t.clips.find((c) => c.id === track.clipId);
    if (track.clipId && !clip) throw new Error("配音或字幕引用了不存在的镜头");
    if (track.start + track.duration > (clip?.duration ?? total))
      throw new Error("配音或字幕超出绑定镜头或全片的时长，请调整起点和时长");
  }
  const captions = [...t.captions].sort(
    (a, b) => absoluteStart(t, a) - absoluteStart(t, b),
  );
  for (let i = 1; i < captions.length; i++)
    if (
      absoluteStart(t, captions[i]) <
      absoluteStart(t, captions[i - 1]) + captions[i - 1].duration
    )
      throw new Error("字幕时间不能重叠，请调整时间或合并文字");
  return t;
}
export function appendAdopted(
  t: Timeline,
  episode: Production["episodes"][number],
  assets: Pick<LocalAsset, "id" | "kind">[],
) {
  const clips: TimelineClip[] = [];
  for (const shot of episode.shots) {
    const candidate = shot.candidates.find(
      (c) => c.id === shot.selectedCandidateId,
    );
    if (!candidate || t.clips.some((c) => c.candidateId === candidate.id))
      continue;
    const asset = assets.find((a) => a.id === candidate.assetId);
    if (!asset || asset.kind === "audio")
      throw new Error("已采用素材尚未载入或不可用，请稍后重试");
    clips.push({
      id: crypto.randomUUID(),
      assetId: asset.id,
      kind: asset.kind,
      name: shot.name,
      sourceIn: 0,
      duration: Math.round(shot.durationSeconds * 30),
      volume: 1,
      shotId: shot.id,
      candidateId: candidate.id,
    });
  }
  return validateTimeline({ ...t, clips: [...t.clips, ...clips] });
}
export function removeClip(t: Timeline, id: string): Timeline {
  return {
    ...t,
    clips: normalizeClipOrder(t.clips.filter((c) => c.id !== id)),
    audio: t.audio.filter((a) => a.clipId !== id),
    captions: t.captions.filter((c) => c.clipId !== id),
  };
}
export function normalizeClipOrder(clips: TimelineClip[]) {
  return clips.map((c, i) =>
    i || !c.transition ? c : { ...c, transition: undefined },
  );
}
export const defaultCaptionStyle: CaptionStyle = {
  fontSize: 32,
  color: "#ffffff",
  background: "#000000",
  backgroundOpacity: 0.72,
  position: "bottom",
  align: "center",
  bold: false,
};
// A fixed headroom factor preserves relative track levels without a limiter that
// changes the export's gain/envelope independently of native browser playback.
export function timelineMixGain(t: Timeline) {
  const starts = clipStarts(t);
  const audio = t.audio.map((a) => ({
    ...a,
    at: a.start + (a.clipId ? (starts.get(a.clipId) ?? 0) : 0),
  }));
  const boundaries = new Set([0, totalFrames(t)]);
  for (const c of t.clips) {
    const at = starts.get(c.id)!;
    boundaries.add(at);
    boundaries.add(at + (c.transition?.duration ?? 0));
    boundaries.add(at + c.duration);
  }
  for (const a of audio) {
    boundaries.add(a.at);
    boundaries.add(a.at + a.duration);
  }
  let peak = 0;
  // Gains are piecewise linear. Inspect each breakpoint on both sides of cuts.
  for (const boundary of boundaries)
    for (const frame of [boundary, boundary - 0.000001]) {
      const visual = compositionAt(t, frame).reduce(
        (sum, l) => sum + (l.clip.kind === "video" ? l.gain : 0),
        0,
      );
      const voice = audio.reduce(
        (sum, a) =>
          sum + (frame >= a.at && frame < a.at + a.duration ? a.volume : 0),
        0,
      );
      peak = Math.max(peak, visual + voice);
    }
  return Math.min(1, 0.95 / Math.max(0.95, peak));
}

// One frame clock is shared by preview, track layout, SRT and CPU export.
export function compositionAt(
  t: Timeline,
  frame: number,
  starts = clipStarts(t),
) {
  return t.clips.flatMap((clip, i) => {
    const start = starts.get(clip.id)!;
    if (frame < start || frame >= start + clip.duration) return [];
    const incoming = clip.transition;
    const next = t.clips[i + 1];
    const progress = incoming
      ? Math.min(1, (frame - start) / incoming.duration)
      : 1;
    const outgoing = next?.transition
      ? Math.max(0, (frame - starts.get(next.id)!) / next.transition.duration)
      : 0;
    return [
      {
        clip,
        sourceFrame: clip.sourceIn + frame - start,
        opacity: incoming?.kind === "crossfade" ? progress : 1,
        reveal: incoming?.kind === "wipe" ? progress : 1,
        gain: clip.volume * progress * (1 - Math.min(1, outgoing)),
      },
    ];
  });
}
export function timelineAssetIds(t: Timeline) {
  return [...new Set([...t.clips, ...t.audio].map((c) => c.assetId))];
}
export function timelineSrt(t: Timeline) {
  validateTimeline(t);
  const time = (frame: number) => {
    const ms = Math.round((frame / 30) * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return [...t.captions]
    .sort((a, b) => absoluteStart(t, a) - absoluteStart(t, b))
    .map(
      (c, i) =>
        `${i + 1}\n${time(absoluteStart(t, c))} --> ${time(absoluteStart(t, c) + c.duration)}\n${c.text.replace(/\r/g, "")}\n`,
    )
    .join("\n");
}
