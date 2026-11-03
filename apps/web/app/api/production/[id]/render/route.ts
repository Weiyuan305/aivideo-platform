import { renderSubmissionSchema, productionIdSchema } from "@aivideo/contracts";
import { ProductionWorkspace, ServiceError } from "@aivideo/server";
import {
  owner,
  workspace,
  jsonInput,
  failure,
  noStore,
} from "@/lib/workspace/server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await owner(request),
      { id } = await context.params;
    if (!productionIdSchema.safeParse(id).success)
      throw new ServiceError("NOT_FOUND", "项目不存在", 404);
    const input = renderSubmissionSchema.safeParse(await jsonInput(request));
    if (!input.success)
      throw new ServiceError("INVALID_REQUEST", "剪辑版本或分集参数无效");
    const task = await new ProductionWorkspace(workspace()).render(
      user,
      id,
      input.data.episodeId,
      input.data.version,
      input.data.idempotencyKey,
    );
    return Response.json({ task }, { headers: noStore });
  } catch (e) {
    return failure(e);
  }
}
