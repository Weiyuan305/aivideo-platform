import { modelCatalog, type ConfigurationStatus } from "@aivideo/contracts";

export function agnesEnabled(env: Record<string, string | undefined>) {
  return (
    env.WORKSPACE_BACKEND === "server" &&
    Boolean(env.AGNES_API_KEY?.trim()) &&
    (!env.AGNES_BASE_URL ||
      env.AGNES_BASE_URL.replace(/\/+$/, "") ===
        "https://apihub.agnes-ai.com/v1")
  );
}
const services = [
  {
    id: "agnes",
    name: "图片 / 视频 · Agnes 2.5 Flash",
    required: ["AGNES_API_KEY"],
  },
  {
    id: "fal",
    name: "图片 / 视频 · fal（Nano Banana / Seedance / MiniMax / FLUX / Kling）",
    required: ["FAL_KEY"],
  },
  {
    id: "replicate",
    name: "语音克隆 · Replicate",
    required: ["REPLICATE_API_TOKEN", "REPLICATE_INDEXTTS_VERSION"],
  },
  {
    id: "database",
    name: "PostgreSQL / 账号",
    required: ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"],
  },
  {
    id: "storage",
    name: "私有 S3 存储",
    required: [
      "S3_ENDPOINT",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ],
  },
  {
    id: "trigger",
    name: "预留托管队列 · Trigger.dev（当前使用 pg-boss）",
    required: ["TRIGGER_SECRET_KEY", "TRIGGER_PROJECT_ID"],
  },
];

/** Server-only package. Public response is an explicit allowlist, never process.env. */
export function getConfiguration(
  env: Record<string, string | undefined>,
): ConfigurationStatus {
  return {
    mode: "local-workspace",
    workspaceBackend: env.WORKSPACE_BACKEND === "server" ? "server" : "browser",
    generationEnabled: agnesEnabled(env),
    enabledModelKeys: modelCatalog
      .filter((m) => m.provider === "agnes" && agnesEnabled(env))
      .map((m) => m.key),
    services: [
      ...services.map((service) =>
        service.id === "storage" && !env.S3_BUCKET
          ? {
              id: "storage",
              name: "本机私有文件存储",
              required: ["PRIVATE_STORAGE_ROOT"],
            }
          : service,
      ),
      {
        id: "queue",
        name: "后台队列 · pg-boss（与任务共用 PostgreSQL）",
        required: ["DATABASE_URL"],
      },
    ].map((service) => {
      const missing = service.required.filter((name) => !env[name]?.trim());
      return { ...service, missing, configured: missing.length === 0 };
    }),
  };
}
export function getModelReadiness(
  modelKey: string,
  env: Record<string, string | undefined>,
) {
  const model = modelCatalog.find((m) => m.key === modelKey);
  if (!model) return { ready: false, missing: [], reason: "UNKNOWN_MODEL" };
  return {
    ready: model.provider === "agnes" && agnesEnabled(env),
    missing: model.requiredEnv.filter((name) => !env[name]?.trim()),
    reason:
      model.provider === "agnes"
        ? agnesEnabled(env)
          ? "READY"
          : "AGNES_NOT_CONFIGURED"
        : "GENERATION_NOT_IMPLEMENTED",
  };
}
