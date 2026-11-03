"use client";
import { useState } from "react";
import type { WorkspaceHealth } from "@aivideo/contracts";
import { useWorkspaceQuery } from "@/features/use-workspace-query";
const stores: string[] = [];
type Report = WorkspaceHealth & { detailError?: string };
async function readHealth(): Promise<Report> {
  const response = await fetch("/api/workspace/health", { cache: "no-store" });
  const body = await response.json();
  if (body.database && body.storage) return body;
  const coarse = await fetch("/api/health", { cache: "no-store" }).then((r) =>
    r.json(),
  );
  if (coarse.database && coarse.storage)
    return {
      ...coarse,
      detailError: body.error?.message || "无法读取当前账号的队列状态",
    };
  throw new Error("运行健康检查不可用，请检查工作区配置");
}
export function HealthPanel() {
  const {
    data: report,
    error,
    loaded,
    refresh,
  } = useWorkspaceQuery<Report | undefined>(
    readHealth,
    undefined,
    stores,
    15000,
  );
  const [checking, setChecking] = useState(false);
  async function recheck() {
    if (checking) return;
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  }
  const labels = {
    healthy: "正常",
    unhealthy: "异常",
    unknown: "无法确认",
    stale: "心跳过期",
    stopped: "已停止",
    missing: "未启动",
  };
  return (
    <section className="health-panel panel" aria-label="运行健康">
      <div className="page-heading">
        <div>
          <h2>运行健康</h2>
          <p className="description">
            实际检测数据库、私有存储与后台。此检查不调用模型，也不代表供应商可用性。
          </p>
        </div>
        <button
          className="action secondary"
          disabled={checking || !loaded}
          onClick={() => void recheck()}
        >
          {checking ? "检查中…" : "重新检查"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!report ? (
        <p role="status">
          {loaded ? "暂时无法读取状态，请重新检查。" : "正在检查运行状态…"}
        </p>
      ) : (
        <>
          <div className="health-grid">
            {[
              { name: "数据库", ...report.database },
              { name: "私有存储", ...report.storage },
              { name: "后台 worker", ...report.worker },
            ].map((check) => (
              <article className="health-check" key={check.name}>
                <h3>
                  {check.name}
                  <span
                    className={`status ${check.status === "healthy" ? "ready" : ""}`}
                  >
                    {labels[check.status]}
                  </span>
                </h3>
                <p>{check.message}</p>
                {"checkedAt" in check && (
                  <small>
                    检查时间：{new Date(check.checkedAt).toLocaleString()}
                  </small>
                )}
              </article>
            ))}
          </div>
          {report.worker.lastHeartbeatAt && (
            <p className="description">
              最近心跳：
              {new Date(report.worker.lastHeartbeatAt).toLocaleString()} ·
              在线后台 {report.worker.activeWorkers ?? 0} 个 · 每 5 秒更新，超过
              20 秒未更新视为失联
            </p>
          )}
          {report.worker.lastErrorAt && (
            <p className="description">
              最近后台异常：
              {new Date(report.worker.lastErrorAt).toLocaleString()}
            </p>
          )}
          {report.detailError && (
            <p role="alert" className="error-message">
              {report.detailError}
            </p>
          )}
          {report.queue && (
            <div className="queue-health">
              <h3>
                当前账号队列 ·{" "}
                {report.queue.status === "healthy"
                  ? "正常"
                  : report.queue.status === "unknown"
                    ? "无法读取"
                    : "需要处理"}
              </h3>
              <dl>
                {[
                  ["排队中", report.queue.queued],
                  ["执行中", report.queue.running],
                  ["归档中", report.queue.archiving],
                  ["归档失败", report.queue.archiveFailed],
                  ["提交待核对", report.queue.unknown],
                  ["等待后台接管", report.queue.pendingDispatch],
                  ["最老排队秒数", report.queue.oldestQueuedSeconds],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <p className="description">
            状态更新：{new Date(report.checkedAt).toLocaleString()}
            。存储读写探针最多缓存 30 秒；探针对象检查后移除。
          </p>
        </>
      )}
    </section>
  );
}
