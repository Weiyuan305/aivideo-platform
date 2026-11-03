import type { GenerationRequest, LocalTask } from "@aivideo/contracts";
export type StoredAsset = {
  id: string;
  ownerId: string;
  name: string;
  kind: "image" | "video" | "audio";
  mime: string;
  bytes: number;
  sha256: string;
  objectKey: string;
  createdAt: string;
  sourceJobId?: string;
  sourceJobAvailable: boolean;
};
export type Artifact = {
  key: string;
  name: string;
  kind: StoredAsset["kind"];
  mime: string;
  url?: string;
};
export type ProviderState = {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  outputs?: Artifact[];
  error?: { code: string; message: string };
};
export interface ProviderAdapter {
  id: string;
  submitTimeoutMs?: number;
  pollWindowMs?: number;
  pollIntervalMs?: number;
  readiness?(
    request: GenerationRequest,
  ): { code: string; message: string } | undefined;
  submit(
    request: GenerationRequest,
    idempotencyKey: string,
    inputs: StoredAsset[],
  ): Promise<{ requestId: string; outputs?: Artifact[] }>;
  poll(requestId: string): Promise<ProviderState>;
  cancel(requestId: string): Promise<"requested" | "cancelled" | "unsupported">;
  openOutput(artifact: Artifact): Promise<AsyncIterable<Uint8Array>>;
}
/** Only throw when the provider definitively rejected a request, or before sending it. */
export class ProviderRejected extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
/** Safe diagnostic only; this does not authorize another generation request. */
export class ProviderUncertain extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class ServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const disabledProvider: ProviderAdapter = {
  id: "disabled",
  async submit() {
    throw new ServiceError(
      "GENERATION_NOT_ENABLED",
      "真实模型执行尚未启用；任务和参数已保存",
      503,
    );
  },
  async poll() {
    throw new Error("模型状态查询尚未接通");
  },
  async cancel() {
    return "unsupported";
  },
  async openOutput() {
    throw new Error("模型输出尚未接通");
  },
};
export const terminal = (task: LocalTask) =>
  [
    "succeeded",
    "failed",
    "cancelled",
    "blocked",
    "unknown",
    "archive_failed",
    "interrupted",
  ].includes(task.status);
