import { ServiceError } from "./types";
export type MediaColor = {
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  width?: number;
  height?: number;
};
// Normalize SDR sources before compositing; never interpolate arbitrary metadata
// into a filter. Unspecified video follows the browser's usual HD/SD fallback.
export function videoColorFilter(info: MediaColor) {
  if (["smpte2084", "arib-std-b67"].includes(info.color_transfer ?? ""))
    throw new ServiceError(
      "UNSUPPORTED_COLOR",
      "请先将 HDR 素材转换为 SDR，再参与剪辑；当前不提供 HDR 色调映射",
    );
  const select = (
    value: string | undefined,
    allowed: string[],
    fallback: string,
  ) => (allowed.includes(value ?? "") ? value! : fallback);
  const matrix = select(
    info.color_space,
    ["bt709", "bt470bg", "smpte170m", "smpte240m", "fcc", "bt2020nc"],
    (info.width ?? 0) >= 1280 || (info.height ?? 0) > 576
      ? "bt709"
      : "smpte170m",
  );
  const primaries = select(
    info.color_primaries,
    [
      "bt709",
      "bt470m",
      "bt470bg",
      "smpte170m",
      "smpte240m",
      "bt2020",
      "smpte431",
      "smpte432",
    ],
    "bt709",
  );
  const transfer = select(
    info.color_transfer,
    [
      "bt709",
      "bt470m",
      "bt470bg",
      "smpte170m",
      "smpte240m",
      "linear",
      "iec61966-2-1",
      "bt2020-10",
      "bt2020-12",
    ],
    "bt709",
  );
  return `setparams=colorspace=${matrix}:color_primaries=${primaries}:color_trc=${transfer},colorspace=all=bt709:trc=srgb:format=yuv420p:range=tv`;
}
export const outputColorArgs = [
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "iec61966-2-1",
  "-color_range",
  "tv",
];

export const outputColorFilter =
  "setparams=colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1:range=limited";
