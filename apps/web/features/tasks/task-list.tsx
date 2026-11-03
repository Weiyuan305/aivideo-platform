"use client";
import Link from "next/link";
import { useState } from "react";
import { Clock3, ArrowUpRight } from "lucide-react";
import { type LocalTask, type TaskStatus } from "@aivideo/contracts";
import { taskLabel, taskStatusLabels } from "@aivideo/core/tasks";
import { useTaskPage } from "./use-task-page";
import { Pagination, useDebouncedSearch } from "@/features/use-cursor-page";
import type { JobListQuery } from "@aivideo/contracts";
export const kindLabels = {
  image: "图片",
  video: "视频",
  voice: "语音",
  workflow: "工作流",
};
export function TaskList({ history = false }: { history?: boolean }) {
  const [status, setStatus] = useState<JobListQuery["status"]>("all"),
    [kind, setKind] = useState<JobListQuery["kind"]>("all"),
    [search, setSearch] = useState("");
  const q = useDebouncedSearch(search);
  const pagination = useTaskPage({
    q,
    kind,
    status,
    mode: history ? "media" : "all",
    limit: 20,
  });
  const {
    items: filtered,
    error,
    loaded,
    backend,
    summary,
    total,
  } = pagination;
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>{history ? "生成历史" : "任务中心"}</h1>
          <p className="description">
            {history
              ? "查看生成和成片合成记录，复用素材与已归档结果。"
              : "统一查看生成提交、成片合成与工作流试运行，追踪状态和逐节点执行记录。"}
          </p>
        </div>
        <Link
          className="action secondary"
          href={history ? "/jobs" : "/history"}
        >
          {history ? "查看任务中心" : "查看生成历史"}
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="notice">
        {!loaded
          ? "正在读取工作区记录。"
          : backend === "server"
            ? "记录保存在服务端，后台 worker 执行；关闭页面不影响任务。"
            : "记录保存在当前浏览器，关闭浏览器会停止本地执行。"}
        已归档任务可查看和复用结果；未接入模型会明确标记。工作流试运行只检查参数与依赖，不生成媒体。
      </div>
      {!history && (
        <div className="task-stats">
          {[
            ["排队 / 执行", summary?.active ?? 0],
            ["待接入 API", summary?.blocked ?? 0],
            ["已完成", summary?.succeeded ?? 0],
          ].map(([label, count]) => (
            <div className="panel" key={label}>
              <span>全工作区 · {label}</span>
              <strong>{loaded ? count : "—"}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="toolbar task-filters">
        <input
          className="input"
          aria-label="搜索任务"
          maxLength={200}
          placeholder="搜索名称、提示词或任务 ID"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <select
          className="input"
          aria-label="任务类型"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as JobListQuery["kind"]);
          }}
        >
          <option value="all">全部类型</option>
          {Object.entries(kindLabels).map(([k, label]) => (
            <option value={k} key={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="任务状态"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as JobListQuery["status"]);
          }}
        >
          <option value="all">全部状态</option>
          {history && <option value="outputs">有生成结果</option>}
          {Object.entries(taskStatusLabels).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!loaded ? (
        <p className="loading">读取任务记录…</p>
      ) : !filtered.length ? (
        <div className="empty">
          <Clock3 size={32} />
          <h2>没有匹配的记录</h2>
          <p>
            {pagination.hasPrevious
              ? "当前页没有记录，可返回上一页或刷新列表。"
              : "调整筛选条件，或在创作工作台提交新任务。"}
          </p>
          <Link className="action secondary" href="/workflows">
            打开工作流
          </Link>
        </div>
      ) : (
        <>
          <p className="description">
            共 {total} 条记录 · 当前页 {filtered.length} 条
          </p>
          <div className="task-list">
            {filtered.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        </>
      )}
      <Pagination {...pagination} />
    </section>
  );
}
export function TaskRow({ task }: { task: LocalTask }) {
  return (
    <article className="task-row" data-testid={`task-${task.id}`}>
      <div className="task-row-main">
        <div className="toolbar">
          <span className={`task-badge ${task.status}`}>{taskLabel(task)}</span>
          <span className="muted">
            {kindLabels[task.kind]} ·{" "}
            {task.mode === "dry-run"
              ? "试运行 · 不生成媒体"
              : task.mode === "render"
                ? "成片合成"
                : "API 生成"}{" "}
            · 第 {task.attempt} 次尝试
          </span>
        </div>
        <h3>
          <Link href={`/jobs/${task.id}`}>{task.title}</Link>
        </h3>
        <p>
          {task.error?.message ??
            (task.mode === "dry-run"
              ? `${task.nodes.filter((n) => n.status === "succeeded").length} / ${task.nodes.length} 个节点检查完成`
              : task.outputAssetIds.length
                ? `${task.outputAssetIds.length} 个已归档结果`
                : "尚无生成结果")}
        </p>
        <small>
          {new Date(task.createdAt).toLocaleString()} · {task.id.slice(0, 8)}
        </small>
      </div>
      <Link className="action subtle" href={`/jobs/${task.id}`}>
        查看详情
      </Link>
    </article>
  );
}
