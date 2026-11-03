import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { modelCatalog, type GenerationRequest } from "@aivideo/contracts";
import {
  ProviderRejected,
  ProviderUncertain,
  type Artifact,
  type ProviderAdapter,
  type ProviderState,
  type StoredAsset,
} from "./types";
import { maxBytes, webChunks, type ObjectStorage } from "./storage";

export const AGNES_BASE_URL = "https://apihub.agnes-ai.com/v1";
export function agnesConfigured(env: NodeJS.ProcessEnv) {
  return (
    Boolean(env.AGNES_API_KEY?.trim()) &&
    (!env.AGNES_BASE_URL ||
      env.AGNES_BASE_URL.replace(/\/+$/, "") === AGNES_BASE_URL)
  );
}

/** References and outputs must be public HTTPS; credentials never follow media URLs. */
export async function publicMediaURL(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(url.hostname.replace(/[\[\]]/g, ""))
  )
    throw new Error("无效媒体地址");
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) =>
      /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|198\.(18|19)\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.|::|f[cd]|fe[89ab])/i.test(
        address,
      ),
    )
  )
    throw new Error("媒体地址必须可由公网访问");
  return url.href;
}

type Options = {
  key: string;
  storage: ObjectStorage;
  referenceURL: (asset: StoredAsset) => Promise<string | undefined>;
  fetch?: typeof fetch;
  validateURL?: (url: string) => Promise<string>;
};
export class AgnesProvider implements ProviderAdapter {
  id = "agnes";
  // Images are synchronous; never retry POST after a timeout or transport error.
  submitTimeoutMs = 255_000;
  pollWindowMs = 300_000;
  pollIntervalMs = 2000;
  private fetcher: typeof fetch;
  private validateURL: (url: string) => Promise<string>;
  constructor(private options: Options) {
    this.fetcher = options.fetch ?? fetch;
    this.validateURL = options.validateURL ?? publicMediaURL;
  }
  readiness(request: GenerationRequest) {
    if (
      modelCatalog.find((m) => m.key === request.modelKey)?.provider !== "agnes"
    )
      return {
        code: "GENERATION_NOT_ENABLED",
        message: "此模型尚未接入；可选择 Agnes 图片或视频 Flash 模型",
      };
    if (!this.options.key.trim())
      return {
        code: "PROVIDER_NOT_CONFIGURED",
        message: "请在服务端配置 AGNES_API_KEY",
      };
  }
  private async api(path: string, body?: unknown) {
    const res = await this.fetcher(`https://apihub.agnes-ai.com${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.options.key}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(body === undefined ? 12_000 : 240_000),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => undefined);
      // Observed Agnes admission rejection. Other 5xx responses remain ambiguous.
      const imageQueueFull =
        typeof errorBody?.error?.message === "string" &&
        errorBody.error.message.startsWith(
          "image queue is full, please retry later",
        );
      if (
        res.status === 503 &&
        (errorBody?.code === "video_queue_full" || imageQueueFull)
      )
        throw new ProviderRejected(
          "AGNES_QUEUE_FULL",
          `Agnes ${imageQueueFull ? "图片" : "视频"}队列已满，本次未获得生成结果。请稍后手动重试`,
        );
      const messages: Record<number, string> = {
        400: "Agnes 拒绝了请求参数，请核对模型、参考素材和时长",
        401: "Agnes 密钥无效或已过期",
        402: "Agnes 账户额度不足或此模型需要付费",
        403: "Agnes 账户没有此模型的调用权限",
        404: "Agnes 模型或任务不存在",
        422: "Agnes 请求参数校验失败",
        429: "Agnes 已限流，请稍后手动重试；本次未自动重提",
      };
      // 408/5xx/transport errors may follow acceptance; keep them uncertain.
      if (messages[res.status])
        throw new ProviderRejected(
          `AGNES_HTTP_${res.status}`,
          messages[res.status],
        );
      throw new ProviderUncertain(
        `AGNES_HTTP_${res.status}`,
        `Agnes 返回 HTTP ${res.status}；受理结果不明，请在供应商控制台核对，不会自动重提`,
      );
    }
    // No raw provider error, response or key enters product logs.
    return await res.json();
  }
  private artifact(url: string, kind: "image" | "video"): Artifact {
    if (typeof url !== "string" || url.length > 8192)
      throw new Error("无效输出");
    const path = new URL(url).pathname.toLowerCase();
    const ext =
      kind === "video"
        ? "mp4"
        : /\.jpe?g$/.test(path)
          ? "jpg"
          : path.endsWith(".webp")
            ? "webp"
            : "png";
    return {
      key: "output-0",
      name: `Agnes-${kind}.${ext}`,
      kind,
      mime:
        kind === "video"
          ? "video/mp4"
          : ext === "jpg"
            ? "image/jpeg"
            : `image/${ext}`,
      url,
    };
  }
  async submit(request: GenerationRequest, key: string, inputs: StoredAsset[]) {
    const unavailable = this.readiness(request);
    if (unavailable)
      throw new ProviderRejected(unavailable.code, unavailable.message);
    const model = modelCatalog.find((m) => m.key === request.modelKey)!;
    const reference = inputs[0];
    if (model.kind === "image") {
      let image: string | undefined;
      if (model.capability === "image_edit") {
        if (
          !reference ||
          reference.kind !== "image" ||
          reference.bytes > maxBytes("image")
        )
          throw new ProviderRejected(
            "INVALID_REFERENCE",
            "需要一张有效参考图片",
          );
        try {
          const { bytes } = await this.options.storage.read(
            reference.objectKey,
          );
          if (bytes.byteLength > maxBytes("image"))
            throw new Error("too large");
          image = `data:${reference.mime};base64,${Buffer.from(bytes).toString("base64")}`;
        } catch {
          throw new ProviderRejected(
            "REFERENCE_UNAVAILABLE",
            "参考图片无法读取，请重新选择素材",
          );
        }
      }
      const response = await this.api("/v1/images/generations", {
        model: "agnes-image-2.5-flash",
        prompt: request.prompt,
        size: "1K",
        ratio: request.parameters.aspectRatio ?? "1:1",
        extra_body: {
          response_format: "url",
          ...(image ? { image: [image] } : {}),
        },
      });
      if (!response.data?.[0]?.url) throw new Error("Agnes 未返回图片地址");
      return {
        requestId: `image:${key}`,
        outputs: [this.artifact(response.data[0].url, "image")],
      };
    }
    let firstFrame: string | undefined;
    if (model.capability === "image_to_video") {
      try {
        const candidate =
          reference && (await this.options.referenceURL(reference));
        if (candidate) firstFrame = await this.validateURL(candidate);
      } catch {
        /* A local/preflight failure is safe to retry after correction. */
      }
      if (!firstFrame)
        throw new ProviderRejected(
          "PUBLIC_REFERENCE_REQUIRED",
          "图生视频需要公网可读的参考图。请选择 Agnes 已生成的图片，或配置私有 S3 的临时签名链接；本机上传图可先用 Agnes 图片编辑生成新图",
        );
    }
    const response = await this.api("/v1/videos", {
      model: "agnes-video-2.5-flash",
      prompt: request.prompt,
      mode: firstFrame ? "keyframe" : "text",
      size: "720P",
      seconds: String(request.parameters.durationSeconds ?? 4),
      aspect_ratio: request.parameters.aspectRatio ?? "16:9",
      ...(request.parameters.seed !== undefined
        ? { seed: request.parameters.seed }
        : {}),
      ...(firstFrame ? { first_frame: firstFrame } : {}),
      n: 1,
    });
    // Never substitute task_id/id: Agnes explicitly requires video_id.
    if (
      typeof response.video_id !== "string" ||
      !response.video_id ||
      response.video_id.length > 200
    )
      throw new Error("Agnes 未返回 video_id");
    return { requestId: response.video_id };
  }
  async poll(requestId: string): Promise<ProviderState> {
    const response = await this.api(
      `/agnesapi?${new URLSearchParams({
        video_id: requestId,
        model_name: "agnes-video-2.5-flash",
      })}`,
    );
    switch (response.status) {
      case "completed":
        if (!response.url) throw new Error("视频结果缺少地址");
        return {
          status: "succeeded",
          outputs: [this.artifact(response.url, "video")],
        };
      case "failed":
        return {
          status: "failed",
          error: {
            code: "AGNES_GENERATION_FAILED",
            message: "Agnes 视频生成失败，请在供应商控制台核对原因后重试",
          },
        };
      case "cancelled":
        return { status: "cancelled" };
      case "queued":
      case "pending":
        return { status: "queued" };
      default:
        return { status: "running" };
    }
  }
  async cancel() {
    return "unsupported" as const;
  }
  async openOutput(artifact: Artifact) {
    if (!artifact.url) throw new Error("缺少归档地址");
    const url = await this.validateURL(artifact.url);
    const res = await this.fetcher(url, {
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (
      !res.ok ||
      !res.body ||
      Number(res.headers.get("content-length") ?? 0) > maxBytes(artifact.kind)
    ) {
      await res.body?.cancel();
      throw new Error("Agnes 输出暂时无法下载");
    }
    return webChunks(res.body);
  }
}
