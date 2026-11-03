"use client";
import type { OperationsSummary } from "@aivideo/contracts";
import { useWorkspaceQuery } from "@/features/use-workspace-query";
const stores: string[] = [];
async function load(): Promise<OperationsSummary> {
  const response = await fetch("/api/workspace/operations", {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "暂时无法读取运维状态；数据库不可用时可在主机运行 ops:status 查看本地告警",
    );
  return response.json();
}
const time = (at?: string) => (at ? new Date(at).toLocaleString() : "尚无记录");
const components: Record<string, string> = {
  web: "Web",
  database: "数据库",
  storage: "素材存储",
  worker: "后台",
  queue: "任务队列",
  backup: "备份",
  monitor: "检测进程",
};
export function OperationsPanel() {
  const { data, loaded, error, refresh } = useWorkspaceQuery<
    OperationsSummary | undefined
  >(load, undefined, stores, 15000);
  const labels = {
    healthy: "在线",
    stale: "检查已过期",
    missing: "未启动或未配置",
    unavailable: "无法读取",
  };
  return (
    <section className="panel health-panel" aria-label="监控告警与备份">
      <div className="page-heading">
        <div>
          <h2>监控告警与备份</h2>
          <p className="description">
            运维进程独立检测，故障与恢复记录保存在主机。
          </p>
        </div>
        <button className="action secondary" onClick={() => void refresh()}>
          刷新运维状态
        </button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!data ? (
        <p role="status">{loaded ? "暂无运维状态" : "正在读取运维状态…"}</p>
      ) : (
        <>
          <div className="health-grid">
            <article className="health-check">
              <h3>
                监控进程{" "}
                <span className="status">{labels[data.monitor.status]}</span>
              </h3>
              <p>最近检查：{time(data.monitor.lastCheckAt)}</p>
              <p>
                活动告警：{data.activeIncidents} · 待发送通知：
                {data.pendingNotifications}
              </p>
              <small>
                {data.notificationMode === "local"
                  ? "本地记录模式，未向外发送"
                  : "Webhook 通知模式"}
              </small>
            </article>
            <article className="health-check">
              <h3>
                数据库与素材备份{" "}
                <span className="status">
                  {
                    {
                      idle: "未执行",
                      running: "备份中",
                      succeeded: "已完成",
                      failed: "失败",
                    }[data.backup.status]
                  }
                </span>
              </h3>
              <p>最近成功：{time(data.backup.lastSuccessAt)}</p>
              <p>最近尝试：{time(data.backup.lastAttemptAt)}</p>
              {data.backup.assetCount !== undefined && (
                <p>成功备份素材：{data.backup.assetCount} 个</p>
              )}
              {data.backup.message && <small>{data.backup.message}</small>}
            </article>
            <article className="health-check">
              <h3>恢复验收</h3>
              <p>
                {data.lastRestore
                  ? `最近完成：${time(data.lastRestore.verifiedAt)}`
                  : "尚未执行恢复演练"}
              </p>
              {data.lastRestore && (
                <p>校验素材：{data.lastRestore.assets} 个</p>
              )}
              <small>
                恢复仅通过运维命令写入新的隔离目标，完成后再切换部署配置。
              </small>
            </article>
          </div>
          <h3 style={{ marginTop: 18 }}>近期故障与恢复</h3>
          {data.incidents.length ? (
            <ul className="ops-incidents">
              {data.incidents.map((i) => (
                <li key={i.id}>
                  <strong>
                    {components[i.component] || "运行组件"} ·{" "}
                    {i.resolvedAt ? "已恢复" : "告警中"}
                  </strong>
                  <p>{i.message}</p>
                  <small>
                    发现：{time(i.openedAt)}
                    {i.resolvedAt && ` · 恢复：${time(i.resolvedAt)}`}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="description">
              尚无告警记录。连续两次异常后记录故障，连续两次正常后记录恢复。
            </p>
          )}
          <p className="description">
            监控默认每 30 秒检查，超过 120
            秒未更新视为过期；未配置通知地址时只保留本地记录。备份不自动删除，主机故障仍需异地备份与外部监测。
          </p>
        </>
      )}
    </section>
  );
}
