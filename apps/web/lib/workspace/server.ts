import "server-only";
import {
  ServerWorkspace,
  configuredWorkspace,
  ServiceError,
  matchesLocalOrigin,
} from "@aivideo/server";
import { getAuth } from "@/lib/auth/server";
const globals = globalThis as typeof globalThis & {
  aivideoServer?: ServerWorkspace;
};
export const serverEnabled = () => process.env.WORKSPACE_BACKEND === "server";
export function workspace() {
  if (!serverEnabled() || !process.env.DATABASE_URL)
    throw new ServiceError(
      "WORKSPACE_NOT_CONFIGURED",
      "服务端工作区未配置",
      503,
    );
  return (globals.aivideoServer ??= configuredWorkspace(process.env));
}
export async function owner(request: Request) {
  const origin = new URL(process.env.BETTER_AUTH_URL || request.url).origin;
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== origin
  )
    throw new ServiceError("ORIGIN_REQUIRED", "请求来源不匹配", 403);
  const auth = getAuth();
  if (auth) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session)
      throw new ServiceError("UNAUTHORIZED", "请先登录服务端工作区", 401);
    return session.user.id;
  }
  if (
    process.env.LOCAL_WORKSPACE_ENABLED === "true" &&
    matchesLocalOrigin(request, origin)
  ) {
    await workspace().ensureOwner("local-server-workspace");
    return "local-server-workspace";
  }
  throw new ServiceError(
    "AUTH_NOT_CONFIGURED",
    "请配置账号服务，或显式启用仅本机服务端工作区",
    503,
  );
}
export async function jsonInput(request: Request, max = 100000) {
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError("INVALID_JSON", "缺少请求参数");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new ServiceError("REQUEST_TOO_LARGE", "请求参数过大", 413);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServiceError("INVALID_JSON", "请求格式错误");
  }
}
export function failure(error: unknown) {
  if (error instanceof ServiceError)
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    {
      error: {
        code: "WORKSPACE_ERROR",
        message: "服务端工作区暂不可用，请检查数据库迁移和存储配置",
      },
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
export const noStore = { "Cache-Control": "private, no-store" };
