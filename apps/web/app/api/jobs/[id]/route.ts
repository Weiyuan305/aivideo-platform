import {
  owner,
  workspace,
  jsonInput,
  failure,
  noStore,
} from "@/lib/workspace/server";
export const dynamic = "force-dynamic";
const actions = [
  "cancel",
  "retry",
  "retry-archive",
  "reconcile",
  "resume",
  "delete",
];
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await owner(request),
      { id } = await ctx.params;
    return Response.json(
      { item: await workspace().getJob(user, id) },
      { headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await owner(request),
      { id } = await ctx.params;
    const input = await jsonInput(request, 1000);
    const key = request.headers.get("idempotency-key") || crypto.randomUUID();
    if (
      !input ||
      key.length < 8 ||
      key.length > 120 ||
      !actions.includes(input.action) ||
      Object.keys(input).some((k) => k !== "action")
    )
      return Response.json(
        { error: { code: "INVALID_ACTION", message: "无效任务操作" } },
        { status: 400 },
      );
    return Response.json(
      { item: await workspace().act(user, id, input.action, key) },
      { headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}
