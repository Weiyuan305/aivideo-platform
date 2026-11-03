import {
  productionChangeSchema,
  productionRevisionSchema,
  productionIdSchema,
} from "@aivideo/contracts";
import { ProductionWorkspace, ServiceError } from "@aivideo/server";
import {
  owner,
  workspace,
  jsonInput,
  failure,
  noStore,
} from "@/lib/workspace/server";
type Context = { params: Promise<{ id: string }> };
async function target(request: Request, context: Context) {
  const user = await owner(request),
    { id } = await context.params;
  if (!productionIdSchema.safeParse(id).success)
    throw new ServiceError("NOT_FOUND", "项目不存在", 404);
  return { user, id, service: new ProductionWorkspace(workspace()) };
}
export async function GET(request: Request, context: Context) {
  try {
    const { user, id, service } = await target(request, context);
    return Response.json(
      { item: await service.get(user, id) },
      { headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { user, id, service } = await target(request, context);
    const input = productionChangeSchema.safeParse(
      await jsonInput(request, 256000),
    );
    if (!input.success)
      return Response.json(
        { error: { message: "制作参数不完整或超出限制" } },
        { status: 400 },
      );
    return Response.json(
      {
        item: await service.change(
          user,
          id,
          input.data.revision,
          input.data.command,
        ),
      },
      { headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const { user, id, service } = await target(request, context);
    const input = productionRevisionSchema.safeParse(await jsonInput(request));
    if (!input.success)
      return Response.json(
        { error: { message: "项目版本无效" } },
        { status: 400 },
      );
    await service.remove(user, id, input.data.revision);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (e) {
    return failure(e);
  }
}
