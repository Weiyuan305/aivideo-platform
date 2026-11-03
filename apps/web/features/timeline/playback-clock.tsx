"use client";
import { useSyncExternalStore } from "react";
/** Follow decoded media when present; use wall time for still-only intervals. */
export function advancePreviewPosition(
  position: number,
  elapsedMs: number,
  mediaFrame?: number,
) {
  return mediaFrame === undefined
    ? position + (Math.max(0, elapsedMs) * 30) / 1000
    : Math.max(position, mediaFrame);
}
export function createPlaybackClock() {
  let frame = 0;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => frame,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setFrame: (value: number) => {
      if (value !== frame) {
        frame = value;
        listeners.forEach((f) => f());
      }
    },
    seek: (_value: number) => {},
  };
}
export type PlaybackClock = ReturnType<typeof createPlaybackClock>;
export const usePlaybackFrame = (clock: PlaybackClock) =>
  useSyncExternalStore(clock.subscribe, clock.getSnapshot, () => 0);
export function Playhead({
  clock,
  total,
}: {
  clock: PlaybackClock;
  total: number;
}) {
  const frame = usePlaybackFrame(clock);
  return (
    <span
      className="timeline-playhead"
      style={{ left: `${(frame / Math.max(1, total)) * 100}%` }}
      aria-hidden="true"
    />
  );
}
