"use client";
import { forwardRef, useEffect, useState } from "react";
import { localAssetURL, referenceID } from "@aivideo/core/local";

export async function resolveMediaURL(src) {
  const id = referenceID(src);
  return id ? localAssetURL(id) : src;
}
function useSource(src) {
  const [resolved, setResolved] = useState(referenceID(src) ? undefined : src);
  useEffect(() => {
    let active = true;
    let owned;
    if (!referenceID(src)) {
      setResolved(src);
      return;
    }
    setResolved(undefined);
    resolveMediaURL(src)
      .then((url) => {
        if (active) {
          owned = url;
          setResolved(url);
        } else URL.revokeObjectURL(url);
      })
      .catch(() => {
        if (active) setResolved(undefined);
      });
    return () => {
      active = false;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [src]);
  return resolved;
}
export const LocalImage = forwardRef(function LocalImage(
  { src, fill, unoptimized, priority, ...props },
  ref,
) {
  const resolved = useSource(src);
  return (
    <img
      {...props}
      ref={ref}
      src={resolved}
      style={
        fill
          ? {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              ...props.style,
            }
          : props.style
      }
    />
  );
});
export const LocalVideo = forwardRef(function LocalVideo(
  { src, ...props },
  ref,
) {
  return <video {...props} src={useSource(src)} ref={ref} />;
});
export const LocalAudio = forwardRef(function LocalAudio(
  { src, ...props },
  ref,
) {
  return <audio {...props} src={useSource(src)} ref={ref} />;
});
