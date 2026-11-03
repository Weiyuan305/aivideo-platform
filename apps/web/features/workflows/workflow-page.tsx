"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { workflowSchema, type WorkflowGraph } from "@aivideo/contracts";
import {
  createTemplate,
  validateWorkflow,
  validateReferences,
  importWorkflowJSON,
} from "@aivideo/core/workflow";
import {
  saveWorkflowVersion,
  removeLocal,
  getLocal,
} from "@aivideo/core/local";
import { useLocalLibrary } from "@/features/assets/use-local-library";
import { useTasks } from "@/features/tasks/use-tasks";
import { TaskRow } from "@/features/tasks/task-list";
import { submitWorkflowTask } from "@aivideo/core/task-client";
import {
  workflowDraftKey,
  previousWorkflowDraftKey,
  replaceWorkflowDraft,
} from "@aivideo/core/media-reuse";
const Editor = dynamic(
  () => import("@aivideo/workflow-ui").then((m) => m.WorkflowEditor),
  { ssr: false, loading: () => <p className="loading">加载工作流编辑器…</p> },
);
const draftKey = workflowDraftKey;
export function WorkflowPage() {
  const [graph, setGraph] = useState<WorkflowGraph>();
  const { assets, voices, workflows, error } = useLocalLibrary({
    assetIds: graph?.nodes.flatMap((n) =>
      n.data.assetId ? [n.data.assetId] : [],
    ),
    voiceIds: graph?.nodes.flatMap((n) =>
      n.data.voiceId ? [n.data.voiceId] : [],
    ),
  });
  const { tasks, error: taskError } = useTasks(graph?.id);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false),
    [lastTaskId, setLastTaskId] = useState<string>();
  const [previousDraft, setPreviousDraft] = useState<WorkflowGraph>();
  const [message, setMessage] = useState(""),
    [invalid, setInvalid] = useState(false),
    [voiceURLs, setVoiceURLs] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      const saved = raw && workflowSchema.safeParse(JSON.parse(raw));
      setGraph(
        saved && saved.success ? saved.data : createTemplate("image-video"),
      );
      try {
        const previous = localStorage.getItem(previousWorkflowDraftKey);
        if (previous) {
          const parsed = workflowSchema.safeParse(JSON.parse(previous));
          if (parsed.success) setPreviousDraft(parsed.data);
        }
      } catch {
        /* A corrupt backup must not replace the valid current draft. */
      }
    } catch {
      setGraph(createTemplate("image-video"));
      setMessage("草稿无法读取，已打开默认模板");
    }
  }, []);
  useEffect(() => {
    if (!graph) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(graph));
    } catch {
      setMessage("草稿自动保存失败，请导出备份");
      setInvalid(true);
    }
  }, [graph]);
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const voice of voices) {
      const asset = assets.find((a) => a.id === voice.assetId);
      if (asset) urls[voice.id] = asset.url ?? URL.createObjectURL(asset.blob);
    }
    setVoiceURLs(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [assets, voices]);
  function change(next: WorkflowGraph) {
    setGraph(next);
    setMessage("");
    setInvalid(false);
  }
  function validate() {
    if (!graph) return;
    const result = validateWorkflow(graph);
    const errors = [
      ...result.errors,
      ...validateReferences(graph, assets, voices),
    ];
    setInvalid(errors.length > 0);
    setMessage(
      errors.length
        ? errors.join("；")
        : `校验通过 · ${result.order.length} 个节点 · 执行顺序：${result.order.join(" → ")}。可启动试运行。`,
    );
  }
  async function run(mode: "dry-run" | "provider") {
    if (!graph || submitting) return;
    setSubmitting(true);
    try {
      const snapshot = workflowSchema.parse(graph);
      const saved = await getLocal("workflows", snapshot.id);
      const version = saved?.history?.findLast(
        (h) =>
          JSON.stringify(workflowSchema.parse(h.graph)) ===
          JSON.stringify(snapshot),
      )?.version;
      const task = await submitWorkflowTask(snapshot, mode, version);
      setLastTaskId(task.id);
      setInvalid(false);
      setMessage(
        mode === "dry-run"
          ? "已创建试运行，节点检查结果见下方运行记录。当前草稿后续修改不会影响这次运行。"
          : "已保存生成任务，由后台按节点执行。Agnes 图片和视频需配置密钥；其他模型仍为预留入口。",
      );
    } catch (e) {
      setInvalid(true);
      setMessage(e instanceof Error ? e.message : "无法创建运行任务");
    } finally {
      setSubmitting(false);
    }
  }
  async function save() {
    if (!graph || saving) return;
    const parsed = workflowSchema.safeParse(graph);
    if (!parsed.success) {
      setInvalid(true);
      setMessage("工作流结构或名称无效，请检查名称与节点数据");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveWorkflowVersion(parsed.data);
      setInvalid(false);
      setMessage(
        `已保存“${saved.name}”版本 ${saved.version}。未完成连线的草稿也可保存，运行前需通过校验。`,
      );
    } catch (e) {
      setInvalid(true);
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  function exportJSON() {
    if (!graph) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${graph.name || "workflow"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importJSON(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error("工作流 JSON 不得超过 100 KB");
      change(importWorkflowJSON(await file.text()));
      setMessage(
        "导入成功。素材和声音仅保存引用，请确认当前工作区中存在对应资源。",
      );
    } catch (e) {
      setInvalid(true);
      setMessage(e instanceof Error ? e.message : "导入失败");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <section className="flow-page">
      <div className="page-heading">
        <div>
          <h1>工作流</h1>
          <p className="description">
            组合图片、视频和语音 API 节点，保存可重复使用的创作流程。
          </p>
        </div>
        <div className="toolbar">
          <button
            className="action secondary"
            onClick={() => change(createTemplate("image-video"))}
          >
            图片 → 视频模板
          </button>
          <button
            className="action secondary"
            onClick={() => change(createTemplate("voice"))}
          >
            语音克隆模板
          </button>
          <button
            className="action subtle"
            onClick={() => change(createTemplate("blank"))}
          >
            新建空白
          </button>
          <button
            className="action subtle"
            onClick={() => fileRef.current?.click()}
          >
            导入 JSON
          </button>
          {previousDraft && (
            <button
              className="action subtle"
              onClick={() => {
                try {
                  replaceWorkflowDraft(previousDraft, localStorage);
                  setPreviousDraft(graph);
                  change(previousDraft);
                  setMessage("已恢复上一个草稿。");
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "无法恢复草稿");
                  setInvalid(true);
                }
              }}
            >
              恢复上一个草稿
            </button>
          )}
        </div>
      </div>
      <div className="notice">
        试运行会按依赖顺序检查节点、传递参数并保存检查点，不调用模型或生成媒体。提交生成任务会保存快照并检查
        API 接入状态。当前仅支持平台 API 节点。
      </div>
      <input
        hidden
        ref={fileRef}
        aria-label="导入工作流"
        type="file"
        accept="application/json,.json"
        onChange={(e) => void importJSON(e.target.files?.[0])}
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {taskError && (
        <p role="alert" className="error-message">
          {taskError}
        </p>
      )}
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <button
          className="action"
          disabled={submitting || saving || !graph}
          onClick={() => void run("dry-run")}
        >
          试运行（不生成媒体）
        </button>
        <button
          className="action secondary"
          disabled={submitting || saving || !graph}
          onClick={() => void run("provider")}
        >
          提交生成任务
        </button>
        <Link className="action subtle" href="/jobs">
          全部任务
        </Link>
      </div>
      {lastTaskId && (
        <div className="notice" role="status">
          本次任务已保存。
          <Link href={`/jobs/${lastTaskId}`} className="action subtle">
            查看本次运行
          </Link>
        </div>
      )}
      <div className="flow-tabs">
        {workflows.map((w) => (
          <div
            key={w.id}
            className={`flow-tab ${graph?.id === w.id ? "active" : ""}`}
          >
            <button onClick={() => change(w.graph)}>
              {w.name} · v{w.version}
            </button>
            <button
              aria-label={`删除工作流 ${w.name}`}
              style={{ marginLeft: 12 }}
              onClick={() =>
                removeLocal("workflows", w.id)
                  .then(() => {
                    if (graph?.id === w.id) change(createTemplate("blank"));
                  })
                  .catch((e) => {
                    setMessage(e.message);
                    setInvalid(true);
                  })
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!!workflows.find((w) => w.id === graph?.id)?.history?.length && (
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <label htmlFor="workflow-version">恢复历史版本</label>
          <select
            id="workflow-version"
            className="input"
            style={{ width: 220 }}
            defaultValue=""
            onChange={(e) => {
              const item = workflows
                .find((w) => w.id === graph?.id)
                ?.history?.find((h) => h.version === Number(e.target.value));
              if (item) {
                change(item.graph);
                setMessage(
                  `已恢复版本 ${item.version} 至草稿；保存会创建新版本。`,
                );
              }
              e.target.value = "";
            }}
          >
            <option value="">选择已保存的版本</option>
            {workflows
              .find((w) => w.id === graph?.id)
              ?.history?.map((h) => (
                <option key={h.version} value={h.version}>
                  版本 {h.version} · {new Date(h.savedAt).toLocaleTimeString()}
                </option>
              ))}
          </select>
        </div>
      )}
      {graph && (
        <Editor
          key={graph.id}
          graph={graph}
          onChange={change}
          assets={assets}
          voices={voices}
          voiceURLs={voiceURLs}
          onSave={() => void save()}
          saving={saving}
          onExport={exportJSON}
          onValidate={validate}
          status={message}
          invalid={invalid}
        />
      )}
      <div style={{ marginTop: 24 }}>
        <h2>此工作流的运行记录</h2>
        <p className="description">
          每次运行使用独立快照。详情中可查看节点输入、输出与检查点，中断的试运行可继续。
        </p>
        <div className="task-list">
          {tasks
            .filter((t) => t.graph?.id === graph?.id)
            .slice(0, 5)
            .map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
        </div>
        {!tasks.some((t) => t.graph?.id === graph?.id) && (
          <p className="muted">尚无运行记录。</p>
        )}
      </div>
    </section>
  );
}
