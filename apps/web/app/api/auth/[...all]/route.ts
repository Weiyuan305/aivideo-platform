import { getAuth } from "@/lib/auth/server";
export const dynamic = "force-dynamic";
async function handler(request: Request) {
  try {
    const auth = getAuth();
    if (!auth)
      return Response.json(
        {
          error: {
            code: "AUTH_NOT_CONFIGURED",
            message:
              "账号服务未配置。请设置数据库和 Better Auth 环境变量并执行迁移。",
          },
        },
        { status: 503 },
      );
    return await auth.handler(request);
  } catch {
    return Response.json(
      {
        error: {
          code: "AUTH_UNAVAILABLE",
          message: "账号服务配置或连接异常，请检查服务器日志与数据库迁移。",
        },
      },
      { status: 503 },
    );
  }
}
export const GET = handler;
export const POST = handler;
