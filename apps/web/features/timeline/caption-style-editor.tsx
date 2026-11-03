"use client";
import type { CaptionStyle } from "@aivideo/contracts";
import { defaultCaptionStyle } from "@aivideo/core/timeline";
export function CaptionStyleEditor({
  value,
  onChange,
  onPreview,
}: {
  value?: CaptionStyle;
  onChange: (s: CaptionStyle) => void;
  onPreview: () => void;
}) {
  const style = value ?? defaultCaptionStyle;
  const change = (patch: Partial<CaptionStyle>) =>
    onChange({ ...style, ...patch });
  return (
    <fieldset className="caption-style">
      <legend>字幕样式</legend>
      <div className="production-actions">
        <button
          type="button"
          className="action subtle"
          onClick={() => onChange({ ...defaultCaptionStyle })}
        >
          经典白字
        </button>
        <button
          type="button"
          className="action subtle"
          onClick={() =>
            onChange({
              ...defaultCaptionStyle,
              color: "#ffd84d",
              bold: true,
              fontSize: 42,
              backgroundOpacity: 0.6,
            })
          }
        >
          醒目黄字
        </button>
        <button
          type="button"
          className="action subtle"
          onClick={() =>
            onChange({
              ...defaultCaptionStyle,
              position: "center",
              fontSize: 56,
              bold: true,
              backgroundOpacity: 0.4,
            })
          }
        >
          居中标题
        </button>
        <button type="button" className="action secondary" onClick={onPreview}>
          预览此字幕
        </button>
      </div>
      <div className="timeline-fields">
        <label>
          字号（输出像素）
          <input
            type="number"
            min={20}
            max={80}
            value={style.fontSize}
            onChange={(e) => change({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label>
          文字颜色
          <input
            type="color"
            value={style.color}
            onChange={(e) => change({ color: e.target.value })}
          />
        </label>
        <label>
          字幕底色
          <input
            type="color"
            value={style.background}
            onChange={(e) => change({ background: e.target.value })}
          />
        </label>
        <label>
          底色不透明度 {Math.round(style.backgroundOpacity * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={style.backgroundOpacity}
            onChange={(e) =>
              change({ backgroundOpacity: Number(e.target.value) })
            }
          />
        </label>
        <label>
          字幕位置
          <select
            value={style.position}
            onChange={(e) =>
              change({ position: e.target.value as CaptionStyle["position"] })
            }
          >
            <option value="bottom">底部</option>
            <option value="center">居中</option>
            <option value="top">顶部</option>
          </select>
        </label>
        <label>
          文字对齐
          <select
            value={style.align}
            onChange={(e) =>
              change({ align: e.target.value as CaptionStyle["align"] })
            }
          >
            <option value="left">左对齐</option>
            <option value="center">居中</option>
            <option value="right">右对齐</option>
          </select>
        </label>
        <label className="caption-bold">
          <input
            type="checkbox"
            checked={style.bold}
            onChange={(e) => change({ bold: e.target.checked })}
          />
          粗体
        </label>
      </div>
    </fieldset>
  );
}
