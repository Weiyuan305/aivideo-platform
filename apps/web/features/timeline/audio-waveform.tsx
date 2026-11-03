"use client";
import { useEffect, useRef, useState } from "react";
import type WaveSurfer from "wavesurfer.js";
import type { TimelineAudio } from "@aivideo/contracts";
import { workspaceRequest } from "@aivideo/core/workspace-client";
import { type PlaybackClock } from "./playback-clock";
// Serialize per-tab requests; the server also bounds concurrent decoders.
let pending = Promise.resolve();
export function AudioWaveform({
  track,
  start,
  clock,
  onTrim,
}: {
  track: TimelineAudio;
  start: number;
  clock: PlaybackClock;
  onTrim: (sourceIn: number, duration: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const wave = useRef<WaveSurfer | null>(null);
  const sync = useRef(() => {});
  const latest = useRef({ track, start, onTrim });
  latest.current = { track, start, onTrim };
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    let disposed = false;
    const abort = new AbortController();
    let cleanup = () => {};
    setReady(false);
    setError("");
    const run = async () => {
      if (disposed) return;
      try {
        const [data, { default: WS }, { default: Regions }] = await Promise.all(
          [
            workspaceRequest<{ peaks: number[]; duration: number }>(
              `/api/workspace/assets/${track.assetId}/waveform`,
              { signal: abort.signal },
            ),
            import("wavesurfer.js"),
            import("wavesurfer.js/dist/plugins/regions.esm.js"),
          ],
        );
        if (disposed || !container.current) return;
        const regions = Regions.create();
        const ws = WS.create({
          container: container.current,
          peaks: [data.peaks],
          duration: data.duration,
          height: 64,
          waveColor: "#83a89c",
          progressColor: "#28765d",
          cursorColor: "#dc8248",
          barWidth: 2,
          normalize: true,
          interact: true,
          plugins: [regions],
        });
        wave.current = ws;
        setDuration(data.duration);
        const setRegion = () => {
          const a = latest.current.track;
          regions.clearRegions();
          regions.addRegion({
            id: "trim",
            start: a.sourceIn / 30,
            end: Math.min(data.duration, (a.sourceIn + a.duration) / 30),
            color: "rgba(40,118,93,0.16)",
            drag: true,
            resize: true,
            minLength: 1 / 30,
          });
        };
        ws.on("ready", () => {
          if (!disposed) {
            setRegion();
            setReady(true);
          }
        });
        const updateRegion = () => {
          const a = latest.current.track,
            region = regions.getRegions()[0];
          if (
            region &&
            (Math.abs(region.start - a.sourceIn / 30) > 0.001 ||
              Math.abs(
                region.end -
                  Math.min(data.duration, (a.sourceIn + a.duration) / 30),
              ) > 0.001)
          )
            region.setOptions({
              start: a.sourceIn / 30,
              end: Math.min(data.duration, (a.sourceIn + a.duration) / 30),
            });
          const time =
            (clock.getSnapshot() - latest.current.start + a.sourceIn) / 30;
          ws.setTime(Math.max(0, Math.min(data.duration, time)));
        };
        const unsubscribe = clock.subscribe(updateRegion);
        sync.current = updateRegion;
        ws.on("interaction", (time) => {
          const { track: a, start } = latest.current;
          const offset = Math.min(
            a.duration - 1,
            Math.max(0, Math.round(time * 30) - a.sourceIn),
          );
          clock.seek(start + offset);
        });
        regions.on("region-update", () => clock.seek(clock.getSnapshot()));
        regions.on("region-updated", (region) => {
          const sourceIn = Math.max(0, Math.round(region.start * 30));
          latest.current.onTrim(
            sourceIn,
            Math.max(1, Math.round(region.end * 30) - sourceIn),
          );
        });
        ws.on("error", () => {
          if (!disposed) setError("波形显示失败，可重试或使用时间字段裁剪");
        });
        cleanup = () => {
          unsubscribe();
          sync.current = () => {};
          ws.destroy();
          wave.current = null;
        };
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "波形载入失败");
      }
    };
    pending = pending.then(run, run);
    return () => {
      disposed = true;
      abort.abort();
      cleanup();
    };
  }, [track.assetId, clock, retry]);
  useEffect(() => {
    sync.current();
  }, [track.sourceIn, track.duration, start, ready]);
  return (
    <div className="audio-waveform">
      <div ref={container} aria-label={`${track.name} 音频波形`} />
      {error ? (
        <p role="status">
          {error}{" "}
          <button
            className="action subtle"
            onClick={() => setRetry((n) => n + 1)}
          >
            重试波形
          </button>
        </p>
      ) : (
        <p className="description">
          {ready
            ? `波形已就绪 · 原音频 ${duration.toFixed(2)} 秒。阴影区为采用片段；拖动两端裁剪，点击定位预览。`
            : "正在分析音频波形…"}
        </p>
      )}
      <button className="action subtle" onClick={() => clock.seek(start)}>
        定位此配音
      </button>
    </div>
  );
}
