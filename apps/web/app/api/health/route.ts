import { inspectHealth } from "@aivideo/server";
import { workspace, serverEnabled } from "@/lib/workspace/server";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!serverEnabled())
    return Response.json(
      { status: "local", generationEnabled: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  try {
    const report = await inspectHealth(workspace());
    const { status, message } = report.worker;
    return Response.json(
      { ...report, worker: { status, message } },
      {
        status: report.status === "healthy" ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return Response.json(
      {
        status: "unavailable",
        generationEnabled: false,
        error: { message: "工作区健康检查不可用，请检查配置" },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
