import { captionPng } from "@aivideo/server";
import { owner, jsonInput, failure, noStore } from "@/lib/workspace/server";
export async function POST(request: Request) {
  try {
    await owner(request);
    const png = await captionPng(await jsonInput(request, 5000));
    return new Response(new Uint8Array(png), {
      headers: {
        ...noStore,
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
