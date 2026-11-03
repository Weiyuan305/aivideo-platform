import { createServer } from "node:http";
import { S3Storage } from "../../packages/server/src/storage";
export async function s3Fixture() {
  const objects = new Map<string, Buffer>();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost"),
      path = url.pathname.replace(/\/$/, "");
    if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const keys = [...objects.keys()]
        .filter((k) => k.startsWith(path + "/"))
        .slice(0, 1);
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><KeyCount>${keys.length}</KeyCount><IsTruncated>false</IsTruncated>${keys.map((k) => `<Contents><Key>${k.slice(path.length + 1)}</Key></Contents>`).join("")}</ListBucketResult>`,
      );
      return;
    }
    if (req.method === "PUT") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      objects.set(path, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"fixture"' });
      res.end();
      return;
    }
    if (req.method === "DELETE") {
      objects.delete(path);
      res.writeHead(204);
      res.end();
      return;
    }
    const bytes = objects.get(path);
    if (req.method === "GET" && bytes) {
      res.writeHead(200, { "Content-Length": bytes.length });
      res.end(bytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    objects,
    storage: (bucket: string) =>
      new S3Storage(bucket, {
        endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        region: "us-east-1",
        accessKeyId: "test-only",
        secretAccessKey: "test-only",
      }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
