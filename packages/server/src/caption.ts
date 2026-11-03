import sharp from "sharp";
import { captionPreviewSchema } from "@aivideo/contracts";
import { defaultCaptionStyle, dimensions } from "@aivideo/core/timeline";
import { ServiceError } from "./types";

const cache = new Map<string, Buffer>();
let active = 0;
const escapeMarkup = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// The browser and the encoder consume this exact raster, including CJK wrapping.
export async function captionPng(raw: unknown): Promise<Buffer> {
  const parsed = captionPreviewSchema.safeParse(raw);
  if (!parsed.success)
    throw new ServiceError("INVALID_CAPTION", "字幕样式或文字无效");
  const { format, text, style = defaultCaptionStyle } = parsed.data;
  const key = JSON.stringify({ format, text, style });
  const cached = cache.get(key);
  if (cached) return cached;
  if (active >= 4)
    throw new ServiceError("PREVIEW_BUSY", "字幕预览繁忙，请稍后重试", 429);
  active++;
  try {
    const [w, h] = dimensions[format];
    const family = (process.env.RENDER_FONT || "sans").replace(/\s+\d+$/, "");
    const glyph = await sharp({
      text: {
        text: `<span foreground="${style.color}" weight="${style.bold ? "bold" : "normal"}">${escapeMarkup(text)}</span>`,
        font: `${family} ${style.fontSize}`,
        ...(process.env.RENDER_FONT_FILE
          ? { fontfile: process.env.RENDER_FONT_FILE }
          : {}),
        width: w - 96,
        align: style.align === "center" ? "centre" : style.align,
        rgba: true,
        wrap: "word-char",
      },
    })
      .resize({
        width: w - 96,
        height: Math.floor(h * 0.35),
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    const background = {
      r: parseInt(style.background.slice(1, 3), 16),
      g: parseInt(style.background.slice(3, 5), 16),
      b: parseInt(style.background.slice(5, 7), 16),
      alpha: style.backgroundOpacity,
    };
    const boxHeight = glyph.info.height + 24;
    const left =
      style.align === "left"
        ? 24
        : style.align === "right"
          ? w - 72 - glyph.info.width
          : Math.floor((w - 48 - glyph.info.width) / 2);
    const box = await sharp({
      create: { width: w - 48, height: boxHeight, channels: 4, background },
    })
      .composite([{ input: glyph.data, left, top: 12 }])
      .png()
      .toBuffer();
    const top =
      style.position === "top"
        ? 40
        : style.position === "center"
          ? Math.floor((h - boxHeight) / 2)
          : h - boxHeight - 40;
    const result = await sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: box, left: 24, top }])
      .png()
      .toBuffer();
    if (cache.size >= 48) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  } finally {
    active--;
  }
}
