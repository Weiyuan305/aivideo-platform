import "server-only";
import { getConfiguration } from "@aivideo/providers";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(getConfiguration(process.env), {
    headers: { "Cache-Control": "no-store" },
  });
}
