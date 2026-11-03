import { validateWorkflow } from "@aivideo/core/workflow";
export async function POST(request: Request) {
  try {
    const result = validateWorkflow(await request.json());
    return Response.json(result, { status: result.valid ? 200 : 400 });
  } catch {
    return Response.json(
      { valid: false, errors: ["无效 JSON"], order: [] },
      { status: 400 },
    );
  }
}
