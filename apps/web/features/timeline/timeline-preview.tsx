"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { LocalAsset, Timeline, TimelineCaption } from "@aivideo/contracts";
import {
  compositionAt,
  clipStarts,
  dimensions,
  totalFrames,
  timelineMixGain,
} from "@aivideo/core/timeline";
import { useBlobURL } from "@/features/assets/use-local-library";
import {
  advancePreviewPosition,
  type PlaybackClock,
  usePlaybackFrame,
} from "./playback-clock";

type MediaEntry = { element: HTMLMediaElement; kind: "video" | "audio" };
function PreviewMedia({
  asset,
  id,
  style,
  entries,
  images,
  onError,
}: {
  asset: LocalAsset;
  id: string;
  style?: CSSProperties;
  entries: Map<string, MediaEntry>;
  images: Map<string, HTMLImageElement>;
  onError: () => void;
}) {
  const url = useBlobURL(asset.blob, asset.url);
  if (asset.kind === "image")
    return (
      <img
        alt={asset.name}
        src={url}
        className="live-preview-layer"
        style={style}
        ref={(el) => {
          if (el) images.set(id, el);
          else images.delete(id);
        }}
        onError={onError}
      />
    );
  if (asset.kind === "audio")
    return (
      <audio
        src={url}
        preload="auto"
        ref={(el) => {
          if (el) entries.set(id, { element: el, kind: "audio" });
          else entries.delete(id);
        }}
        onError={onError}
      />
    );
  return (
    <video
      src={url}
      playsInline
      preload="auto"
      className="live-preview-layer"
      style={style}
      ref={(el) => {
        if (el) entries.set(id, { element: el, kind: "video" });
        else entries.delete(id);
      }}
      onError={onError}
    />
  );
}
function useCaptionRaster(
  caption: TimelineCaption | undefined,
  upcoming: TimelineCaption[],
  format: Timeline["format"],
  playing: boolean,
) {
  const serialize = (c: TimelineCaption) =>
    JSON.stringify({ format, text: c.text, style: c.style });
  const key = caption ? serialize(caption) : "";
  const requests = JSON.stringify([
    ...new Set([
      ...(caption ? [serialize(caption)] : []),
      ...upcoming.map(serialize),
    ]),
  ]);
  const cache = useRef(new Map<string, string>());
  const [error, setError] = useState({ key: "", message: "" });
  const [, refresh] = useState(0);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    // Decode upcoming rasters before their in-point. Only editing is debounced.
    const timer = setTimeout(
      async () => {
        const requested = new Set(JSON.parse(requests) as string[]);
        for (const requestKey of requested) {
          if (abort.signal.aborted) return;
          if (cache.current.has(requestKey)) continue;
          let url: string | undefined;
          try {
            const response = await fetch("/api/production/caption-preview", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: requestKey,
              signal: abort.signal,
            });
            if (!response.ok)
              throw new Error(
                (await response.json()).error?.message ?? "字幕预览失败",
              );
            const blob = await response.blob();
            if (abort.signal.aborted) return;
            url = URL.createObjectURL(blob);
            const image = new Image();
            image.src = url;
            await image.decode();
            if (abort.signal.aborted) {
              URL.revokeObjectURL(url);
              return;
            }
            if (cache.current.size >= 12) {
              // A seek may reuse an old raster while preloading new neighbors.
              // Never evict the currently displayed or requested rasters.
              const first = [...cache.current.keys()].find(
                (k) => !requested.has(k),
              );
              if (first) {
                URL.revokeObjectURL(cache.current.get(first)!);
                cache.current.delete(first);
              }
            }
            cache.current.set(requestKey, url);
            refresh((n) => n + 1);
            setError((e) =>
              e.key === requestKey ? { key: "", message: "" } : e,
            );
          } catch (e) {
            if (url) URL.revokeObjectURL(url);
            if (!abort.signal.aborted && requestKey === key)
              setError({
                key,
                message:
                  e instanceof TypeError
                    ? "字幕载入失败，请检查网络后重试"
                    : e instanceof Error
                      ? e.message
                      : "字幕预览失败",
              });
          }
        }
      },
      playing ? 0 : 180,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [requests, key, retry, playing]);
  useEffect(() => {
    const urls = cache.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);
  return {
    url: cache.current.get(key) ?? "",
    error: error.key === key ? error.message : "",
    ready: !key || cache.current.has(key),
    retry: () => {
      setError({ key: "", message: "" });
      setRetry((n) => n + 1);
    },
  };
}
export function TimelinePreview({
  timeline,
  assets,
  clock,
  invalid,
}: {
  timeline: Timeline;
  assets: LocalAsset[];
  clock: PlaybackClock;
  invalid?: string;
}) {
  const frame = usePlaybackFrame(clock),
    total = Math.max(0, totalFrames(timeline));
  const starts = useMemo(() => clipStarts(timeline), [timeline]);
  const audioTracks = useMemo(
    () =>
      timeline.audio.map((a) => ({
        ...a,
        at: a.start + (a.clipId ? (starts.get(a.clipId) ?? 0) : 0),
      })),
    [timeline, starts],
  );
  const captions = useMemo(
    () =>
      timeline.captions
        .map((c) => ({
          ...c,
          at: c.start + (c.clipId ? (starts.get(c.clipId) ?? 0) : 0),
        }))
        .sort((a, b) => a.at - b.at),
    [timeline, starts],
  );
  const mixGain = useMemo(() => timelineMixGain(timeline), [timeline]);
  const [playing, setPlaying] = useState(false),
    [error, setError] = useState(""),
    [buffering, setBuffering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    captionImage = useRef<HTMLImageElement>(null);
  const entries = useRef(new Map<string, MediaEntry>()),
    images = useRef(new Map<string, HTMLImageElement>());
  const visibleFrame = Math.min(frame, Math.max(0, total - 1));
  const layers = compositionAt(timeline, visibleFrame, starts);
  const lastIndex = Math.max(
    0,
    ...layers.map((l) => timeline.clips.indexOf(l.clip)),
  );
  const pool = timeline.clips.filter(
    (c, i) => layers.some((l) => l.clip.id === c.id) || i === lastIndex + 1,
  );
  // Keep active voices and a short lookahead, not every source in the movie.
  // Loading all twenty full audio files starves the current video on slow links.
  const audioPool = audioTracks.filter(
    (a) => a.at <= visibleFrame + 90 && a.at + a.duration > visibleFrame,
  );
  const caption = captions.find(
    (c) => visibleFrame >= c.at && visibleFrame < c.at + c.duration,
  );
  const upcoming = captions.filter((c) => c.at > visibleFrame).slice(0, 2);
  const raster = useCaptionRaster(caption, upcoming, timeline.format, playing);
  const captionReady = useRef(true);
  captionReady.current = raster.ready;
  const [w, h] = dimensions[timeline.format];
  const pauseAll = () =>
    entries.current.forEach(({ element }) => element.pause());
  const redraw = useRef(() => {});
  const playAttempt = useRef(0);
  useEffect(() => {
    redraw.current();
  }, [raster.url]);
  function seek(value: number) {
    playAttempt.current++;
    setPlaying(false);
    pauseAll();
    setError("");
    clock.setFrame(Math.max(0, Math.min(total, Math.round(value))));
  }
  useEffect(() => {
    clock.seek = seek;
    return () => {
      clock.seek = () => {};
    };
  });
  useEffect(() => {
    playAttempt.current++;
    setPlaying(false);
    pauseAll();
    setError("");
    clock.setFrame(Math.min(clock.getSnapshot(), total));
  }, [timeline, clock, total]);
  useEffect(() => {
    const stop = () => {
      if (document.hidden) {
        playAttempt.current++;
        setPlaying(false);
        pauseAll();
      }
    };
    const otherPlayback = (event: Event) => {
      if (
        event.target instanceof HTMLMediaElement &&
        ![...entries.current.values()].some(
          ({ element }) => element === event.target,
        )
      ) {
        playAttempt.current++;
        setPlaying(false);
        pauseAll();
      }
    };
    document.addEventListener("visibilitychange", stop);
    document.addEventListener("play", otherPlayback, true);
    return () => {
      document.removeEventListener("visibilitychange", stop);
      document.removeEventListener("play", otherPlayback, true);
      pauseAll();
    };
  }, []);
  useEffect(() => {
    let request = 0,
      disposed = false,
      last = performance.now(),
      position = clock.getSnapshot(),
      stalledAt = 0;
    const pending = new WeakSet<HTMLMediaElement>();
    const context = canvas.current?.getContext("2d", {
      alpha: false,
      colorSpace: "srgb",
    });
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = w;
    sourceCanvas.height = h;
    const sourceContext = sourceCanvas.getContext("2d", {
      alpha: false,
      colorSpace: "srgb",
    });
    const draw = () => {
      if (!context || !sourceContext) return;
      context.globalAlpha = 1;
      context.fillStyle = "#000";
      context.fillRect(0, 0, w, h);
      for (const layer of compositionAt(
        timeline,
        Math.min(clock.getSnapshot(), Math.max(0, total - 1)),
        starts,
      )) {
        const media =
          layer.clip.kind === "image"
            ? images.current.get(layer.clip.id)
            : (entries.current.get(layer.clip.id)?.element as
                | HTMLVideoElement
                | undefined);
        if (!media) continue;
        const sw =
            media instanceof HTMLImageElement
              ? media.naturalWidth
              : media.videoWidth,
          sh =
            media instanceof HTMLImageElement
              ? media.naturalHeight
              : media.videoHeight;
        if (
          !sw ||
          !sh ||
          (media instanceof HTMLVideoElement && media.readyState < 2)
        )
          continue;
        const scale = Math.min(w / sw, h / sh),
          dw = Math.max(2, Math.floor((sw * scale) / 2) * 2),
          dh = Math.max(2, Math.floor((sh * scale) / 2) * 2);
        context.save();
        context.beginPath();
        context.rect(0, 0, w * layer.reveal, h);
        context.clip();
        context.globalAlpha = layer.opacity;
        // Flatten transparency and letterboxing before fading the whole layer.
        sourceContext.fillStyle = "#000";
        sourceContext.fillRect(0, 0, w, h);
        sourceContext.drawImage(media, (w - dw) / 2, (h - dh) / 2, dw, dh);
        context.drawImage(sourceCanvas, 0, 0);
        context.restore();
      }
      const subtitle = captionImage.current;
      if (subtitle?.complete && subtitle.naturalWidth)
        context.drawImage(subtitle, 0, 0, w, h);
    };
    redraw.current = draw;
    const fail = (message: string) => {
      if (!disposed) {
        setError(message);
        setPlaying(false);
        pauseAll();
      }
    };
    function tick(now: number) {
      const current = clock.getSnapshot();
      const active = compositionAt(
        timeline,
        Math.min(current, Math.max(0, total - 1)),
        starts,
      );
      let ready = captionReady.current;
      let mediaFrame: number | undefined;
      let audioClock = false;
      for (const layer of active) {
        if (layer.clip.kind === "image") {
          const img = images.current.get(layer.clip.id);
          if (!img?.complete || !img.naturalWidth) ready = false;
        } else if (!entries.current.has(layer.clip.id)) ready = false;
      }
      for (const track of audioTracks)
        if (
          current >= track.at &&
          current < track.at + track.duration &&
          !entries.current.has(track.id)
        )
          ready = false;
      entries.current.forEach(({ element, kind }, id) => {
        const layer = active.find((l) => l.clip.id === id);
        const track =
          kind === "audio" ? audioTracks.find((a) => a.id === id) : undefined;
        const clip =
          kind === "video"
            ? timeline.clips.find((c) => c.id === id)
            : undefined;
        const start = track?.at ?? 0;
        const enabled =
          (!!layer && current < total) ||
          (!!track && current >= start && current < start + track.duration);
        const sourceTime = layer
          ? layer.sourceFrame / 30
          : track
            ? (track.sourceIn + Math.max(0, current - start)) / 30
            : (clip?.sourceIn ?? 0) / 30;
        const ended =
          Number.isFinite(element.duration) && sourceTime >= element.duration;
        // Native playback starts asynchronously. On slow CPUs, advancing the
        // wall clock before play() starts repeatedly forces seeks and pauses.
        // Follow a live audio source (or video) while it exists; still images
        // and held video tails use elapsed time when no media clock is active.
        if (
          enabled &&
          !ended &&
          (mediaFrame === undefined || (kind === "audio" && !audioClock))
        ) {
          mediaFrame = current + (element.currentTime - sourceTime) * 30;
          audioClock = kind === "audio";
        }
        const desired = Math.max(
          0,
          Math.min(
            sourceTime,
            Number.isFinite(element.duration)
              ? Math.max(0, element.duration - 1 / 30)
              : sourceTime,
          ),
        );
        element.volume =
          enabled && !ended
            ? Math.max(
                0,
                Math.min(1, (layer?.gain ?? track?.volume ?? 0) * mixGain),
              )
            : 0;
        if (
          element.readyState >= 1 &&
          Math.abs(element.currentTime - desired) >
            (playing && enabled ? 0.12 : 0.02) &&
          !element.seeking
        )
          element.currentTime = desired;
        if (enabled && element.error)
          fail("素材载入失败，请检查网络后重新加载预览素材");
        if (enabled && (element.readyState < 2 || element.seeking))
          ready = false;
        if (!playing || !enabled || ended) element.pause();
        else if (ready && element.paused && !pending.has(element)) {
          pending.add(element);
          void element
            .play()
            .catch((e) => {
              if (e.name !== "AbortError")
                fail("浏览器未能播放素材，请点击播放重试或检查媒体格式");
            })
            .finally(() => pending.delete(element));
        }
      });
      if (!ready && playing) {
        pauseAll();
        if (!stalledAt) stalledAt = now;
        if (now - stalledAt > 30000)
          fail("素材或字幕载入超时，请检查网络后重新加载预览素材");
      } else stalledAt = 0;
      setBuffering(playing && !ready);
      draw();
      if (playing && ready) {
        // Media keeps advancing during a busy main-thread frame. Dropping elapsed
        // time here makes long previews run slow and repeatedly seeks audio back.
        // Buffering/hidden tabs already pause media and reset the clock above.
        position = advancePreviewPosition(position, now - last, mediaFrame);
        if (position >= total) {
          clock.setFrame(total);
          setPlaying(false);
          pauseAll();
        } else clock.setFrame(Math.floor(position));
      } else position = current;
      last = now;
      if (playing) request = requestAnimationFrame(tick);
    }
    const schedule = () => {
      if (!playing) {
        cancelAnimationFrame(request);
        request = requestAnimationFrame(tick);
      }
    };
    const unsubscribe = clock.subscribe(schedule);
    const mediaReady = (event: Event) => {
      if (
        [...entries.current.values()].some(
          ({ element }) => element === event.target,
        ) ||
        [...images.current.values()].some((image) => image === event.target) ||
        captionImage.current === event.target
      )
        schedule();
    };
    document.addEventListener("loadeddata", mediaReady, true);
    document.addEventListener("load", mediaReady, true);
    document.addEventListener("seeked", mediaReady, true);
    request = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(request);
      unsubscribe();
      document.removeEventListener("loadeddata", mediaReady, true);
      document.removeEventListener("load", mediaReady, true);
      redraw.current = () => {};
      document.removeEventListener("seeked", mediaReady, true);
      pauseAll();
    };
  }, [timeline, playing, total, clock, mixGain, starts, audioTracks, w, h]);
  function reloadFailedMedia(restartStalled = false) {
    entries.current.forEach(({ element }) => {
      // A rejected HTMLMediaElement stays in the error state even when the
      // network returns. play() alone cannot retry its source request.
      if (
        element.error ||
        element.networkState === HTMLMediaElement.NETWORK_NO_SOURCE ||
        (restartStalled && element.readyState === 0)
      )
        element.load();
    });
    images.current.forEach((image) => {
      if (image.complete && !image.naturalWidth) image.src = image.src;
    });
    raster.retry();
    setError("");
  }
  function retryMedia() {
    playAttempt.current++;
    setPlaying(false);
    pauseAll();
    reloadFailedMedia(true);
  }
  function toggle() {
    const attempt = ++playAttempt.current;
    if (playing) {
      setPlaying(false);
      pauseAll();
      return;
    }
    if (frame >= total) clock.setFrame(0);
    reloadFailedMedia();
    // Stop source inspectors so audition audio does not double the composed mix.
    document
      .querySelectorAll<HTMLMediaElement>("video, audio")
      .forEach((element) => element.pause());
    // Start active media inside the gesture. Future sources must not steal
    // bandwidth or fail the current playback before their own in-point.
    const at = clock.getSnapshot();
    const activeIds = new Set([
      ...compositionAt(timeline, at, starts).map((l) => l.clip.id),
      ...audioTracks
        .filter((a) => at >= a.at && at < a.at + a.duration)
        .map((a) => a.id),
    ]);
    entries.current.forEach(({ element }, id) => {
      if (!activeIds.has(id)) return;
      element.volume = 0;
      void element.play().catch((e) => {
        if (e.name !== "AbortError" && attempt === playAttempt.current) {
          setError(
            "素材载入或播放失败，请检查网络后重新加载；不支持的格式需转换为 MP4 / WAV",
          );
          setPlaying(false);
          pauseAll();
        }
      });
    });
    setPlaying(true);
  }
  const activeAudio = audioTracks.filter(
    (a) => frame >= a.at && frame < a.at + a.duration,
  );
  return (
    <section className="production-card live-preview" aria-label="实时多轨预览">
      <div className="production-actions">
        <h3>实时多轨预览</h3>
        <span className="description">当前剪辑草稿 · 无需生成任务</span>
      </div>
      <div
        className="live-preview-stage"
        style={{ aspectRatio: `${w}/${h}`, maxWidth: (w / h) * 560 }}
      >
        <canvas
          ref={canvas}
          width={w}
          height={h}
          className="live-preview-canvas"
          aria-label="当前剪辑合成画面"
        />
        {pool.map((c) => {
          const asset = assets.find((a) => a.id === c.assetId),
            layer = layers.find((l) => l.clip.id === c.id);
          return asset ? (
            <PreviewMedia
              key={c.id}
              id={c.id}
              asset={asset}
              entries={entries.current}
              images={images.current}
              onError={() => {
                if (layer) {
                  setError(
                    `无法载入 ${c.name}，请检查网络或素材格式后重新加载`,
                  );
                  setPlaying(false);
                  pauseAll();
                }
              }}
              style={{
                opacity: layer?.opacity ?? 0,
                clipPath: `inset(0 ${(1 - (layer?.reveal ?? 1)) * 100}% 0 0)`,
                zIndex: timeline.clips.indexOf(c),
              }}
            />
          ) : null;
        })}
        {raster.url && (
          <img
            src={raster.url}
            alt={caption?.text ?? ""}
            className="live-preview-caption"
            ref={captionImage}
          />
        )}
        {!total && (
          <span className="live-preview-empty">添加镜头后即可播放</span>
        )}
      </div>
      <div className="live-preview-audio" aria-hidden="true">
        {audioPool.map((a) => {
          const asset = assets.find((x) => x.id === a.assetId);
          return asset ? (
            <PreviewMedia
              key={a.id}
              id={a.id}
              asset={asset}
              entries={entries.current}
              images={images.current}
              onError={() => {
                if (frame >= a.at && frame < a.at + a.duration) {
                  setError(`无法载入配音 ${a.name}，请检查网络后重新加载`);
                  setPlaying(false);
                  pauseAll();
                }
              }}
            />
          ) : null;
        })}
      </div>
      <label className="preview-scrubber">
        预览进度 · {(frame / 30).toFixed(2)} / {(total / 30).toFixed(2)} 秒
        <input
          aria-label="实时预览进度"
          type="range"
          min={0}
          max={Math.max(1, total)}
          step={1}
          value={Math.min(frame, Math.max(1, total))}
          disabled={!total}
          onChange={(e) => seek(Number(e.target.value))}
        />
      </label>
      <div className="production-actions">
        <label className="preview-time-input">
          定位时间（秒）
          <input
            aria-label="定位时间（秒）"
            type="number"
            min={0}
            max={total / 30}
            step={1 / 30}
            value={Number((frame / 30).toFixed(3))}
            disabled={!total}
            onChange={(e) => seek(Number(e.target.value) * 30)}
          />
        </label>
        <button
          className="action"
          disabled={!total || !!invalid}
          onClick={toggle}
        >
          {playing ? "暂停实时预览" : "播放实时预览"}
        </button>
        <button
          className="action subtle"
          disabled={!total || frame === 0}
          onClick={() => seek(frame - 1)}
        >
          上一帧
        </button>
        <button
          className="action subtle"
          disabled={!total || frame >= total}
          onClick={() => seek(frame + 1)}
        >
          下一帧
        </button>
        <button
          className="action subtle"
          disabled={!total}
          onClick={() => seek(0)}
        >
          回到开头
        </button>
      </div>
      <p className="description" aria-label="预览轨道状态">
        {buffering
          ? "正在缓冲，预览时钟已暂停…"
          : `画面 ${layers.length} 层 · 配音 ${activeAudio.length} 轨 · ${caption ? "字幕显示中" : "无字幕"}`}
      </p>
      <p className="description">
        原声、配音与字幕同步播放；修改剪辑会暂停。预览与导出使用相同的混音余量
        （{Math.round(mixGain * 100)}%），避免多轨叠加失真。
      </p>
      {(error || raster.error) && (
        <p role="alert" className="error-message">
          {error || raster.error}
          {error && (
            <button className="action subtle" onClick={retryMedia}>
              重新加载预览素材
            </button>
          )}
          {raster.error && (
            <button className="action subtle" onClick={raster.retry}>
              重试字幕预览
            </button>
          )}
        </p>
      )}
    </section>
  );
}
