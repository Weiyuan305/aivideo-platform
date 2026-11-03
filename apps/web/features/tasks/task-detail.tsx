"use client";
import Link from "next/link";
import { serverTaskAction } from "@aivideo/core/workspace-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  modelCatalog,
  type LocalTask,
  type RunValue,
  type LocalAsset,
} from "@aivideo/contracts";
import { canRetry, taskLabel, isTerminal } from "@aivideo/core/tasks";
import {
  cancelLocalTask,
  resumeLocalTask,
  retryLocalTask,
} from "@aivideo/core/task-client";
import { removeLocal } from "@aivideo/core/local";
import { canCancelTask } from "@aivideo/core/task-views";
import { restoreStudioRequest } from "@aivideo/studio-ui/drafts";
import { replaceWorkflowDraft } from "@aivideo/core/media-reuse";
import { useBlobURL } from "@/features/assets/use-local-library";
import { AssetReuseActions } from "@/features/assets/asset-reuse-actions";
import { useTask } from "./use-tasks";
import { useTaskMedia } from "./use-task-media";
import { kindLabels } from "./task-list";
export function TaskDetail({ id }: { id: string }) {
  const { task, loaded, error: readError } = useTask(id),
    {
      assets,
      loaded: mediaLoaded,
      error: mediaError,
      refresh: refreshMedia,
    } = useTaskMedia(task);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  if (!loaded) return <p className="loading">读取任务…</p>;
  if (!task)
    return (
      <section className="page">
        <h1>任务详情</h1>
        <div className="empty">
          <h2>没有找到可访问的任务记录</h2>
          <p>{readError || "请确认存储模式、登录账号与任务 ID。"}</p>
          <Link className="action secondary" href="/jobs">
            返回任务中心
          </Link>
        </div>
      </section>
    );
  const referenceAssets = assets.filter(
    (a) => !task.outputAssetIds.includes(a.id),
  );
  return (
    <section className="page task-detail">
      <div className="page-heading">
        <div>
          <Link className="muted" href="/jobs">
            ← 任务中心
          </Link>
          <h1 style={{ marginTop: 12 }}>任务详情</h1>
          <p className="description">{task.title}</p>
        </div>
        <span className={`task-badge ${task.status}`}>{taskLabel(task)}</span>
      </div>
      <div className="notice">
        {task.mode === "render"
          ? "这是上传素材的 CPU 成片合成。预览和下载均使用同一份归档 MP4，不调用模型 API。"
          : task.mode === "dry-run"
            ? "这是工作流试运行，只检查依赖、资源和请求参数；计划引用不是生成文件。"
            : "本页记录后台执行状态。只有成功归档的媒体才会显示为结果；提交待核对时不会自动重新生成。"}
      </div>
      {(error || readError) && (
        <p role="alert" className="error-message">
          {error || readError}
        </p>
      )}
      <div className="toolbar task-actions">
        {task.render && (
          <Link
            className="action secondary"
            href={`/projects?${new URLSearchParams({ project: task.render.projectId, episode: task.render.episodeId, tab: "timeline", render: task.id })}`}
          >
            返回短剧项目
          </Link>
        )}
        {task.graph && (
          <button
            className="action secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                replaceWorkflowDraft(task.graph!, localStorage);
                router.push("/workflows");
              })
            }
          >
            复用此工作流
          </button>
        )}
        {task.backend === "server" && task.status === "archive_failed" && (
          <button
            className="action"
            disabled={busy}
            onClick={() =>
              void action(() => serverTaskAction(id, "retry-archive"))
            }
          >
            {task.render ? "重新合成并归档" : "重试归档（不重新生成）"}
          </button>
        )}
        {task.backend === "server" && task.status === "unknown" && (
          <button
            className="action secondary"
            disabled={busy}
            onClick={() => void action(() => serverTaskAction(id, "reconcile"))}
          >
            核对供应商状态
          </button>
        )}
        {task.request && (
          <button
            className="action secondary"
            disabled={busy}
            onClick={() =>
              void action(async () =>
                router.push(await restoreStudioRequest(task.request!)),
              )
            }
          >
            复用参数
          </button>
        )}
        {canRetry(task) && (
          <button
            className="action secondary"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const next = await retryLocalTask(id);
                router.push(`/jobs/${next.id}`);
              })
            }
          >
            重新尝试
          </button>
        )}
        {task.status === "interrupted" && task.mode === "dry-run" && (
          <button
            className="action"
            disabled={busy}
            onClick={() => void action(() => resumeLocalTask(id))}
          >
            继续试运行
          </button>
        )}
        {canCancelTask(task) && (
          <button
            className="action danger"
            disabled={busy}
            onClick={() => void action(() => cancelLocalTask(id))}
          >
            取消任务
          </button>
        )}
        <button className="action subtle" onClick={() => downloadTask(task)}>
          导出运行记录
        </button>
        {isTerminal(task.status) && (
          <button
            className="action danger"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await removeLocal("tasks", id);
                router.push("/jobs");
              })
            }
          >
            删除记录
          </button>
        )}
      </div>
      {task.error && (
        <p
          className={
            task.status === "blocked" ? "description" : "error-message"
          }
        >
          {task.error.message}
        </p>
      )}
      {task.status === "unknown" && (
        <p className="error-message">
          提交结果尚未确认，已禁用重新尝试。核对操作只查询已有供应商请求，不会重新提交；无请求
          ID 时需要人工核对。
        </p>
      )}
      <dl className="task-metadata">
        <div>
          <dt>类型</dt>
          <dd>
            {kindLabels[task.kind]} ·{" "}
            {task.mode === "render"
              ? "成片合成"
              : task.mode === "dry-run"
                ? "试运行"
                : "API 生成"}
          </dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{new Date(task.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>尝试次数</dt>
          <dd>第 {task.attempt} 次</dd>
        </div>
        <div>
          <dt>快照</dt>
          <dd>
            {task.render
              ? `剪辑版本 ${task.render.version}`
              : task.graph
                ? task.workflowVersion
                  ? `工作流版本 ${task.workflowVersion}`
                  : "运行时草稿快照"
                : modelCatalog.find((m) => m.key === task.request?.modelKey)
                    ?.name}
          </dd>
        </div>
      </dl>
      {task.request && (
        <div className="panel task-section">
          <h2>生成参数</h2>
          <p className="task-prompt">{task.request.prompt}</p>
          <p className="description">
            {[
              task.request.parameters.aspectRatio,
              task.request.parameters.durationSeconds &&
                `${task.request.parameters.durationSeconds} 秒`,
              task.request.parameters.seed !== undefined &&
                `随机种子 ${task.request.parameters.seed}`,
            ]
              .filter(Boolean)
              .join(" · ") || "使用模型默认参数"}
          </p>
        </div>
      )}
      {referenceAssets.length > 0 && (
        <div className="task-section">
          <h2>参考素材</h2>
          <div className="library-grid">
            {referenceAssets.map((a) => (
              <MediaCard key={a.id} asset={a} onError={setError} />
            ))}
          </div>
        </div>
      )}
      <div className="task-section">
        <h2>{task.mode === "dry-run" ? "试运行结果" : "生成结果"}</h2>
        {mediaError ? (
          <p role="alert" className="error-message">
            素材读取失败：{mediaError}{" "}
            <button
              className="action subtle"
              onClick={() => void refreshMedia()}
            >
              重新读取
            </button>
          </p>
        ) : !mediaLoaded ? (
          <p className="loading">读取参考素材与归档结果…</p>
        ) : task.outputAssetIds.length ? (
          <div className="library-grid">
            {task.outputAssetIds.map((id) => {
              const asset = assets.find((a) => a.id === id);
              return asset ? (
                <MediaCard key={id} asset={asset} onError={setError} />
              ) : (
                <p key={id} className="error-message">
                  归档素材不存在：{id}
                </p>
              );
            })}
          </div>
        ) : (
          <p className="description">
            {task.mode === "dry-run"
              ? "没有生成媒体文件。请查看节点检查记录。"
              : "尚无生成结果。任务接通并归档完成后，可在这里预览和下载。"}
          </p>
        )}
      </div>
      {task.graph && (
        <div className="task-section">
          <h2>节点执行记录</h2>
          <div className="node-runs">
            {task.nodes.map((node) => (
              <article className="panel" key={node.nodeId}>
                <div className="toolbar">
                  <h3>
                    {
                      task.graph!.nodes.find((n) => n.id === node.nodeId)?.data
                        .label
                    }
                  </h3>
                  <span className={`task-badge ${node.status}`}>
                    {node.status === "succeeded"
                      ? task.mode === "dry-run"
                        ? "检查通过"
                        : "已完成"
                      : {
                          pending: "未执行",
                          running: "执行中",
                          blocked: "等待 API",
                          failed: "失败",
                          archive_failed: "归档失败",
                          cancelled: "已取消",
                        }[node.status]}
                  </span>
                </div>
                {node.message && <p className="description">{node.message}</p>}
                <div className="node-values">
                  {Object.entries(node.inputs).map(([port, value]) => (
                    <p key={`in-${port}`}>
                      输入 {port}：{describeValue(value, assets)}
                    </p>
                  ))}
                  {Object.entries(node.outputs).map(([port, value]) => (
                    <p key={`out-${port}`}>
                      输出 {port}：{describeValue(value, assets)}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      <div className="task-section">
        <h2>状态日志</h2>
        <ol className="task-timeline">
          {task.events.map((event, i) => (
            <li key={i}>
              <time>{new Date(event.at).toLocaleTimeString()}</time>
              <span>{event.message}</span>
            </li>
          ))}
        </ol>
      </div>
      <details className="task-section">
        <summary>查看冻结参数与工作流快照</summary>
        <pre className="code-block">
          {JSON.stringify(task.render ?? task.request ?? task.graph, null, 2)}
        </pre>
      </details>
    </section>
  );
}
function describeValue(value: RunValue, assets: LocalAsset[]) {
  if (value.type === "text") return value.text;
  if ("planned" in value)
    return `计划${value.type === "image" ? "图片" : value.type === "video" ? "视频" : "音频"} · 来自 ${value.nodeId}（未生成文件）`;
  return assets.find((a) => a.id === value.assetId)?.name ?? "素材引用";
}
function MediaCard({
  asset,
  onError,
}: {
  asset: LocalAsset;
  onError: (message: string) => void;
}) {
  const url = useBlobURL(asset.blob, asset.url);
  return (
    <article className="asset-card">
      <div className="asset-preview">
        {url &&
          (asset.kind === "image" ? (
            <img src={url} alt={asset.name} />
          ) : asset.kind === "video" ? (
            <video src={url} controls />
          ) : (
            <audio src={url} controls />
          ))}
      </div>
      <div className="asset-details">
        <h3>{asset.name}</h3>
        <a href={url} download={asset.name}>
          下载文件
        </a>
        <AssetReuseActions asset={asset} onError={onError} />
      </div>
    </article>
  );
}
function downloadTask(task: LocalTask) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(task, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `task-${task.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
