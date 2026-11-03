"use client";
import { useEffect, useState, useId } from "react";
import { workspaceRequest, serverAsset } from "@aivideo/core/workspace-client";
import { saveFile } from "@aivideo/core/local";
import { assetOptionLabel } from "@aivideo/core/asset-label";
import type { LocalAsset } from "@aivideo/contracts";
import { AssetPreview } from "@/features/assets/asset-library";
export function AssetPicker({
  value,
  onChange,
  imagesOnly = false,
  audioOnly = false,
  onUploading,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  imagesOnly?: boolean;
  audioOnly?: boolean;
  onUploading?: (value: boolean) => void;
}) {
  const radioName = useId();
  const [q, setQ] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [next, setNext] = useState<string | null>(null);
  const [items, setItems] = useState<LocalAsset[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        limit: "8",
        q,
        kind: audioOnly ? "audio" : imagesOnly ? "image" : "all",
      });
      if (cursor) params.set("cursor", cursor);
      void workspaceRequest<{ items: LocalAsset[]; nextCursor: string | null }>(
        "/api/workspace/assets?" + params,
      )
        .then((r) => {
          if (active) {
            setItems(r.items.map(serverAsset));
            setNext(r.nextCursor);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, cursor, imagesOnly, audioOnly, refresh]);
  return (
    <div className="production-picker">
      <div className="production-actions">
        <label>
          搜索素材
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(undefined);
            }}
            placeholder="名称或素材 ID"
          />
        </label>
        <label>
          上传{audioOnly ? "配音素材" : imagesOnly ? "参考图片" : "镜头素材"}
          <input
            type="file"
            disabled={busy}
            accept={
              audioOnly
                ? "audio/wav,audio/mpeg,audio/ogg,audio/webm"
                : imagesOnly
                  ? "image/png,image/jpeg,image/webp"
                  : "image/png,image/jpeg,image/webp,video/mp4,video/webm"
            }
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (imagesOnly && value.length >= 10) {
                setError("已选满 10 张参考图，请先取消一张再上传。");
                return;
              }
              setBusy(true);
              onUploading?.(true);
              setError("");
              try {
                const asset = await saveFile(file);
                onChange(
                  imagesOnly
                    ? [...new Set([...value, asset.id])].slice(0, 10)
                    : [asset.id],
                );
                setQ("");
                setCursor(undefined);
                setRefresh((n) => n + 1);
              } catch (e) {
                setError(e instanceof Error ? e.message : "上传失败");
              } finally {
                setBusy(false);
                onUploading?.(false);
              }
            }}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <p className="description">
        已选 {value.length} 个{imagesOnly ? "（最多 10 张）" : ""} ·{" "}
        <button
          type="button"
          className="action subtle"
          disabled={busy}
          onClick={() => onChange([])}
        >
          清空选择
        </button>
        {busy && " 上传中…"}
      </p>
      <div className="production-assets">
        {items
          .filter((a) =>
            audioOnly
              ? a.kind === "audio"
              : imagesOnly
                ? a.kind === "image"
                : a.kind !== "audio",
          )
          .map((a) => (
            <label
              key={a.id}
              className={value.includes(a.id) ? "selected" : ""}
            >
              <span className="production-thumb">
                <AssetPreview asset={a} />
              </span>
              <span>
                <input
                  aria-label={assetOptionLabel(a)}
                  type={imagesOnly ? "checkbox" : "radio"}
                  name={imagesOnly ? undefined : radioName}
                  checked={value.includes(a.id)}
                  disabled={
                    busy ||
                    (imagesOnly && value.length >= 10 && !value.includes(a.id))
                  }
                  onChange={() =>
                    onChange(
                      imagesOnly
                        ? value.includes(a.id)
                          ? value.filter((id) => id !== a.id)
                          : [...value, a.id].slice(0, 10)
                        : [a.id],
                    )
                  }
                />{" "}
                {assetOptionLabel(a)}
              </span>
            </label>
          ))}
      </div>
      <div className="production-actions">
        <button
          type="button"
          className="action subtle"
          disabled={!cursor}
          onClick={() => setCursor(undefined)}
        >
          第一页
        </button>
        <button
          type="button"
          className="action subtle"
          disabled={!next}
          onClick={() => setCursor(next!)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
