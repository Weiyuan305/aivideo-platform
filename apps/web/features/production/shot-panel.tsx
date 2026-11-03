"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LocalTask, ProductionShot, Production } from "@aivideo/contracts";
import { definitionVersion } from "@aivideo/core/production";
import { getLocal, saveWorkflowVersion } from "@aivideo/core/local";
import { workspaceRequest } from "@aivideo/core/workspace-client";
import { submitWorkflowTask } from "@aivideo/core/task-client";
import {
  workflowFromImage,
  replaceWorkflowDraft,
} from "@aivideo/core/media-reuse";
import { taskLabel } from "@aivideo/core/tasks";
import { useLocalLibrary } from "@/features/assets/use-local-library";
import { AssetPreview } from "@/features/assets/asset-library";
import { AssetPicker } from "./asset-picker";
import type { Change } from "./forms";
export function ShotPanel({
  project,
  shot,
  episodeId,
  change,
}: {
  project: Production;
  shot: ProductionShot;
  episodeId: string;
  change: Change;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false),
    [chosen, setChosen] = useState<string[]>([]),
    [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [taskId, setTaskId] = useState("");
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [workflowId, setWorkflowId] = useState(""),
    [uploading, setUploading] = useState(false);
  const {
    assets,
    workflows,
    error: libraryError,
  } = useLocalLibrary({ assetIds: shot.candidates.map((c) => c.assetId) });
  const selected = shot.candidates.find(
    (c) => c.id === shot.selectedCandidateId,
  );
  const selectedAsset = assets.find((a) => a.id === selected?.assetId);
  const taskKey = shot.taskIds.join(",");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const rows = await Promise.all(
          taskKey
            .split(",")
            .filter(Boolean)
            .map((id) =>
              workspaceRequest<{ item: LocalTask }>("/api/jobs/" + id),
            ),
        );
        if (active) setTasks(rows.map((r) => r.item));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "任务读取失败");
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [taskKey]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="production-shot-panel">
      {(error || libraryError) && (
        <p role="alert" className="error-message">
          {error || libraryError}
        </p>
      )}
      <div className="production-actions">
        <button className="action" onClick={() => setAdding(!adding)}>
          添加上传素材候选
        </button>
        <span>
          {shot.candidates.length} 个候选 ·{" "}
          {selected ? `采用：${selected.label}` : "尚未选择采用版"}
        </span>
      </div>
      {adding && (
        <form
          className="production-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (uploading) return;
            void perform(async () => {
              if (!chosen[0]) throw new Error("请先上传或选择素材");
              const ok = await change({
                type: "candidate.add",
                episodeId,
                shotId: shot.id,
                id: crypto.randomUUID(),
                assetId: chosen[0],
                label: label.trim() || `候选 ${shot.candidates.length + 1}`,
              });
              if (ok) {
                setAdding(false);
                setChosen([]);
                setLabel("");
              }
            });
          }}
        >
          <label>
            候选名称
            <input
              maxLength={100}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={`候选 ${shot.candidates.length + 1}`}
            />
          </label>
          <AssetPicker
            value={chosen}
            onChange={setChosen}
            onUploading={setUploading}
          />
          <button
            className="action"
            disabled={busy || uploading || !chosen.length}
          >
            加入本镜头候选
          </button>
        </form>
      )}
      <div className="production-candidates">
        {shot.candidates.map((c) => {
          const asset = assets.find((a) => a.id === c.assetId),
            adopted = c.id === shot.selectedCandidateId;
          return (
            <article
              key={c.id}
              className={
                adopted
                  ? "production-candidate selected"
                  : "production-candidate"
              }
            >
              <div className="production-preview">
                {asset ? <AssetPreview asset={asset} /> : <p>读取素材…</p>}
              </div>
              <h4>
                {c.label}{" "}
                {adopted && <span className="production-badge">采用版</span>}
              </h4>
              <p className="description">
                依据分镜 v{c.basis.revision}
                {c.basis.revision !== shot.revision && " · 分镜已修改，请复核"}
              </p>
              <details>
                <summary>创建时的分镜</summary>
                <p>{c.basis.description || "未填写画面描述"}</p>
                <p>
                  {c.basis.framing} · {c.basis.camera} ·{" "}
                  {c.basis.durationSeconds} 秒
                </p>
                <p>{c.basis.dialogue}</p>
                <p>
                  角色：
                  {c.basis.characters
                    .map(
                      (ref) =>
                        `${definitionVersion(project, ref).name} v${ref.version}`,
                    )
                    .join("、") || "未指定"}{" "}
                  · 场景：
                  {c.basis.scene
                    ? `${definitionVersion(project, c.basis.scene).name} v${c.basis.scene.version}`
                    : "未指定"}
                </p>
              </details>
              {c.sourceJobId && (
                <Link href={`/jobs/${c.sourceJobId}`}>查看来源任务</Link>
              )}
              <div className="production-actions">
                <button
                  className={adopted ? "action secondary" : "action"}
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await change({
                        type: "candidate.select",
                        episodeId,
                        shotId: shot.id,
                        candidateId: adopted ? null : c.id,
                      });
                    })
                  }
                >
                  {adopted ? "取消采用" : "采用此版"}
                </button>
                <button
                  className="action subtle"
                  disabled={busy || adopted}
                  onClick={() =>
                    void perform(async () => {
                      if (confirm("移除此候选？素材库中的文件会保留。"))
                        await change({
                          type: "candidate.delete",
                          episodeId,
                          shotId: shot.id,
                          candidateId: c.id,
                        });
                    })
                  }
                >
                  移除候选
                </button>
                {asset?.url && (
                  <a
                    className="action subtle"
                    href={asset.url}
                    download={asset.name}
                  >
                    下载
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!shot.candidates.length && (
        <p className="empty">上传图片或视频，建立第一个候选，再选择采用版。</p>
      )}
      <details className="production-connections">
        <summary>
          工作流与任务 · {shot.workflowIds.length} 个工作流 /{" "}
          {shot.taskIds.length} 个任务
        </summary>
        <p className="description">
          采用图片可建立图生视频工作流。试运行只验证执行计划，不生成真实媒体。
        </p>
        <button
          className="action secondary"
          disabled={busy || selectedAsset?.kind !== "image"}
          onClick={() =>
            void perform(async () => {
              if (!selectedAsset) return;
              const graph = workflowFromImage(selectedAsset);
              graph.name = `${shot.name} · 图生视频`.slice(0, 100);
              graph.nodes.find((n) => n.type === "generate.video")!.data.text =
                (
                  [shot.description, shot.framing, shot.camera]
                    .filter(Boolean)
                    .join("；") || shot.name
                ).slice(0, 4000);
              const saved = await saveWorkflowVersion(graph);
              if (
                !(await change({
                  type: "workflow.link",
                  episodeId,
                  shotId: shot.id,
                  workflowId: saved.id,
                }))
              )
                setError(
                  "工作流已保存，但项目关联未完成；可从工作流页查看，刷新项目后重试关联。",
                );
            })
          }
        >
          用采用图片建立工作流
        </button>
        <form
          className="production-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              if (
                await change({
                  type: "workflow.link",
                  episodeId,
                  shotId: shot.id,
                  workflowId,
                })
              )
                setWorkflowId("");
            });
          }}
        >
          <label>
            关联已有工作流
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              required
            >
              <option value="">选择已保存的工作流</option>
              {workflows
                .filter((w) => !shot.workflowIds.includes(w.id))
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · v{w.version}
                  </option>
                ))}
            </select>
          </label>
          <button className="action secondary" disabled={busy || !workflowId}>
            关联工作流
          </button>
        </form>
        {shot.workflowIds.map((id) => {
          const w = workflows.find((w) => w.id === id);
          return (
            <div key={id} className="production-linked">
              <span>{w?.name ?? id.slice(0, 8)}</span>
              <button
                className="action subtle"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await change({
                      type: "workflow.unlink",
                      episodeId,
                      shotId: shot.id,
                      workflowId: id,
                    });
                  })
                }
              >
                解除工作流关联
              </button>
              <button
                className="action subtle"
                disabled={busy || !w}
                onClick={() => {
                  if (w) {
                    replaceWorkflowDraft(w.graph, localStorage);
                    router.push("/workflows");
                  }
                }}
              >
                编辑工作流
              </button>
              <button
                className="action secondary"
                disabled={busy || !w}
                onClick={() =>
                  void perform(async () => {
                    if (!w) return;
                    const task = await submitWorkflowTask(
                      w.graph,
                      "dry-run",
                      w.version,
                    );
                    if (
                      !(await change({
                        type: "task.link",
                        episodeId,
                        shotId: shot.id,
                        taskId: task.id,
                      }))
                    )
                      setError(
                        `任务已提交，可在任务中心查看：${task.id}；刷新后可按 ID 关联。`,
                      );
                  })
                }
              >
                试运行并关联
              </button>
            </div>
          );
        })}
        <form
          className="production-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              if (
                await change({
                  type: "task.link",
                  episodeId,
                  shotId: shot.id,
                  taskId: taskId.trim(),
                })
              )
                setTaskId("");
            });
          }}
        >
          <label>
            关联已有任务
            <input
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              placeholder="粘贴任务 ID"
              required
            />
          </label>
          <button className="action secondary" disabled={busy}>
            关联任务
          </button>
        </form>
        {tasks.map((t) => (
          <article className="production-linked" key={t.id}>
            <Link href={`/jobs/${t.id}`}>
              {t.title} · {taskLabel(t)}
            </Link>
            <button
              className="action subtle"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await change({
                    type: "task.unlink",
                    episodeId,
                    shotId: shot.id,
                    taskId: t.id,
                  });
                })
              }
            >
              解除任务关联
            </button>
            {t.outputAssetIds.map((id) => (
              <button
                key={id}
                className="action subtle"
                disabled={busy || shot.candidates.some((c) => c.assetId === id)}
                onClick={() =>
                  void perform(async () => {
                    const asset = await getLocal("assets", id);
                    if (!asset || asset.kind === "audio")
                      throw new Error("仅可将归档图片或视频加入镜头候选");
                    await change({
                      type: "candidate.add",
                      episodeId,
                      shotId: shot.id,
                      id: crypto.randomUUID(),
                      assetId: id,
                      label: asset.name.slice(0, 100),
                      sourceJobId: t.id,
                    });
                  })
                }
              >
                {shot.candidates.some((c) => c.assetId === id)
                  ? "已加入"
                  : "导入结果"}{" "}
                {id.slice(0, 8)}
              </button>
            ))}
          </article>
        ))}
      </details>
    </div>
  );
}
