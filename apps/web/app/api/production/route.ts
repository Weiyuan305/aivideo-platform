import {
  productionQuerySchema,
  productionCreateSchema,
} from "@aivideo/contracts";
import { ProductionWorkspace } from "@aivideo/server";
import {
  owner,
  workspace,
  jsonInput,
  failure,
  noStore,
} from "@/lib/workspace/server";
export async function GET(request: Request) {
  try {
    const user = await owner(request),
      params = new URL(request.url).searchParams;
    const query = productionQuerySchema.safeParse({
      q: params.get("q") ?? "",
      offset: params.get("offset") ?? 0,
    });
    if (!query.success)
      return Response.json(
        { error: { message: "项目查询参数无效" } },
        { status: 400 },
      );
    return Response.json(
      await new ProductionWorkspace(workspace()).list(
        user,
        query.data.q,
        query.data.offset,
      ),
      { headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await owner(request),
      input = productionCreateSchema.safeParse(await jsonInput(request));
    if (!input.success)
      return Response.json(
        { error: { message: "请输入有效项目名称和标识" } },
        { status: 400 },
      );
    return Response.json(
      {
        item: await new ProductionWorkspace(workspace()).create(
          user,
          input.data.id,
          input.data.name,
        ),
      },
      { status: 201, headers: noStore },
    );
  } catch (e) {
    return failure(e);
  }
}
