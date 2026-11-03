"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRefreshLoop } from "@aivideo/core/refresh-loop";
import { LOCAL_CHANGE } from "@aivideo/core/local";
import { workspaceBackend } from "@aivideo/core/workspace-client";
export function useWorkspaceQuery<T>(
  load: () => Promise<T>,
  initial: T,
  stores: readonly string[],
  pollMs: number,
  shouldPoll?: (data: T) => boolean,
) {
  const [data, setData] = useState(initial),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const [backend, setBackend] = useState<"browser" | "server">("browser");
  const [source, setSource] = useState(() => load);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let active = true,
      timer: ReturnType<typeof setInterval> | undefined;
    let latestValue = initial;
    setSource(() => load);
    setData(initial);
    setLoaded(false);
    setError("");
    const controller = createRefreshLoop(
      load,
      (value) => {
        latestValue = value;
        setData(value);
        setError("");
        setLoaded(true);
      },
      (reason) => {
        setError(reason instanceof Error ? reason.message : "读取工作区失败");
        setLoaded(true);
        if (
          ["UNAUTHORIZED", "AUTH_NOT_CONFIGURED"].includes(
            (reason as { code?: string })?.code ?? "",
          )
        )
          setData(initial);
      },
    );
    refreshRef.current = controller.refresh;
    void controller.refresh();
    void workspaceBackend()
      .then((mode) => {
        if (!active) return;
        setBackend(mode);
        if (mode === "server" && pollMs > 0)
          timer = setInterval(() => {
            if (!shouldPoll || shouldPoll(latestValue))
              void controller.refresh();
          }, pollMs);
      })
      .catch(() => {});
    const changed = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        stores.includes(event.detail?.store)
      )
        void controller.refresh();
    };
    window.addEventListener(LOCAL_CHANGE, changed);
    window.addEventListener("focus", controller.refresh);
    return () => {
      active = false;
      controller.stop();
      if (timer) clearInterval(timer);
      window.removeEventListener(LOCAL_CHANGE, changed);
      window.removeEventListener("focus", controller.refresh);
    };
  }, [load, initial, stores, pollMs, shouldPoll]);
  return {
    data: source === load ? data : initial,
    loaded: source === load && loaded,
    error: source === load ? error : "",
    backend,
    refresh,
  };
}
