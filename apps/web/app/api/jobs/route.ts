import {
  owner,
  workspace,
  serverEnabled,
  jsonInput,
  failure,
  noStore,
} from "@/lib/workspace/server";
import { workflowSchema } from "@aivideo/contracts";
import { generationRequestSchema } from "@aivideo/contracts";
import { getModelReadiness } from "@aivideo/providers";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (serverEnabled()) {
    try {
      const user = await owner(request);
      return Response.json(
        {
          ...(await workspace().listJobPage(
            user,
            Object.fromEntries(new URL(request.url).searchParams),
          )),
          mode: "server-workspace",
        },
        { headers: noStore },
      );
    } catch (e) {
      return failure(e);
    }
  }
  return Response.json({
    items: [],
    nextCursor: null,
    mode: "local-workspace",
    message: "服务端任务存储尚未接通；本地任务记录由浏览器 IndexedDB 提供",
  });
}
export async function POST(request: Request) {
  if (serverEnabled()) {
    try {
      const user = await owner(request),
        raw = await jsonInput(request);
      const key = request.headers.get("idempotency-key") || crypto.randomUUID();
      if (key.length > 120 || key.length < 8)
        return Response.json(
          { error: { code: "INVALID_KEY", message: "幂等键无效" } },
          { status: 400 },
        );
      if (raw?.kind === "workflow") {
        const graph = workflowSchema.safeParse(raw.graph);
        if (!graph.success || !["dry-run", "provider"].includes(raw.mode))
          return Response.json(
            { error: { code: "INVALID_INPUT", message: "工作流参数无效" } },
            { status: 400 },
          );
        return Response.json(
          {
            item: await workspace().createJob(
              user,
              {
                graph: graph.data,
                mode: raw.mode,
                workflowVersion: raw.workflowVersion,
              },
              key,
            ),
          },
          { status: 202, headers: noStore },
        );
      }
      const parsed = generationRequestSchema.safeParse(raw);
      if (!parsed.success)
        return Response.json(
          {
            error: {
              code: "INVALID_INPUT",
              message: parsed.error.issues[0]?.message,
            },
          },
          { status: 400 },
        );
      return Response.json(
        {
          item: await workspace().createJob(
            user,
            { request: parsed.data },
            key,
          ),
        },
        { status: 202, headers: noStore },
      );
    } catch (e) {
      return failure(e);
    }
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 20000)
      return Response.json(
        { error: { code: "REQUEST_TOO_LARGE", message: "请求参数过大" } },
        { status: 413 },
      );
    input = JSON.parse(body);
  } catch {
    return Response.json(
      { error: { code: "INVALID_JSON", message: "请求格式错误" } },
      { status: 400 },
    );
  }
  const parsed = generationRequestSchema.safeParse(input);
  if (!parsed.success)
    return Response.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message,
          issues: parsed.error.issues,
        },
      },
      { status: 400 },
    );
  const readiness = getModelReadiness(parsed.data.modelKey, process.env);
  const missing = readiness.missing.length > 0;
  return Response.json(
    {
      error: {
        code: missing ? "PROVIDER_NOT_CONFIGURED" : "GENERATION_NOT_ENABLED",
        message: missing
          ? `生成接口未配置：${readiness.missing.join("、")}。当前可保存参数、素材与工作流。`
          : "配置已就绪；持久任务执行与结果归档尚未接通，本阶段不会发起付费生成。",
      },
    },
    { status: 503 },
  );
}
