"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { AudioLines, Upload } from "lucide-react";
import type { LocalVoice } from "@aivideo/contracts";
import { assetOptionLabel } from "@aivideo/core/asset-label";
import {
  putLocal,
  removeLocal,
  saveFile,
  validateFile,
} from "@aivideo/core/local";
import { useLocalLibrary } from "@/features/assets/use-local-library";
import { AssetPreview } from "@/features/assets/asset-library";
import { AssetReuseActions } from "@/features/assets/asset-reuse-actions";

export function VoiceLibrary() {
  const { assets, voices, error, loaded, refresh } = useLocalLibrary({
    includeVoiceAssets: true,
  });
  const [name, setName] = useState("");
  const [assetId, setAssetId] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState("");
  const [editName, setEditName] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const audioAssets = assets.filter((a) => a.kind === "audio");
  const selected = audioAssets.find((a) => a.id === assetId);
  async function upload(file?: File) {
    if (!file || busy) return;
    setBusy(true);
    setMessage("");
    setSuccess("");
    try {
      if (validateFile(file) !== "audio") throw new Error("请选择音频文件");
      const asset = await saveFile(file);
      setAssetId(asset.id);
      if (!name) setName(file.name.replace(/\.[^.]+$/, "").slice(0, 100));
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }
  async function save() {
    if (busy || !loaded) return;
    setSuccess("");
    if (!name.trim() || !selected) {
      setMessage("请填写声音名称并选择参考录音");
      return;
    }
    setBusy(true);
    try {
      await putLocal("voices", {
        id: crypto.randomUUID(),
        name: name.trim(),
        assetId,
        createdAt: new Date().toISOString(),
      });
      setName("");
      setAssetId("");
      setMessage("");
      setSuccess("声音已保存，可在下方直接用于克隆。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function rename(voice: LocalVoice) {
    if (busy) return;
    setSuccess("");
    if (!editName.trim()) {
      setMessage("声音名称不能为空");
      return;
    }
    setBusy(true);
    try {
      await putLocal("voices", { ...voice, name: editName.trim() });
      setEditing("");
      setMessage("");
      setSuccess("声音名称已更新。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "重命名失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>声音库</h1>
          <p className="description">
            为参考录音命名，在语音克隆和工作流中重复使用。这里只保存参考声音，尚未生成或训练模型。
          </p>
        </div>
        <Link className="action secondary" href="/studio/voice">
          打开语音克隆
        </Link>
      </div>
      <div className="notice">
        请使用自己或已获得授权的录音。声音与录音按当前工作区配置保存；服务端模式使用私有文件存储。
      </div>
      {(message || error) && (
        <p className="error-message" role="alert">
          {message || error}
        </p>
      )}
      {success && (
        <p className="success-message" role="status">
          {success}
        </p>
      )}
      {error && (
        <button className="action secondary" onClick={() => void refresh()}>
          重新读取声音库
        </button>
      )}
      <div className="voice-panel">
        <div className="panel">
          <h2>添加参考声音</h2>
          <div className="field">
            <label htmlFor="voice-name">声音名称</label>
            <input
              id="voice-name"
              disabled={busy || !loaded}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的旁白声音"
            />
          </div>
          <div className="field">
            <label htmlFor="voice-asset">参考录音</label>
            <select
              id="voice-asset"
              disabled={busy || !loaded}
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
            >
              <option value="">从音频素材中选择</option>
              {audioAssets.map((a) => (
                <option key={a.id} value={a.id}>
                  {assetOptionLabel(a)}
                </option>
              ))}
            </select>
          </div>
          {selected && (
            <div
              className="asset-preview"
              style={{ height: 90, marginTop: 14 }}
            >
              <AssetPreview asset={selected} />
            </div>
          )}
          <input
            hidden
            ref={ref}
            type="file"
            accept="audio/wav,audio/x-wav,audio/mpeg,audio/webm,audio/ogg"
            aria-label="上传参考录音"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
          <div className="toolbar">
            <button
              className="action secondary"
              disabled={busy || !loaded}
              onClick={() => ref.current?.click()}
            >
              <Upload size={15} />
              上传录音
            </button>
            <button
              className="action"
              disabled={busy || !loaded}
              onClick={() => void save()}
            >
              {busy ? "处理中…" : "保存声音"}
            </button>
          </div>
        </div>
        <div>
          {!loaded ? (
            <p className="loading" role="status">
              读取声音库…
            </p>
          ) : error && !voices.length ? null : !voices.length ? (
            <div className="empty panel">
              <AudioLines size={32} />
              <h2>还没有保存的声音</h2>
              <p>上传录音或选择音频素材，保存后可用于参考声音克隆。</p>
            </div>
          ) : (
            <div className="library-grid" style={{ marginTop: 0 }}>
              {voices.map((voice) => {
                const asset = assets.find((a) => a.id === voice.assetId);
                return (
                  <article className="asset-card" key={voice.id}>
                    <div className="asset-preview">
                      {asset ? (
                        <AssetPreview asset={asset} />
                      ) : (
                        <span>参考录音不存在</span>
                      )}
                    </div>
                    <div className="asset-details">
                      {editing === voice.id ? (
                        <div className="field">
                          <input
                            aria-label="新的声音名称"
                            disabled={busy}
                            value={editName}
                            maxLength={100}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <button
                            className="action secondary"
                            disabled={busy}
                            onClick={() => void rename(voice)}
                          >
                            确认重命名
                          </button>
                          <button
                            className="action subtle"
                            disabled={busy}
                            onClick={() => {
                              setEditing("");
                              setMessage("");
                            }}
                          >
                            取消重命名
                          </button>
                        </div>
                      ) : (
                        <h3>{voice.name}</h3>
                      )}
                      <small>参考声音草稿 · {asset?.name}</small>
                      <div className="asset-actions">
                        <button
                          disabled={busy}
                          onClick={() => {
                            setEditing(voice.id);
                            setEditName(voice.name);
                          }}
                        >
                          重命名
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            removeLocal("voices", voice.id).catch((e) =>
                              setMessage(e.message),
                            )
                          }
                        >
                          删除
                        </button>
                      </div>
                      {asset && (
                        <AssetReuseActions asset={asset} onError={setMessage} />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
