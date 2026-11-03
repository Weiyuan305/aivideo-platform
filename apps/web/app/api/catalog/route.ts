import { modelCatalog } from "@aivideo/contracts";
import { getModelReadiness } from "@aivideo/providers";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({
    revision: "foundation-v1",
    models: modelCatalog.map((m) => ({
      ...m,
      ...getModelReadiness(m.key, process.env),
    })),
  });
}
