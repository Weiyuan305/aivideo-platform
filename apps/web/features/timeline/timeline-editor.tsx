"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  timelineSchema,
  type Timeline,
  type TimelineClip,
  type LocalTask,
  type Production,
} from "@aivideo/contracts";
import {
  emptyTimeline,
  validateTimeline,
  appendAdopted,
  totalFrames,
  clipStarts,
  absoluteStart,
  removeClip,
  timelineAssetIds,
  timelineSrt,
  normalizeClipOrder,
} from "@aivideo/core/timeline";
import { getLocal } from "@aivideo/core/local";
import {
  workspaceRequest,
  workspaceChanged,
} from "@aivideo/core/workspace-client";
import { taskLabel } from "@aivideo/core/tasks";
import { useLocalLibrary } from "@/features/assets/use-local-library";
import { AssetPreview } from "@/features/assets/asset-library";
import { AssetPicker } from "@/features/production/asset-picker";
import { useTaskPage } from "@/features/tasks/use-task-page";
import { useTask } from "@/features/tasks/use-tasks";
import type { Change } from "@/features/production/forms";
import { TimelinePreview } from "./timeline-preview";
import { AudioWaveform } from "./audio-waveform";
import { CaptionStyleEditor } from "./caption-style-editor";
import { createPlaybackClock, Playhead } from "./playback-clock";
const uid = () => crypto.randomUUID();
const trackPageSize = 5;
function TrackPages({
  label,
  page,
  total,
  onChange,
}: {
  label: string;
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const count = Math.max(1, Math.ceil(total / trackPageSize));
  if (count === 1) return null;
  return (
    <nav className="production-actions" aria-label={`${label}分页`}>
      <button
        className="action secondary"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        上一页{label}
      </button>
      <label>
        {label}页码{" "}
        <select value={page} onChange={(e) => onChange(Number(e.target.value))}>
          {Array.from({ length: count }, (_, i) => (
            <option key={i} value={i}>
              {i + 1} / {count} · 第 {i * trackPageSize + 1}–
              {Math.min(total, (i + 1) * trackPageSize)} 条
            </option>
          ))}
        </select>
      </label>
      <button
        className="action secondary"
        disabled={page === count - 1}
        onClick={() => onChange(page + 1)}
      >
        下一页{label}
      </button>
    </nav>
  );
}
const seconds = (frames: number) => Number((frames / 30).toFixed(3));
export function TimelineEditor({
  project,
  episode,
  change,
  initialPreviewId,
  onPreviewChange,
}: {
  project: Production;
  episode: Production["episodes"][number];
  change: Change;
  initialPreviewId?: string;
  onPreviewChange: (id: string) => void;
}) {
  const [clock] = useState(createPlaybackClock);
  const [audioPageIndex, setAudioPage] = useState(0),
    [captionPageIndex, setCaptionPage] = useState(0);
  const saved = timelineSchema.parse(
      episode.timeline?.draft ?? emptyTimeline(),
    ),
    version = episode.timeline?.version ?? 0;
  const [draft, setDraft] = useState<Timeline>(saved),
    [base, setBase] = useState(version),
    [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [working, setWorking] = useState(false),
    [uploading, setUploading] = useState(false);
  const [picker, setPicker] = useState<"visual" | "audio">(),
    [picked, setPicked] = useState<string[]>([]),
    [previewId, setPreviewId] = useState(initialPreviewId);
  const audioPage = Math.min(
      audioPageIndex,
      Math.max(0, Math.ceil(draft.audio.length / trackPageSize) - 1),
    ),
    captionPage = Math.min(
      captionPageIndex,
      Math.max(0, Math.ceil(draft.captions.length / trackPageSize) - 1),
    );
  const key = `aivideo:timeline:${project.id}:${episode.id}`,
    submission = useRef<{ version: number; key: string } | undefined>(
      undefined,
    );
  useEffect(() => {
    try {
      const text = sessionStorage.getItem(key);
      if (text) {
        const cached = JSON.parse(text),
          parsed = timelineSchema.safeParse(cached.draft);
        if (parsed.success && Number.isInteger(cached.base)) {
          setDraft(parsed.data);
          setBase(cached.base);
        }
      }
    } catch {
      /* A disabled session store does not block server saves. */
    }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem(key, JSON.stringify({ base, draft }));
      } catch {}
  }, [base, draft, ready, key]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved),
    conflict = base !== version && dirty;
  useEffect(() => {
    if (!dirty || !ready) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, ready]);
  const jobs = useTaskPage({
    mode: "render",
    projectId: project.id,
    episodeId: episode.id,
    limit: 10,
  });
  // The paged list already refreshes visible renders. Fetch a full task snapshot
  // only for a deep link outside that page, not alongside every list poll.
  const focused = useTask(
    previewId && !jobs.items.some((job) => job.id === previewId)
      ? previewId
      : undefined,
  );
  const selectedTask =
    jobs.items.find((j) => j.id === previewId) ?? focused.task;
  const preview = previewId
    ? selectedTask?.render?.projectId === project.id &&
      selectedTask.render.episodeId === episode.id
      ? selectedTask
      : undefined
    : jobs.items[0];
  function selectPreview(id: string) {
    setPreviewId(id);
    onPreviewChange(id);
  }
  const outputId = preview?.outputAssetIds[0];
  const library = useLocalLibrary({
    assetIds: [
      ...timelineAssetIds(draft),
      ...episode.shots.flatMap((s) =>
        s.candidates
          .filter((c) => c.id === s.selectedCandidateId)
          .map((c) => c.assetId),
      ),
      ...(outputId ? [outputId] : []),
    ],
  });
  const output = library.assets.find((a) => a.id === outputId),
    clip = draft.clips.find((c) => c.id === selected) ?? draft.clips[0];
  const starts = clipStarts(draft),
    total = totalFrames(draft);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  function edit(next: Timeline) {
    setDraft(next);
    setMessage("");
    setError("");
  }
  function updateClip(next: Partial<TimelineClip>) {
    if (clip)
      edit({
        ...draft,
        clips: draft.clips.map((c) =>
          c.id === clip.id ? { ...c, ...next } : c,
        ),
      });
  }
  function move(id: string, delta: number) {
    const index = draft.clips.findIndex((c) => c.id === id),
      to = index + delta;
    if (to >= 0 && to < draft.clips.length)
      edit({
        ...draft,
        clips: normalizeClipOrder(arrayMove(draft.clips, index, to)),
      });
  }
  async function perform(work: () => Promise<void>) {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setWorking(false);
    }
  }
  async function addPicked() {
    const asset = await getLocal("assets", picked[0]);
    if (!asset) throw new Error("请选择可访问的素材");
    if (picker === "audio") {
      if (asset.kind !== "audio") throw new Error("请选择音频素材");
      if (!total) throw new Error("请先添加画面镜头");
      setAudioPage(Math.floor(draft.audio.length / trackPageSize));
      edit({
        ...draft,
        audio: [
          ...draft.audio,
          {
            id: uid(),
            assetId: asset.id,
            name: asset.name,
            clipId: clip?.id,
            start: 0,
            sourceIn: 0,
            duration: Math.min(30, clip?.duration ?? total),
            volume: 1,
          },
        ],
      });
    } else {
      if (asset.kind === "audio") throw new Error("请选择图片或视频");
      const c: TimelineClip = {
        id: uid(),
        assetId: asset.id,
        name: asset.name,
        kind: asset.kind,
        sourceIn: 0,
        duration: 90,
        volume: 1,
      };
      edit({ ...draft, clips: [...draft.clips, c] });
      setSelected(c.id);
    }
    setPicker(undefined);
    setPicked([]);
  }
  async function save() {
    if (conflict)
      throw new Error("服务端已是其他版本，请先恢复服务端版本，再重新编辑");
    const input = validateTimeline(draft);
    if (await change({ type: "timeline.save", episodeId: episode.id, input })) {
      setBase(version + 1);
      setMessage("剪辑已保存，可生成成片预览。");
    }
  }
  async function render() {
    if (dirty || !version) throw new Error("请先保存剪辑，再生成预览");
    validateTimeline(saved, true);
    if (submission.current?.version !== version)
      submission.current = { version, key: uid() };
    const { task } = await workspaceRequest<{ task: LocalTask }>(
      `/api/production/${project.id}/render`,
      {
        method: "POST",
        body: JSON.stringify({
          episodeId: episode.id,
          version,
          idempotencyKey: submission.current.key,
        }),
      },
    );
    workspaceChanged("tasks");
    selectPreview(task.id);
    setMessage("合成已提交；关闭页面不影响后台执行。");
  }
  let validation = "";
  try {
    validateTimeline(draft);
  } catch (e) {
    validation = e instanceof Error ? e.message : "时间线参数无效";
  }
  return (
    <fieldset className="timeline-editor" disabled={working || !ready}>
      <div className="timeline-heading">
        <div>
          <h2>{episode.name} · 剪辑与成片</h2>
          <p className="description">
            {draft.clips.length} 个镜头 · {seconds(total)} 秒 · 30 fps ·{" "}
            {dirty
              ? "有未保存修改"
              : version
                ? `已保存 v${version}`
                : "尚未保存"}
          </p>
        </div>
        <div className="production-actions">
          <button
            className="action secondary"
            disabled={
              uploading || (!dirty && version > 0) || !!validation || conflict
            }
            onClick={() => void perform(save)}
          >
            保存剪辑
          </button>
          <button
            className="action"
            disabled={uploading || dirty || !version || !draft.clips.length}
            onClick={() => void perform(render)}
          >
            生成成片预览
          </button>
        </div>
      </div>
      <p className="description">
        上传素材或导入已采用镜头，调整剪辑后保存。后台合成真实
        MP4，预览与下载一致。视频不足所设时长会定格尾帧；配音需填写实际可用时长。
      </p>
      {conflict && (
        <p role="alert" className="error-message">
          服务端已有 v{version}，当前草稿基于 v{base}
          ；请先保留所需内容，再恢复服务端版本。
        </p>
      )}
      {(error || validation || library.error || jobs.error) && (
        <p role="alert" className="error-message">
          {error || validation || library.error || jobs.error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <div className="production-actions">
        <button
          className="action secondary"
          onClick={() =>
            void perform(async () => {
              const next = appendAdopted(draft, episode, library.assets);
              if (next.clips.length === draft.clips.length)
                throw new Error("没有新的已采用镜头可导入");
              edit(next);
            })
          }
        >
          导入已采用镜头
        </button>
        <button
          className="action secondary"
          disabled={draft.clips.length >= 100}
          onClick={() => {
            setPicker("visual");
            setPicked([]);
          }}
        >
          添加上传镜头
        </button>
        <button
          className="action secondary"
          disabled={!total || draft.audio.length >= 20}
          onClick={() => {
            setPicker("audio");
            setPicked([]);
          }}
        >
          添加配音素材
        </button>
        <button
          className="action secondary"
          disabled={!clip || draft.captions.length >= 200}
          onClick={() => {
            if (clip) {
              setCaptionPage(Math.floor(draft.captions.length / trackPageSize));
              edit({
                ...draft,
                captions: [
                  ...draft.captions,
                  {
                    id: uid(),
                    clipId: clip.id,
                    start: 0,
                    duration: clip.duration,
                    text: "请输入字幕",
                  },
                ],
              });
            }
          }}
        >
          添加字幕
        </button>
        <label>
          成片画幅
          <select
            value={draft.format}
            onChange={(e) =>
              edit({ ...draft, format: e.target.value as Timeline["format"] })
            }
          >
            <option value="landscape">横屏 1280 × 720</option>
            <option value="portrait">竖屏 720 × 1280</option>
            <option value="square">方形 720 × 720</option>
          </select>
        </label>
        {dirty && (
          <button
            className="action subtle"
            onClick={() => {
              if (confirm("放弃当前剪辑草稿，恢复服务端已保存版本？")) {
                setDraft(saved);
                setBase(version);
                setError("");
              }
            }}
          >
            恢复服务端版本
          </button>
        )}
      </div>
      {picker && (
        <section className="production-card">
          <h3>
            {picker === "audio" ? "选择或上传配音录音" : "选择或上传镜头素材"}
          </h3>
          <AssetPicker
            key={picker}
            value={picked}
            onChange={setPicked}
            audioOnly={picker === "audio"}
            onUploading={setUploading}
          />
          <div className="production-actions">
            <button
              className="action"
              disabled={!picked.length || uploading}
              onClick={() => void perform(addPicked)}
            >
              加入时间线
            </button>
            <button
              className="action subtle"
              disabled={uploading}
              onClick={() => setPicker(undefined)}
            >
              关闭素材选择
            </button>
          </div>
        </section>
      )}
      <TimelinePreview
        timeline={draft}
        assets={library.assets}
        clock={clock}
        invalid={validation}
      />
      {!!total && (
        <div className="timeline-scroll" aria-label="时间线轨道">
          <div
            className="timeline-tracks"
            style={{
              minWidth: Math.max(550, Math.min(2500, (total / 30) * 35)),
            }}
          >
            <Playhead clock={clock} total={total} />
            <div className="timeline-ruler">
              <span>0 秒</span>
              <span>{seconds(total / 2)} 秒</span>
              <span>{seconds(total)} 秒</span>
            </div>
            <div className="timeline-lane" aria-label="画面轨">
              {draft.clips.map((c) => (
                <button
                  key={c.id}
                  className={
                    c.id === clip?.id
                      ? "timeline-segment selected"
                      : "timeline-segment"
                  }
                  style={{
                    left: `${((starts.get(c.id) ?? 0) / total) * 100}%`,
                    width: `${(c.duration / total) * 100}%`,
                  }}
                  onClick={() => {
                    setSelected(c.id);
                    clock.seek(starts.get(c.id) ?? 0);
                  }}
                  title={c.name}
                >
                  {c.name}
                  {c.transition ? " · 转场" : ""}
                </button>
              ))}
            </div>
            <div className="timeline-lane audio" aria-label="配音轨">
              {draft.audio.map((a) => (
                <span
                  key={a.id}
                  className="timeline-segment"
                  style={{
                    left: `${(absoluteStart(draft, a) / total) * 100}%`,
                    width: `${(a.duration / total) * 100}%`,
                  }}
                  title={a.name}
                >
                  {a.name}
                </span>
              ))}
            </div>
            <div className="timeline-lane captions" aria-label="字幕轨">
              {draft.captions.map((c) => (
                <span
                  key={c.id}
                  className="timeline-segment"
                  style={{
                    left: `${(absoluteStart(draft, c) / total) * 100}%`,
                    width: `${(c.duration / total) * 100}%`,
                  }}
                  title={c.text}
                >
                  {c.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="timeline-layout">
        <section className="timeline-clips">
          <h3>镜头顺序</h3>
          <p className="description">
            拖动手柄，或用上下移按钮排序；键盘聚焦手柄后按空格和方向键。
          </p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={({ active, over }) => {
              if (over && active.id !== over.id)
                edit({
                  ...draft,
                  clips: normalizeClipOrder(
                    arrayMove(
                      draft.clips,
                      draft.clips.findIndex((c) => c.id === active.id),
                      draft.clips.findIndex((c) => c.id === over.id),
                    ),
                  ),
                });
            }}
          >
            <SortableContext
              items={draft.clips.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {draft.clips.map((c, i) => (
                <SortableClip key={c.id} id={c.id} name={c.name}>
                  <button
                    className={
                      clip?.id === c.id
                        ? "timeline-clip-title selected"
                        : "timeline-clip-title"
                    }
                    onClick={() => {
                      setSelected(c.id);
                      clock.seek(starts.get(c.id) ?? 0);
                    }}
                  >
                    <strong>
                      {i + 1}. {c.name}
                    </strong>
                    <small>
                      {seconds(starts.get(c.id) ?? 0)}–
                      {seconds((starts.get(c.id) ?? 0) + c.duration)} 秒
                      {c.candidateId ? " · 采用版快照" : " · 素材引用"}
                    </small>
                  </button>
                  <div className="production-actions">
                    <button
                      className="action subtle"
                      aria-label={`上移剪辑 ${c.name}`}
                      disabled={i === 0}
                      onClick={() => move(c.id, -1)}
                    >
                      上移
                    </button>
                    <button
                      className="action subtle"
                      aria-label={`下移剪辑 ${c.name}`}
                      disabled={i === draft.clips.length - 1}
                      onClick={() => move(c.id, 1)}
                    >
                      下移
                    </button>
                  </div>
                </SortableClip>
              ))}
            </SortableContext>
          </DndContext>
          {!draft.clips.length && (
            <p className="empty">导入已采用镜头，或添加上传的图片和视频。</p>
          )}
        </section>
        <section className="production-card timeline-inspector">
          <h3>当前镜头</h3>
          {clip ? (
            <>
              <div className="timeline-source">
                {library.assets
                  .filter((a) => a.id === clip.assetId)
                  .map((a) => (
                    <AssetPreview key={a.id} asset={a} preload="none" />
                  ))}
              </div>
              <p className="description">
                此处播放原素材；剪辑草稿效果见上方实时多轨预览。
              </p>
              <label>
                镜头名称
                <input
                  maxLength={200}
                  value={clip.name}
                  onChange={(e) => updateClip({ name: e.target.value })}
                />
              </label>
              <div className="timeline-fields">
                <TimeField
                  label="裁剪入点（秒）"
                  value={clip.sourceIn}
                  disabled={clip.kind === "image"}
                  onChange={(sourceIn) => updateClip({ sourceIn })}
                />
                <TimeField
                  label="镜头时长（秒）"
                  value={clip.duration}
                  min={1}
                  onChange={(duration) => updateClip({ duration })}
                />
                <Volume
                  value={clip.volume}
                  label="原声音量"
                  onChange={(volume) => updateClip({ volume })}
                />
              </div>
              <div className="timeline-fields">
                <label>
                  入场转场
                  <select
                    disabled={draft.clips[0]?.id === clip.id}
                    value={clip.transition?.kind ?? "cut"}
                    onChange={(e) =>
                      updateClip({
                        transition:
                          e.target.value === "cut"
                            ? undefined
                            : {
                                kind: e.target.value as "crossfade" | "wipe",
                                duration: clip.transition?.duration ?? 15,
                              },
                      })
                    }
                  >
                    <option value="cut">硬切（无重叠）</option>
                    <option value="crossfade">交叉淡化</option>
                    <option value="wipe">向右擦除</option>
                  </select>
                </label>
                {clip.transition && (
                  <TimeField
                    label="转场时长（秒，最多 3 秒）"
                    min={1}
                    value={clip.transition.duration}
                    onChange={(duration) =>
                      updateClip({
                        transition: { ...clip.transition!, duration },
                      })
                    }
                  />
                )}
              </div>
              <p className="description">
                转场与前一个镜头重叠，原声同步淡入淡出。首镜头无入场转场；镜头绑定的配音与字幕会随新起点移动。
              </p>
              <button
                className="action subtle"
                onClick={() => {
                  if (confirm("移除镜头及绑定的配音和字幕？素材文件会保留。"))
                    edit(removeClip(draft, clip.id));
                }}
              >
                移除此镜头
              </button>
            </>
          ) : (
            <p className="description">尚无镜头</p>
          )}
        </section>
      </div>
      <section className="production-card">
        <h3>配音轨 · {draft.audio.length}</h3>
        <TrackPages
          label="配音"
          total={draft.audio.length}
          page={audioPage}
          onChange={setAudioPage}
        />
        {draft.audio
          .slice(audioPage * trackPageSize, (audioPage + 1) * trackPageSize)
          .map((a) => (
            <article className="timeline-track-form" key={a.id}>
              <strong>{a.name}</strong>
              <div className="timeline-fields">
                <Anchor
                  clips={draft.clips}
                  value={a.clipId}
                  onChange={(clipId) =>
                    edit({
                      ...draft,
                      audio: draft.audio.map((x) =>
                        x.id === a.id ? { ...x, clipId } : x,
                      ),
                    })
                  }
                />
                <TimeField
                  label="配音起点（秒）"
                  value={a.start}
                  onChange={(start) =>
                    edit({
                      ...draft,
                      audio: draft.audio.map((x) =>
                        x.id === a.id ? { ...x, start } : x,
                      ),
                    })
                  }
                />
                <TimeField
                  label="音频裁剪入点（秒）"
                  value={a.sourceIn}
                  onChange={(sourceIn) =>
                    edit({
                      ...draft,
                      audio: draft.audio.map((x) =>
                        x.id === a.id ? { ...x, sourceIn } : x,
                      ),
                    })
                  }
                />
                <TimeField
                  label="配音时长（秒）"
                  min={1}
                  value={a.duration}
                  onChange={(duration) =>
                    edit({
                      ...draft,
                      audio: draft.audio.map((x) =>
                        x.id === a.id ? { ...x, duration } : x,
                      ),
                    })
                  }
                />
                <Volume
                  label="配音音量"
                  value={a.volume}
                  onChange={(volume) =>
                    edit({
                      ...draft,
                      audio: draft.audio.map((x) =>
                        x.id === a.id ? { ...x, volume } : x,
                      ),
                    })
                  }
                />
              </div>
              <p className="description">
                全片 {seconds(absoluteStart(draft, a))}–
                {seconds(absoluteStart(draft, a) + a.duration)} 秒
              </p>
              <AudioWaveform
                track={a}
                start={absoluteStart(draft, a)}
                clock={clock}
                onTrim={(sourceIn, duration) =>
                  edit({
                    ...draft,
                    audio: draft.audio.map((x) =>
                      x.id === a.id ? { ...x, sourceIn, duration } : x,
                    ),
                  })
                }
              />
              {library.assets
                .filter((x) => x.id === a.assetId)
                .map((x) => (
                  <AssetPreview key={x.id} asset={x} preload="none" />
                ))}
              <button
                className="action subtle"
                onClick={() =>
                  edit({
                    ...draft,
                    audio: draft.audio.filter((x) => x.id !== a.id),
                  })
                }
              >
                删除配音
              </button>
            </article>
          ))}
        {!draft.audio.length && (
          <p className="description">
            可使用上传录音或素材库音频。绑定镜头后跟随镜头排序；选择全片可作背景音轨。
          </p>
        )}
      </section>
      <section className="production-card">
        <div className="production-actions">
          <h3>字幕轨 · {draft.captions.length}</h3>
          <button
            className="action subtle"
            disabled={!draft.captions.length || !!validation}
            onClick={() =>
              void perform(async () =>
                downloadText(timelineSrt(draft), `${episode.name}.srt`),
              )
            }
          >
            下载 SRT 字幕
          </button>
        </div>
        <TrackPages
          label="字幕"
          total={draft.captions.length}
          page={captionPage}
          onChange={setCaptionPage}
        />
        {draft.captions
          .slice(captionPage * trackPageSize, (captionPage + 1) * trackPageSize)
          .map((c) => (
            <article className="timeline-track-form" key={c.id}>
              <label>
                字幕文字
                <textarea
                  maxLength={300}
                  value={c.text}
                  onChange={(e) =>
                    edit({
                      ...draft,
                      captions: draft.captions.map((x) =>
                        x.id === c.id ? { ...x, text: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <CaptionStyleEditor
                value={c.style}
                onChange={(style) =>
                  edit({
                    ...draft,
                    captions: draft.captions.map((x) =>
                      x.id === c.id ? { ...x, style } : x,
                    ),
                  })
                }
                onPreview={() => {
                  clock.seek(absoluteStart(draft, c));
                  document
                    .querySelector('[aria-label="实时多轨预览"]')
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
              <div className="timeline-fields">
                <Anchor
                  clips={draft.clips}
                  value={c.clipId}
                  onChange={(clipId) =>
                    edit({
                      ...draft,
                      captions: draft.captions.map((x) =>
                        x.id === c.id ? { ...x, clipId } : x,
                      ),
                    })
                  }
                />
                <TimeField
                  label="字幕起点（秒）"
                  value={c.start}
                  onChange={(start) =>
                    edit({
                      ...draft,
                      captions: draft.captions.map((x) =>
                        x.id === c.id ? { ...x, start } : x,
                      ),
                    })
                  }
                />
                <TimeField
                  label="字幕时长（秒）"
                  min={1}
                  value={c.duration}
                  onChange={(duration) =>
                    edit({
                      ...draft,
                      captions: draft.captions.map((x) =>
                        x.id === c.id ? { ...x, duration } : x,
                      ),
                    })
                  }
                />
              </div>
              <p className="description">
                全片 {seconds(absoluteStart(draft, c))}–
                {seconds(absoluteStart(draft, c) + c.duration)} 秒 ·
                文字将烧录到成片
              </p>
              <button
                className="action subtle"
                onClick={() =>
                  edit({
                    ...draft,
                    captions: draft.captions.filter((x) => x.id !== c.id),
                  })
                }
              >
                删除字幕
              </button>
            </article>
          ))}
        {!draft.captions.length && (
          <p className="description">
            选中镜头后添加字幕，可编辑出现时间和持续时长。当前支持不重叠的单字幕轨。
          </p>
        )}
      </section>
      <section className="production-card">
        <h3>成片预览与导出</h3>
        <p className="description">
          预览由后台合成，下载与预览使用同一份 H.264 / AAC
          MP4。修改剪辑后需保存并生成新版本。
        </p>
        {preview ? (
          <>
            <div className="production-actions">
              <span className={`task-badge ${preview.status}`}>
                {taskLabel(preview)}
              </span>
              <strong>剪辑 v{preview.render?.version}</strong>
              <Link className="action secondary" href={`/jobs/${preview.id}`}>
                查看合成任务
              </Link>
            </div>
            {(dirty || preview.render?.version !== version) && (
              <p className="notice">
                此成片对应剪辑 v{preview.render?.version}，当前已保存为 v
                {version}。{dirty && "尚有未保存修改。"}请确认预览版本后再下载。
              </p>
            )}
            {preview.error && (
              <p role="alert" className="error-message">
                {preview.error.message}
              </p>
            )}
            {preview.status !== "succeeded" && (
              <p className="description">{preview.events.at(-1)?.message}</p>
            )}
            {output && (
              <>
                <video
                  className="timeline-result"
                  src={output.url}
                  controls
                  preload="none"
                />
                <div className="production-actions">
                  <a
                    className="action"
                    href={output.url}
                    download={output.name}
                  >
                    下载成片 MP4
                  </a>
                  <button
                    className="action secondary"
                    onClick={() => {
                      const c: TimelineClip = {
                        id: uid(),
                        assetId: output.id,
                        name: output.name,
                        kind: "video",
                        sourceIn: 0,
                        duration: totalFrames(preview.render!.timeline),
                        volume: 1,
                      };
                      edit({ ...draft, clips: [...draft.clips, c] });
                      setSelected(c.id);
                    }}
                  >
                    作为素材追加到时间线
                  </button>
                  <Link className="action secondary" href="/assets">
                    打开素材库
                  </Link>
                </div>
              </>
            )}
          </>
        ) : (
          <p className="empty">
            {previewId
              ? focused.loaded
                ? focused.error ||
                  "指定合成记录不可用或不属于本集，请从合成记录中选择其他版本。"
                : "读取指定合成记录…"
              : "保存剪辑后点击“生成成片预览”，完成的文件也会出现在任务中心、生成历史和素材库。"}
          </p>
        )}
        {!!jobs.items.length && (
          <details>
            <summary>
              合成记录（本页 {jobs.items.length} / 共 {jobs.total}）
            </summary>
            <div className="timeline-render-list">
              {jobs.items.map((j) => (
                <button
                  key={j.id}
                  className="action subtle"
                  onClick={() => selectPreview(j.id)}
                >
                  v{j.render?.version} · {taskLabel(j)} ·{" "}
                  {new Date(j.createdAt).toLocaleString()}
                </button>
              ))}
            </div>
            <div className="production-actions">
              <button
                className="action subtle"
                disabled={!jobs.hasPrevious}
                onClick={jobs.previous}
              >
                上一页
              </button>
              <button
                className="action subtle"
                disabled={!jobs.nextCursor}
                onClick={jobs.next}
              >
                下一页
              </button>
            </div>
          </details>
        )}
      </section>
    </fieldset>
  );
}
function SortableClip({
  id,
  name,
  children,
}: {
  id: string;
  name: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <article
      ref={setNodeRef}
      className="timeline-clip"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
    >
      <button
        className="timeline-handle"
        {...attributes}
        {...listeners}
        aria-label={`拖动排序 ${name}`}
      >
        <GripVertical size={18} />
      </button>
      <div>{children}</div>
    </article>
  );
}
function TimeField({
  label,
  value,
  onChange,
  min = 0,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        step="0.033333"
        min={min / 30}
        max={600}
        value={seconds(value)}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            Math.max(
              min,
              Math.min(18000, Math.round(Number(e.target.value) * 30)),
            ),
          )
        }
      />
    </label>
  );
}
function Volume({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label>
      {label} · {Math.round(value * 100)}%
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function Anchor({
  clips,
  value,
  onChange,
}: {
  clips: TimelineClip[];
  value?: string;
  onChange: (s: string | undefined) => void;
}) {
  return (
    <label>
      时间基准
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">全片绝对时间</option>
        {clips.map((c, i) => (
          <option key={c.id} value={c.id}>
            {i + 1}. {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
