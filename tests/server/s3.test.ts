import { it, expect } from "vitest";
import { createServer } from "node:http";
import { S3Storage, checkedMedia } from "../../packages/server/src/storage";
import { probeStorage } from "../../packages/server/src/health";
it("uses the actual AWS SDK to write/read/delete objects and create expiring signed input URLs", async () => {
  const objects = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url!, "http://localhost").pathname;
    if (req.method === "PUT") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      objects.set(path, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"fixture-etag"' });
      res.end();
    } else if (req.method === "GET") {
      const data = objects.get(path);
      if (!data) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Length": data.length,
        "Content-Type": "image/png",
      });
      res.end(data);
    } else if (req.method === "DELETE") {
      objects.delete(path);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(400);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const storage = new S3Storage("test-bucket", {
    endpoint: `http://127.0.0.1:${address.port}`,
    region: "us-east-1",
    accessKeyId: "test-only-access",
    secretAccessKey: "test-only-secret",
  });
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
    "base64",
  );
  try {
    const source = () =>
      (async function* () {
        yield bytes;
      })();
    const result = await storage.put(
      "outputs/fixture",
      checkedMedia(source(), "image/png"),
      1000,
    );
    expect(result.bytes).toBe(bytes.length);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from((await storage.read("outputs/fixture")).bytes)).toEqual(
      bytes,
    );
    const signed = new URL(await storage.inputURL("outputs/fixture"));
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(signed.searchParams.has("X-Amz-Signature")).toBe(true);
    await storage.remove("outputs/fixture");
    expect(objects.size).toBe(0);
    await probeStorage(storage);
    expect(objects.size).toBe(0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
