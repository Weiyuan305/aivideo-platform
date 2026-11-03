"use client";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { modelCatalog, type ConfigurationStatus } from "@aivideo/contracts";
import { useWorkspaceQuery } from "@/features/use-workspace-query";
import { HealthPanel } from "./health-panel";
import { OperationsPanel } from "./operations-panel";
const stores: string[] = [];
async function loadConfiguration() {
  const res = await fetch("/api/config", { cache: "no-store" });
  if (!res.ok) throw new Error("无法读取配置状态");
  return (await res.json()) as ConfigurationStatus;
}
export function SettingsPage() {
  const {
    data: config,
    error,
    loaded,
    refresh,
  } = useWorkspaceQuery<ConfigurationStatus | undefined>(
    loadConfiguration,
    undefined,
    stores,
    0,
  );
  const [refreshing, setRefreshing] = useState(false);
  async function refreshStatus() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>服务配置</h1>
          <p className="description">
            图片、视频和语音克隆全部通过服务端调用
            API。配置值只在服务器环境变量中保存。
          </p>
        </div>
        <button
          className="action secondary"
          disabled={!loaded || refreshing}
          onClick={() => void refreshStatus()}
        >
          <RefreshCw size={15} />
          {refreshing ? "正在刷新…" : "刷新状态"}
        </button>
      </div>
      <div className="notice">
        {!config
          ? loaded
            ? "暂时无法确认工作区配置，请重新读取状态。"
            : "正在读取当前工作区配置…"
          : config.workspaceBackend === "server"
            ? config.generationEnabled
              ? "Agnes 图片和视频 Flash 已配置，可提交真实生成。需单独启动 worker；实际权限、额度和费用以供应商控制台为准。其他模型仍未启用。"
              : "服务端工作区已选择，需单独启动 worker。配置 AGNES_API_KEY 和官方 AGNES_BASE_URL 后可启用 Agnes 图片与视频 Flash。其他模型仍未启用。"
            : "当前使用浏览器本地工作区。配置 WORKSPACE_BACKEND=server、数据库和私有存储后可启用后台执行；原浏览器数据会保留，不会自动迁移。"}
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!config && !error && <p className="loading">读取配置状态…</p>}
      {config?.workspaceBackend === "server" && (
        <>
          <HealthPanel />
          <OperationsPanel />
        </>
      )}
      <div className="settings-list">
        {config?.services.map((s) => (
          <div className="setting-row" key={s.id}>
            <h3>
              {s.name}
              <span className={`status ${s.configured ? "ready" : ""}`}>
                {s.configured
                  ? "配置项已填写 · 待连通验证"
                  : s.missing.length < s.required.length
                    ? "部分配置 · 待补齐"
                    : "未配置"}
              </span>
            </h3>
            <p>
              环境变量：
              {s.required.map((n) => (
                <code key={n} style={{ marginRight: 12 }}>
                  {n}
                </code>
              ))}
            </p>
            {s.missing.length > 0 && <p>待填写：{s.missing.join("、")}</p>}
          </div>
        ))}
      </div>
      <h2 style={{ marginTop: 30 }}>模型目录</h2>
      <p className="description">
        Agnes Image 2.5 Flash 支持 1K 文生图和单图编辑，Video 2.5 Flash 支持
        720P
        文生视频和单张首帧图生视频。免费活动可能调整，实际以供应商账单为准。
        图片另预留 Nano Banana 2、Nano Banana Pro、FLUX.2；视频预留 Seedance
        2.0、MiniMax Hailuo 2.3、Kling O3；声音克隆预留 IndexTTS 2。
      </p>
      <div className="settings-list">
        {modelCatalog.map((m) => (
          <div className="setting-row" key={m.key}>
            <h3>
              {m.name}
              <span
                className={`status ${config?.enabledModelKeys?.includes(m.key) ? "ready" : ""}`}
              >
                {config?.enabledModelKeys?.includes(m.key)
                  ? "已配置 · 可提交"
                  : m.provider === "agnes"
                    ? "待配置 Agnes"
                    : "执行未启用"}
              </span>
            </h3>
            <p>
              <code>{m.endpoint}</code>
            </p>
            {m.parameters.durationSeconds.length > 0 && (
              <p>首期视频时长：{m.parameters.durationSeconds.join(" / ")} 秒</p>
            )}
          </div>
        ))}
      </div>
      <h2 style={{ marginTop: 30 }}>本地配置方式</h2>
      <pre className="code-block">{`# 在 platform 目录执行\ncp .env.example apps/web/.env.local\n\n# 服务端工作区需要 PostgreSQL 与私有目录\n# 填写 WORKSPACE_BACKEND / DATABASE_URL / PRIVATE_STORAGE_ROOT\n# DATABASE_URL=... pnpm db:migrate\n# Web 与 worker 使用同一组数据库、存储配置\npnpm dev\n# 另开终端\npnpm worker\n\n# 运行健康检查实际连通与后台状态；配置卡只检查变量是否填写`}</pre>
    </section>
  );
}
