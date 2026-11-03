import { Readable } from "node:stream";
import { webChunks } from "@aivideo/server/storage";
import {
  owner,
  workspace,
  jsonInput,
  failure,
  noStore,
} from "@/lib/workspace/server";
import { workflowSchema, voiceRecordSchema } from "@aivideo/contracts";
import { ServiceError, inspectHealth, waveformPeaks } from "@aivideo/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, ctx: Context) {
  try {
    const user = await owner(request),
      app = workspace(),
      { path } = await ctx.params,
      [name, id, operation] = path;
    if (name === "health" && path.length === 1 && request.method === "GET") {
      const report = await inspectHealth(app, user);
      return Response.json(report, {
        status: report.status === "healthy" ? 200 : 503,
        headers: noStore,
      });
    }
    if (!["assets", "voices", "workflows"].includes(name) || path.length > 3)
      throw new ServiceError("NOT_FOUND", "接口不存在", 404);
    if (request.method === "GET") {
      if (name === "assets" && id) {
        const asset = await app.getAsset(user, id);
        if (operation === "waveform")
          return Response.json(
            await waveformPeaks(asset, app.storage, request.signal),
            { headers: noStore },
          );
        if (operation === "file") {
          const rangeHeader = request.headers.get("range");
          let range: { start: number; end: number } | undefined;
          if (rangeHeader) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
            if (!match || (!match[1] && !match[2]))
              return new Response(null, {
                status: 416,
                headers: { "Content-Range": `bytes */${asset.bytes}` },
              });
            const start = match[1]
              ? Number(match[1])
              : Math.max(0, asset.bytes - Number(match[2]));
            const end = match[1]
              ? match[2]
                ? Math.min(Number(match[2]), asset.bytes - 1)
                : asset.bytes - 1
              : asset.bytes - 1;
            if (start > end || start >= asset.bytes)
              return new Response(null, {
                status: 416,
                headers: { "Content-Range": `bytes */${asset.bytes}` },
              });
            range = { start, end };
          }
          const stream = await app.storage.stream(asset.objectKey, range);
          return new Response(
            Readable.toWeb(Readable.from(stream)) as ReadableStream,
            {
              status: range ? 206 : 200,
              headers: {
                ...noStore,
                "Content-Type": asset.mime,
                "Content-Length": String(
                  range ? range.end - range.start + 1 : asset.bytes,
                ),
                "Accept-Ranges": "bytes",
                ...(range
                  ? {
                      "Content-Range": `bytes ${range.start}-${range.end}/${asset.bytes}`,
                    }
                  : {}),
                "X-Content-Type-Options": "nosniff",
                "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
              },
            },
          );
        }
        return Response.json({ item: asset }, { headers: noStore });
      }
      if (name === "assets")
        return Response.json(
          await app.listAssetPage(
            user,
            Object.fromEntries(new URL(request.url).searchParams),
          ),
          { headers: noStore },
        );
      const items = await app.listLibrary(user, name as "voices" | "workflows");
      if (id) {
        const item = items.find((i) => i.id === id);
        if (!item) throw new ServiceError("NOT_FOUND", "资源不存在", 404);
        return Response.json({ item }, { headers: noStore });
      }
      return Response.json({ items }, { headers: noStore });
    }
    if (request.method === "POST" && name === "assets" && !id) {
      const length = Number(request.headers.get("content-length"));
      if (
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        length > 100 * 1024 * 1024
      )
        throw new ServiceError(
          "INVALID_SIZE",
          "文件不能为空且不得超过 100 MB",
          413,
        );
      const contentType = request.headers.get("content-type") || "";
      const fileName = decodeURIComponent(
        request.headers.get("x-file-name") || "upload",
      );
      if (!request.body) throw new ServiceError("EMPTY_FILE", "缺少文件");
      return Response.json(
        {
          item: await app.uploadStream(
            user,
            fileName,
            contentType,
            webChunks(request.body),
          ),
        },
        { status: 201, headers: noStore },
      );
    }
    if (request.method === "POST" && name === "voices" && !id) {
      const parsed = voiceRecordSchema.safeParse(
        await jsonInput(request, 2000),
      );
      if (!parsed.success)
        throw new ServiceError("INVALID_INPUT", "声音参数无效");
      return Response.json(
        {
          item: await app.saveVoice(user, {
            ...parsed.data,
            createdAt: parsed.data.createdAt ?? new Date().toISOString(),
          }),
        },
        { headers: noStore },
      );
    }
    if (request.method === "POST" && name === "workflows" && !id) {
      const parsed = workflowSchema.safeParse(await jsonInput(request));
      if (!parsed.success)
        throw new ServiceError("INVALID_GRAPH", "工作流格式无效");
      return Response.json(
        { item: await app.saveWorkflow(user, parsed.data) },
        { headers: noStore },
      );
    }
    if (request.method === "DELETE" && id && !operation) {
      await app.removeResource(
        user,
        name as "assets" | "voices" | "workflows",
        id,
      );
      return Response.json({ ok: true }, { headers: noStore });
    }
    throw new ServiceError("NOT_FOUND", "接口不存在", 404);
  } catch (e) {
    return failure(e);
  }
}
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
