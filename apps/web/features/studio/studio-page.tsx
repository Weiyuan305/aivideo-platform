"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTask } from "@/features/tasks/use-tasks";
import { taskLabel } from "@aivideo/core/tasks";
import { Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaKind } from "@aivideo/contracts";
import { fileForAsset } from "@aivideo/core/local";
import { assetOptionLabel } from "@aivideo/core/asset-label";
import { useLocalLibrary } from "@/features/assets/use-local-library";
const ImageStudio = dynamic(() => import("@aivideo/studio-ui/ImageStudio"), {
  ssr: false,
  loading: () => <p className="loading">加载图片工作台…</p>,
});
const VideoStudio = dynamic(() => import("@aivideo/studio-ui/VideoStudio"), {
  ssr: false,
  loading: () => <p className="loading">加载视频工作台…</p>,
});
const AudioStudio = dynamic(() => import("@aivideo/studio-ui/AudioStudio"), {
  ssr: false,
  loading: () => <p className="loading">加载语音工作台…</p>,
});
const copy = {
  image: {
    title: "图片生成",
    description: "用文字生成画面，或上传参考图片进行编辑。",
  },
  video: {
    title: "视频生成",
    description: "从文字或参考图片出发，把画面变成视频。",
  },
  voice: {
    title: "语音克隆",
    description: "上传参考录音，输入新文本，使用托管 API 生成同音色语音。",
  },
};
const EMPTY_HISTORY: never[] = [];
export function StudioPage({ kind }: { kind: MediaKind }) {
  const [error, setError] = useState("");
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const activeKind = useRef(kind);
  const [files, setFiles] = useState<File[]>([]);
  const {
    voices,
    assets,
    error: libraryError,
  } = useLocalLibrary({
    includeVoiceAssets: kind === "voice",
  });
  const [loadingFile, setLoadingFile] = useState(false);
  const selection = useRef(0);
  useEffect(() => {
    setFiles([]);
    activeKind.current = kind;
    setTaskIds([]);
    setError("");
    setLoadingFile(false);
    return () => {
      selection.current++;
    };
  }, [kind]);
  async function selectAsset(asset: (typeof assets)[number]) {
    const current = ++selection.current;
    setLoadingFile(true);
    setError("");
    try {
      const file = await fileForAsset(asset);
      if (selection.current === current) setFiles([file]);
    } catch (e) {
      if (selection.current === current)
        setError(e instanceof Error ? e.message : "无法读取参考素材");
    } finally {
      if (selection.current === current) setLoadingFile(false);
    }
  }
  const handleFilesHandled = useCallback(() => setFiles([]), []);
  const Component =
    kind === "image"
      ? ImageStudio
      : kind === "video"
        ? VideoStudio
        : AudioStudio;
  return (
    <section className="studio-page">
      <div className="page-heading">
        <div>
          <h1>{copy[kind].title}</h1>
          <p className="description">{copy[kind].description}</p>
        </div>
        {kind === "voice" && (
          <Link href="/voices" className="action secondary">
            管理声音库
          </Link>
        )}
      </div>
      <div className="notice">
        <Info size={17} className="shrink-0" />
        <p>
          Agnes 图片与视频 Flash 已适配，服务端配置密钥后由后台执行。图片固定
          1K，视频固定 720P；图生视频请选择 Agnes 生成图片或已配置 S3
          的素材。其他模型及语音克隆仍为预留入口。
          <Link href="/settings">查看配置</Link>
          {" · "}
          <Link href="/history">生成历史</Link>
        </p>
      </div>
      {kind === "voice" && voices.length > 0 && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <label htmlFor="saved-voice">从声音库选择</label>
          <select
            id="saved-voice"
            className="input"
            style={{ width: 240 }}
            defaultValue=""
            disabled={loadingFile}
            onChange={(e) => {
              const voice = voices.find((v) => v.id === e.target.value),
                asset = assets.find((a) => a.id === voice?.assetId);
              if (asset) void selectAsset(asset);
              e.target.value = "";
            }}
          >
            <option value="">请选择保存的声音</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {kind !== "voice" && assets.some((a) => a.kind === "image") && (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <label htmlFor="saved-reference">从素材库选择参考图片</label>
          <select
            id="saved-reference"
            className="input"
            style={{ width: 240 }}
            defaultValue=""
            disabled={loadingFile}
            onChange={(e) => {
              const asset = assets.find((a) => a.id === e.target.value);
              if (asset) void selectAsset(asset);
              e.target.value = "";
            }}
          >
            <option value="">请选择图片</option>
            {assets
              .filter((a) => a.kind === "image")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {assetOptionLabel(a)}
                </option>
              ))}
          </select>
        </div>
      )}
      {(error || libraryError) && (
        <p role="alert" className="error-message">
          {error || libraryError}
        </p>
      )}
      {loadingFile && (
        <p role="status" className="loading">
          正在读取参考素材…
        </p>
      )}
      {taskIds.map((id, index) => (
        <SubmittedTask key={id} id={id} index={index} count={taskIds.length} />
      ))}
      <fieldset
        className="studio-surface studio-fieldset"
        disabled={loadingFile}
      >
        <Component
          key={kind}
          locale="zh"
          apiKey={undefined}
          onGenerationStart={() => {
            setError("");
            setTaskIds([]);
          }}
          onTaskCreated={(id: string) => {
            if (activeKind.current === kind)
              setTaskIds((previous) =>
                previous.includes(id) ? previous : [...previous, id],
              );
          }}
          onGenerationEnd={undefined}
          onGenerationComplete={undefined}
          onDeleteHistoryItem={undefined}
          onGenerationError={setError}
          historyItems={EMPTY_HISTORY}
          droppedFiles={files}
          onFilesHandled={handleFilesHandled}
        />
      </fieldset>
    </section>
  );
}
function SubmittedTask({
  id,
  index,
  count,
}: {
  id: string;
  index: number;
  count: number;
}) {
  const { task, error } = useTask(id);
  return (
    <div className="notice submitted-task" role="status">
      <span>
        {count > 1 ? `第 ${index + 1} 项 · ` : ""}任务已保存 ·{" "}
        {task ? taskLabel(task) : "等待后台处理"}
        {error && ` · ${error}`}
      </span>
      <Link className="action subtle" href={`/jobs/${id}`}>
        {count > 1 ? `查看任务 ${index + 1}` : "查看此任务"}
      </Link>
    </div>
  );
}
