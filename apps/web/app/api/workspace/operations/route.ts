import { owner, failure, noStore } from "@/lib/workspace/server";
import { OpsStore } from "@aivideo/server/ops/state";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await owner(request);
    if (!process.env.OPS_STATE_ROOT)
      return Response.json(
        {
          monitor: { status: "missing" },
          incidents: [],
          activeIncidents: 0,
          pendingNotifications: 0,
          notificationMode: "local",
          backup: { status: "idle" },
        },
        { headers: noStore },
      );
    return Response.json(
      await new OpsStore(process.env.OPS_STATE_ROOT).summary(),
      { headers: noStore },
    );
  } catch (error) {
    return failure(error);
  }
}
