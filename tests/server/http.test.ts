import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { emptyTimeline } from "../../packages/core/src/timeline";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { ServerWorkspace, DiskStorage } from "../../packages/server/src/index";
import { startWorker } from "../../packages/server/src/worker";
import { FixtureProvider } from "./fixture-provider";
import { createTemplate } from "../../packages/core/src/workflow";
const base = process.env.TEST_HTTP_URL;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
  "base64",
);
describe.skipIf(!base)(
  "HTTP → real auth → durable worker → private archive",
  () => {
    let app: ServerWorkspace,
      worker: Awaited<ReturnType<typeof startWorker>>,
      cookie: string,
      otherCookie: string;
    async function api(
      path: string,
      method = "GET",
      body?: unknown,
      token = cookie,
      headers: Record<string, string> = {},
    ) {
      return fetch(base + path, {
        method,
        headers: {
          Origin: base!,
          Cookie: token ?? "",
          ...(Buffer.isBuffer(body)
            ? { "Content-Type": "image/png", "X-File-Name": "fixture.png" }
            : { "Content-Type": "application/json" }),
          ...headers,
        },
        body:
          body === undefined
            ? undefined
            : Buffer.isBuffer(body)
              ? new Uint8Array(body)
              : JSON.stringify(body),
      });
    }
    async function register() {
      const response = await api(
        "/api/auth/sign-up/email",
        "POST",
        {
          name: "closure-test",
          email: crypto.randomUUID() + "@example.test",
          password: "test-password-0000",
        },
        "",
      );
      expect(response.status).toBe(200);
      return response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
    }
    async function done(id: string) {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const response = await api("/api/jobs/" + id);
        const body = await response.json();
        if (body.item?.status === "succeeded") return body.item;
        if (
          ["failed", "archive_failed", "unknown", "blocked"].includes(
            body.item?.status,
          )
        )
          throw new Error(JSON.stringify(body));
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error("background task timeout");
    }
    beforeAll(async () => {
      const url = process.env.TEST_DATABASE_URL!;
      if (!new URL(url).pathname.startsWith("/aivideo_test"))
        throw new Error("isolated test DB required");
      app = new ServerWorkspace(
        url,
        new DiskStorage(process.env.TEST_HTTP_STORAGE_ROOT!),
        new FixtureProvider(),
      );
      worker = await startWorker(app, url, {
        schema: "http_" + crypto.randomUUID().replaceAll("-", ""),
      });
      cookie = await register();
      otherCookie = await register();
    });
    afterAll(async () => {
      await worker?.stop();
      await app?.close();
    });
    it("requires a session and correct origin", async () => {
      expect((await api("/api/jobs", "GET", undefined, "")).status).toBe(401);
      expect(
        (
          await api(
            "/api/jobs",
            "POST",
            { modelKey: "image.flux2.t2i.v1", prompt: "test" },
            cookie,
            { Origin: "https://wrong.invalid" },
          )
        ).status,
      ).toBe(403);
    });
    it("closes the production HTTP flow with upload, adoption, reload, conflict and session protection", async () => {
      const projectId = crypto.randomUUID(),
        episodeId = crypto.randomUUID(),
        shotId = crypto.randomUUID(),
        candidateId = crypto.randomUUID();
      expect((await api("/api/production", "GET", undefined, "")).status).toBe(
        401,
      );
      expect(
        (
          await api(
            "/api/production",
            "POST",
            { id: projectId, name: "HTTP 项目" },
            cookie,
            { Origin: "https://wrong.invalid" },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await api("/api/production", "POST", {
            id: projectId,
            name: "HTTP 项目",
          })
        ).status,
      ).toBe(201);
      const path = "/api/production/" + projectId;
      expect((await api(path, "GET", undefined, otherCookie)).status).toBe(404);
      const asset = (
        await (await api("/api/workspace/assets", "POST", png)).json()
      ).item;
      let revision = 1;
      for (const command of [
        {
          type: "episode.save",
          id: episodeId,
          name: "第一集",
          script: "夜".repeat(40000),
        },
        { type: "shot.save", episodeId, shotId, input: { name: "开场" } },
        {
          type: "candidate.add",
          episodeId,
          shotId,
          id: candidateId,
          assetId: asset.id,
          label: "上传版",
        },
        { type: "candidate.select", episodeId, shotId, candidateId },
      ]) {
        const response = await api(path, "PATCH", { revision, command });
        expect(response.status).toBe(200);
        revision = (await response.json()).item.revision;
      }
      const project = (await (await api(path)).json()).item;
      expect(project.episodes[0].shots[0].selectedCandidateId).toBe(
        candidateId,
      );
      expect(
        (
          await api(path, "PATCH", {
            revision: 1,
            command: { type: "project.edit", name: "覆盖", description: "" },
          })
        ).status,
      ).toBe(409);
      expect(
        (await api(path, "PATCH", { revision, command: { type: "unknown" } }))
          .status,
      ).toBe(400);
      expect(
        (await api("/api/workspace/assets/" + asset.id, "DELETE")).status,
      ).toBe(409);
      expect((await api(path, "DELETE", { revision })).status).toBe(200);
      expect((await api("/api/workspace/assets/" + asset.id)).status).toBe(200);
      expect((await api(path)).status).toBe(404);
    });
    it("serves authenticated search pages and rejects invalid queries or cross-account cursors", async () => {
      const marker = "http-pages-" + crypto.randomUUID();
      for (let i = 0; i < 3; i++)
        expect(
          (
            await api("/api/jobs", "POST", {
              modelKey: "image.flux2.t2i.v1",
              prompt: marker + " literal_% " + i,
              assetIds: [],
              parameters: {},
            })
          ).status,
        ).toBe(202);
      const first = await api(
        "/api/jobs?limit=1&q=" + encodeURIComponent(marker),
      );
      expect(first.status).toBe(200);
      const page = await first.json();
      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(3);
      expect(page.nextCursor).toBeTruthy();
      const next = await (
        await api(
          "/api/jobs?limit=1&q=" +
            encodeURIComponent(marker) +
            "&cursor=" +
            page.nextCursor,
        )
      ).json();
      expect(next.items[0].id).not.toBe(page.items[0].id);
      expect((await api("/api/jobs?limit=501")).status).toBe(400);
      expect(
        (
          await api(
            "/api/jobs?cursor=" + page.nextCursor,
            "GET",
            undefined,
            otherCookie,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await (
            await api(
              "/api/jobs?q=" + encodeURIComponent(marker),
              "GET",
              undefined,
              otherCookie,
            )
          ).json()
        ).total,
      ).toBe(0);
    });
    it("exposes coarse readiness publicly and protects account queue details", async () => {
      const publicReport = await (
        await api("/api/health", "GET", undefined, "")
      ).json();
      expect(publicReport.database.status).toBe("healthy");
      expect(publicReport.storage.status).toBe("healthy");
      expect(publicReport.queue).toBeUndefined();
      expect(publicReport.worker.activeWorkers).toBeUndefined();
      expect(
        (await api("/api/workspace/health", "GET", undefined, "")).status,
      ).toBe(401);
      const report = await (await api("/api/workspace/health")).json();
      expect(report.worker.status).toBe("healthy");
      expect(report.queue).toBeDefined();
      expect(report.generationEnabled).toBe(false);
    });
    it("protects operations reports and exposes no backup files, paths or credentials", async () => {
      expect(
        (await api("/api/workspace/operations", "GET", undefined, "")).status,
      ).toBe(401);
      const response = await api("/api/workspace/operations");
      expect(response.status).toBe(200);
      const report = await response.json();
      expect(report.monitor).toBeDefined();
      expect(report.backup).toBeDefined();
      expect(JSON.stringify(report)).not.toMatch(
        /postgresql:\/\/|PRIVATE_STORAGE_ROOT|OPS_WEBHOOK_URL|database\.dump/,
      );
      expect((await api("/api/workspace/operations", "POST", {})).status).toBe(
        405,
      );
    });
    it("uploads privately, completes after submission returns, reuses outputs and protects references", async () => {
      const uploaded = await api("/api/workspace/assets", "POST", png);
      expect(uploaded.status).toBe(201);
      const input = (await uploaded.json()).item;
      const key = crypto.randomUUID(),
        body = {
          modelKey: "image.flux2.edit.v1",
          prompt: "HTTP test",
          assetIds: [input.id],
          parameters: {},
        };
      const first = await api("/api/jobs", "POST", body, cookie, {
        "Idempotency-Key": key,
      });
      expect(first.status).toBe(202);
      const task = (await first.json()).item;
      const second = await api("/api/jobs", "POST", body, cookie, {
        "Idempotency-Key": key,
      });
      expect((await second.json()).item.id).toBe(task.id);
      const finished = await done(task.id);
      expect(finished.backend).toBe("server");
      const assets = (await (await api("/api/workspace/assets")).json()).items;
      const output = assets.find(
        (a: { id: string }) => a.id === finished.outputAssetIds[0],
      );
      expect(output.sha256).toMatch(/^[a-f0-9]{64}$/);
      const file = await api(`/api/workspace/assets/${output.id}/file`);
      expect(file.status).toBe(200);
      expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
      const range = await api(
        `/api/workspace/assets/${output.id}/file`,
        "GET",
        undefined,
        cookie,
        { Range: "bytes=0-7" },
      );
      expect(range.status).toBe(206);
      expect(Buffer.from(await range.arrayBuffer())).toEqual(
        png.subarray(0, 8),
      );
      expect(
        (
          await api(
            `/api/workspace/assets/${output.id}/file`,
            "GET",
            undefined,
            otherCookie,
          )
        ).status,
      ).toBe(404);
      expect(
        (await api("/api/jobs/" + task.id, "GET", undefined, otherCookie))
          .status,
      ).toBe(404);
      const videoResponse = await api("/api/jobs", "POST", {
        modelKey: "video.kling-o3.i2v.v1",
        prompt: "reuse generated image",
        assetIds: [output.id],
        parameters: { durationSeconds: 5 },
      });
      expect(videoResponse.status).toBe(202);
      const video = await done((await videoResponse.json()).item.id);
      expect(video.kind).toBe("video");
      expect(video.outputAssetIds).toHaveLength(1);
      expect(
        (await api("/api/workspace/assets/" + output.id, "DELETE")).status,
      ).toBe(409);
    });
    it("runs a frozen image-video workflow through actual archived asset IDs", async () => {
      const graph = createTemplate("image-video");
      const saved = await api("/api/workspace/workflows", "POST", graph);
      expect(saved.status).toBe(200);
      const response = await api("/api/jobs", "POST", {
        kind: "workflow",
        graph,
        mode: "provider",
        workflowVersion: 1,
      });
      expect(response.status).toBe(202);
      const id = (await response.json()).item.id;
      graph.nodes[0].data.text = "later draft";
      const run = await done(id);
      expect(
        run.nodes.every((n: { status: string }) => n.status === "succeeded"),
      ).toBe(true);
      expect(run.nodes[2].inputs.image.assetId).toBe(
        run.nodes[1].outputs.image.assetId,
      );
      expect(run.outputAssetIds).toHaveLength(2);
      expect(run.graph.nodes[0].data.text).not.toBe("later draft");
      const invalid = await api("/api/jobs", "POST", {
        kind: "workflow",
        graph,
        mode: "dry-run",
        workflowVersion: 1,
      });
      expect(invalid.status).toBe(409);
    });
    it("uploads reference audio, reuses a named voice and archives private clone outputs", async () => {
      const fixture = new FixtureProvider();
      const chunks = [];
      for await (const c of await fixture.openOutput({
        key: "audio",
        name: "reference.wav",
        kind: "audio",
        mime: "audio/wav",
      }))
        chunks.push(c);
      const wav = Buffer.concat(chunks);
      const uploaded = await api("/api/workspace/assets", "POST", wav, cookie, {
        "Content-Type": "audio/wav",
        "X-File-Name": "reference.wav",
      });
      expect(uploaded.status).toBe(201);
      const reference = (await uploaded.json()).item;
      const voice = {
        id: crypto.randomUUID(),
        name: "参考声音",
        assetId: reference.id,
      };
      expect((await api("/api/workspace/voices", "POST", voice)).status).toBe(
        200,
      );
      expect(
        (
          await api(
            "/api/workspace/voices",
            "POST",
            { ...voice, id: crypto.randomUUID() },
            otherCookie,
          )
        ).status,
      ).toBe(400);
      const response = await api("/api/jobs", "POST", {
        modelKey: "voice.indextts2.clone.v1",
        prompt: "闭环测试文本",
        voiceId: voice.id,
        assetIds: [],
        parameters: {},
      });
      expect(response.status).toBe(202);
      const task = await done((await response.json()).item.id);
      expect(task.kind).toBe("voice");
      const file = await api(
        `/api/workspace/assets/${task.outputAssetIds[0]}/file`,
      );
      expect(file.headers.get("Content-Type")).toBe("audio/wav");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(wav);
      expect(
        (await api("/api/workspace/voices/" + voice.id, "DELETE")).status,
      ).toBe(409);
      expect(
        (await api("/api/workspace/assets/" + reference.id, "DELETE")).status,
      ).toBe(409);
    });
    it("uploads and adopts a shot, saves a timeline and exports through authenticated HTTP and the durable worker", async () => {
      const uuid = () => crypto.randomUUID(),
        ff = promisify(execFile);
      const result = await ff(
        process.env.FFMPEG_PATH || "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=green:s=320x180:d=1",
          "-frames:v",
          "1",
          "-f",
          "image2pipe",
          "-c:v",
          "png",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 1000000 },
      );
      const uploaded = await api(
        "/api/workspace/assets",
        "POST",
        result.stdout,
      );
      expect(uploaded.status).toBe(201);
      const asset = (await uploaded.json()).item,
        projectId = uuid(),
        episodeId = uuid(),
        shotId = uuid(),
        candidateId = uuid();
      let p = (
        await (
          await api("/api/production", "POST", {
            id: projectId,
            name: "HTTP movie",
          })
        ).json()
      ).item;
      const change = async (command: unknown) => {
        const res = await api(`/api/production/${projectId}`, "PATCH", {
          revision: p.revision,
          command,
        });
        expect(res.status).toBe(200);
        p = (await res.json()).item;
      };
      await change({
        type: "episode.save",
        id: episodeId,
        name: "HTTP first",
        script: "",
      });
      await change({
        type: "shot.save",
        episodeId,
        shotId,
        input: { name: "green", durationSeconds: 1 },
      });
      await change({
        type: "candidate.add",
        episodeId,
        shotId,
        id: candidateId,
        assetId: asset.id,
        label: "take",
      });
      await change({
        type: "candidate.select",
        episodeId,
        shotId,
        candidateId,
      });
      await change({
        type: "timeline.save",
        episodeId,
        input: {
          ...emptyTimeline(),
          format: "portrait",
          clips: [
            {
              id: uuid(),
              kind: "image",
              name: "green",
              assetId: asset.id,
              shotId,
              candidateId,
              sourceIn: 0,
              duration: 30,
              volume: 0,
            },
          ],
          captions: [
            { id: uuid(), start: 3, duration: 24, text: "上传到成片" },
          ],
        },
      });
      const body = { episodeId, version: 1, idempotencyKey: uuid() },
        endpoint = `/api/production/${projectId}/render`;
      expect((await api(endpoint, "POST", body, otherCookie)).status).toBe(404);
      expect(
        (
          await api(endpoint, "POST", body, cookie, {
            Origin: "http://untrusted.invalid",
          })
        ).status,
      ).toBe(403);
      const res = await api(endpoint, "POST", body);
      expect(res.status).toBe(200);
      const task = (await res.json()).task;
      expect((await (await api(endpoint, "POST", body)).json()).task.id).toBe(
        task.id,
      );
      const rendered = await done(task.id);
      expect(rendered.mode).toBe("render");
      const filePath = `/api/workspace/assets/${rendered.outputAssetIds[0]}/file`,
        file = await api(filePath);
      expect(file.status).toBe(200);
      expect(file.headers.get("Content-Type")).toBe("video/mp4");
      expect(
        Buffer.from(await file.arrayBuffer())
          .subarray(4, 8)
          .toString(),
      ).toBe("ftyp");
      expect((await api(filePath, "GET", undefined, otherCookie)).status).toBe(
        404,
      );
      const range = await api(filePath, "GET", undefined, cookie, {
        Range: "bytes=0-31",
      });
      expect(range.status).toBe(206);
      expect((await range.arrayBuffer()).byteLength).toBe(32);
      const history = await (
        await api(
          `/api/jobs?mode=media&projectId=${projectId}&episodeId=${episodeId}`,
        )
      ).json();
      expect(history.items.some((j: { id: string }) => j.id === task.id)).toBe(
        true,
      );
    });
    it("authenticates waveform and caption preview, preserving private ownership and style validation", async () => {
      const previewPath = "/api/production/caption-preview";
      const caption = {
        format: "portrait",
        text: "中文字幕\n第二行",
        style: {
          fontSize: 42,
          color: "#ffd84d",
          background: "#000000",
          backgroundOpacity: 0.5,
          position: "top",
          align: "center",
          bold: true,
        },
      };
      expect((await api(previewPath, "POST", caption, "")).status).toBe(401);
      expect(
        (
          await api(previewPath, "POST", caption, cookie, {
            Origin: "https://wrong.invalid",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await api(previewPath, "POST", {
            ...caption,
            style: { ...caption.style, color: "red;unsafe" },
          })
        ).status,
      ).toBe(400);
      const image = await api(previewPath, "POST", caption);
      expect(image.status).toBe(200);
      expect(image.headers.get("Content-Type")).toBe("image/png");
      expect(
        Buffer.from(await image.arrayBuffer())
          .subarray(1, 4)
          .toString(),
      ).toBe("PNG");
      const wav = (
        await promisify(execFile)(
          process.env.FFMPEG_PATH || "ffmpeg",
          [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-f",
            "wav",
            "pipe:1",
          ],
          { encoding: "buffer" },
        )
      ).stdout;
      const upload = await api("/api/workspace/assets", "POST", wav, cookie, {
        "Content-Type": "audio/wav",
        "X-File-Name": "waveform.wav",
      });
      expect(upload.status).toBe(201);
      const id = (await upload.json()).item.id;
      const path = `/api/workspace/assets/${id}/waveform`;
      expect((await api(path, "GET", undefined, "")).status).toBe(401);
      expect((await api(path, "GET", undefined, otherCookie)).status).toBe(404);
      const response = await api(path);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.duration).toBeCloseTo(1, 1);
      expect(data.peaks.length).toBeGreaterThan(40);
      expect(data.peaks.every((p: number) => p >= 0 && p <= 1)).toBe(true);
    });
    it("rejects mismatched media before asset metadata is committed", async () => {
      const before = (await (await api("/api/workspace/assets")).json()).items
        .length;
      expect(
        (
          await api(
            "/api/workspace/assets",
            "POST",
            Buffer.from("<svg>not PNG</svg>"),
          )
        ).status,
      ).toBe(400);
      expect(
        (await (await api("/api/workspace/assets")).json()).items,
      ).toHaveLength(before);
    });
  },
);
