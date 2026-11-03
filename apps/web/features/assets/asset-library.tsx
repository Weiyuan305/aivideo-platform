"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Upload, FolderOpen } from "lucide-react";
import type { LocalAsset } from "@aivideo/contracts";
import { saveFile, removeLocal } from "@aivideo/core/local";
import { useBlobURL } from "./use-local-library";
import { AssetReuseActions } from "./asset-reuse-actions";
import { useAssetPage } from "./use-asset-page";
import { Pagination, useDebouncedSearch } from "@/features/use-cursor-page";
import type { AssetListQuery } from "@aivideo/contracts";
export function AssetPreview({
  asset,
  preload = "metadata",
}: {
  asset: LocalAsset;
  preload?: "none" | "metadata";
}) {
  const url = useBlobURL(asset.blob, asset.url);
  if (!url) return null;
  return asset.kind === "image" ? (
    <img src={url} alt={asset.name} />
  ) : asset.kind === "video" ? (
    <video src={url} controls preload={preload} />
  ) : (
    <audio src={url} controls preload="none" />
  );
}
function AssetCard({
  asset,
  onError,
}: {
  asset: LocalAsset;
  onError: (value: string) => void;
}) {
  const url = useBlobURL(asset.blob, asset.url);
  return (
    <article className="asset-card">
      <div className="asset-preview">
        <AssetPreview asset={asset} />
      </div>
      <div className="asset-details">
        <h3 title={asset.name}>{asset.name}</h3>
        <small>
          {asset.kind} · {(asset.bytes / 1024 / 1024).toFixed(2)} MB ·{" "}
          {asset.url ? "服务端素材" : "本地素材"}
        </small>
        <p className="description">
          <time dateTime={asset.createdAt}>
            {new Date(asset.createdAt).toLocaleString()}
          </time>
          {asset.sourceJobId && (
            <>
              {" · "}
              {asset.sourceJobAvailable === false ? (
                <span>来源记录已移除</span>
              ) : (
                <Link href={`/jobs/${asset.sourceJobId}`}>查看来源任务</Link>
              )}
            </>
          )}
          {" · "}
          {asset.id.slice(0, 8)}
        </p>
        <div className="asset-actions">
          <a href={url} download={asset.name}>
            下载
          </a>
          <button
            onClick={() =>
              removeLocal("assets", asset.id).catch((e) => onError(e.message))
            }
          >
            删除
          </button>
        </div>
        <AssetReuseActions asset={asset} onError={onError} />
      </div>
    </article>
  );
}
export function AssetLibrary() {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<AssetListQuery["kind"]>("all"),
    [search, setSearch] = useState("");
  const q = useDebouncedSearch(search),
    pagination = useAssetPage({ kind: filter, q, limit: 24 });
  const { items: assets, error, loaded, backend, refresh } = pagination;
  const ref = useRef<HTMLInputElement>(null);
  async function upload(files: FileList | null) {
    if (!files || uploading) return;
    setUploading(true);
    setMessage("");
    let saved = 0;
    try {
      for (const file of Array.from(files)) {
        await saveFile(file);
        saved++;
      }
    } catch (e) {
      setMessage(
        `${saved ? `已保存 ${saved} 个文件；` : ""}${e instanceof Error ? e.message : "保存失败"}`,
      );
    } finally {
      setUploading(false);
    }
    if (ref.current) ref.current.value = "";
    if (saved) {
      setSearch("");
      setFilter("all");
      pagination.reset();
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>素材库</h1>
          <p className="description">
            集中管理参考图片、视频和录音。
            {backend === "server"
              ? "文件保存在服务端私有存储，可在工作台和工作流复用。"
              : "文件保存在当前浏览器，可在工作台和工作流复用。"}
          </p>
        </div>
        <button
          className="action"
          disabled={uploading}
          onClick={() => ref.current?.click()}
        >
          <Upload size={16} />
          {uploading ? "正在上传…" : "添加素材"}
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        multiple
        disabled={uploading}
        accept="image/png,image/jpeg,image/webp,audio/*,video/mp4,video/webm"
        aria-label="上传素材"
        hidden
        onChange={(e) => void upload(e.target.files)}
      />
      <div className="toolbar">
        <input
          className="input"
          aria-label="搜索素材"
          placeholder="搜索文件名或素材 ID"
          maxLength={200}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {[
          ["all", "全部"],
          ["image", "图片"],
          ["video", "视频"],
          ["audio", "音频"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={`action ${filter === value ? "" : "subtle"}`}
            onClick={() => setFilter(value as AssetListQuery["kind"])}
          >
            {label}
          </button>
        ))}
      </div>
      {(message || error) && (
        <p role="alert" className="error-message">
          {message || error}
        </p>
      )}
      {error && (
        <button className="action secondary" onClick={() => void refresh()}>
          重新读取素材
        </button>
      )}
      {!loaded ? (
        <p className="loading">读取素材库…</p>
      ) : error && !assets.length ? null : !assets.length ? (
        <div className="empty">
          <FolderOpen size={36} />
          <h2>
            {q || filter !== "all" || pagination.hasPrevious
              ? "没有匹配的素材"
              : "添加你的第一份素材"}
          </h2>
          <p>
            调整搜索条件，或上传参考图片和录音后在工作台、工作流中使用。
            {backend === "browser"
              ? "清除浏览器数据也会删除这些文件。"
              : "私有文件仅当前账号或本机工作区可访问。"}
          </p>
        </div>
      ) : !assets.some((a) => filter === "all" || a.kind === filter) ? (
        <div className="empty">
          <h2>这个分类暂无素材</h2>
          <p>切换分类或添加素材。</p>
        </div>
      ) : (
        <div className="library-grid">
          {assets
            .filter((a) => filter === "all" || a.kind === filter)
            .map((asset) => (
              <AssetCard key={asset.id} asset={asset} onError={setMessage} />
            ))}
        </div>
      )}
      <Pagination {...pagination} />
    </section>
  );
}
