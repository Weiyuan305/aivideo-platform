import { beforeAll, afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ServerWorkspace,
  ProductionWorkspace,
  DiskStorage,
} from "../../packages/server/src/index";
import {
  shotInputSchema,
  type Production,
  type ProductionCommand,
} from "../../packages/contracts/src/index";
import { workflowFromImage } from "../../packages/core/src/media-reuse";
import { FixtureProvider } from "./fixture-provider";
const url = process.env.TEST_DATABASE_URL!,
  uuid = () => crypto.randomUUID();
const owner = "production-" + uuid(),
  other = "production-other-" + uuid();
let app: ServerWorkspace, service: ProductionWorkspace, root: string;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
  "base64",
);
const upload = (name = "angle.png", user = owner) =>
  app.upload(user, new File([png], name, { type: "image/png" }));
beforeAll(async () => {
  if (!new URL(url).pathname.startsWith("/aivideo_test"))
    throw new Error("isolated test DB required");
  root = await mkdtemp(join(tmpdir(), "aivideo-production-"));
  app = new ServerWorkspace(url, new DiskStorage(root), new FixtureProvider());
  await app.ensureOwner(owner);
  await app.ensureOwner(other);
  service = new ProductionWorkspace(app);
});
afterAll(async () => {
  await app?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
async function setup() {
  let p = await service.create(owner, uuid(), "上传制作验收 literal_%");
  const episodeId = uuid(),
    shotId = uuid();
  const change = async (command: ProductionCommand) =>
    (p = await service.change(owner, p.id, p.revision, command));
  await change({
    type: "episode.save",
    id: episodeId,
    name: "第一集",
    script: "夜晚相遇",
  });
  await change({
    type: "shot.save",
    episodeId,
    shotId,
    input: shotInputSchema.parse({ name: "相遇" }),
  });
  return {
    get p() {
      return p;
    },
    change,
    episodeId,
    shotId,
  };
}
it("uploads image/video/audio, preserves two episodes and immutable settings, adopts takes, runs an existing workflow and imports its archived output", async () => {
  const x = await setup(),
    secondEpisode = uuid(),
    secondShot = uuid();
  const front = await upload("角色正面.png"),
    side = await upload("角色侧面.png"),
    scene = await upload("场景.png");
  const video = await app.upload(
    owner,
    new File(
      [
        Buffer.from([
          0,
          0,
          0,
          24,
          ...Buffer.from("ftypisom"),
          0,
          0,
          0,
          0,
          ...Buffer.from("isommp42"),
        ]),
      ],
      "镜头.mp4",
      { type: "video/mp4" },
    ),
  );
  const audio = await app.upload(
    owner,
    new File([Buffer.from("RIFF0000WAVEfmt fixture")], "声音.wav", {
      type: "audio/wav",
    }),
  );
  const voice = await app.saveVoice(owner, {
    id: uuid(),
    name: "角色声线",
    assetId: audio.id,
    createdAt: new Date().toISOString(),
  });
  const characterId = uuid(),
    sceneId = uuid();
  const definition: ProductionCommand = {
    type: "definition.save",
    id: characterId,
    kind: "character",
    input: {
      name: "林",
      description: "灰色外套",
      assetIds: [front.id, side.id],
      voiceId: voice.id,
    },
  };
  await x.change(definition);
  await x.change({
    ...definition,
    id: uuid(),
    input: { ...definition.input, name: "陈" },
  });
  await x.change({
    type: "definition.save",
    id: sceneId,
    kind: "scene",
    input: { name: "车站", description: "夜晚", assetIds: [scene.id] },
  });
  await x.change({
    type: "episode.save",
    id: secondEpisode,
    name: "第二集",
    script: "离别",
  });
  await x.change({
    type: "shot.save",
    episodeId: secondEpisode,
    shotId: secondShot,
    input: shotInputSchema.parse({ name: "离别" }),
  });
  const input = shotInputSchema.parse({
    name: "相遇",
    description: "车站两人对视",
    characters: [{ id: characterId, version: 1 }],
    scene: { id: sceneId, version: 1 },
  });
  await x.change({
    type: "shot.save",
    episodeId: x.episodeId,
    shotId: x.shotId,
    input,
  });
  const shot = { episodeId: x.episodeId, shotId: x.shotId },
    a = uuid(),
    b = uuid();
  await x.change({
    type: "candidate.add",
    ...shot,
    id: a,
    assetId: front.id,
    label: "A",
  });
  await x.change({ type: "candidate.select", ...shot, candidateId: a });
  await x.change({
    type: "candidate.add",
    ...shot,
    id: b,
    assetId: side.id,
    label: "B",
  });
  await x.change({ type: "candidate.select", ...shot, candidateId: b });
  await x.change({
    type: "candidate.add",
    ...shot,
    id: uuid(),
    assetId: video.id,
    label: "C 视频",
  });
  await x.change({
    type: "candidate.add",
    episodeId: secondEpisode,
    shotId: secondShot,
    id: uuid(),
    assetId: video.id,
    label: "视频采用",
  });
  await x.change({
    ...definition,
    input: { ...definition.input, description: "黑色外套" },
  });
  expect(x.p.definitions[0].versions[0].voiceAssetId).toBe(audio.id);
  expect(x.p.episodes[0].shots[0].characters[0].version).toBe(1);
  const saved = await app.saveWorkflow(owner, workflowFromImage(side));
  await x.change({ type: "workflow.link", ...shot, workflowId: saved.id });
  const dry = await app.createJob(owner, {
    graph: saved.graph,
    mode: "dry-run",
    workflowVersion: saved.version,
  });
  await x.change({ type: "task.link", ...shot, taskId: dry.id });
  for (let n = 0; n < 4; n++) await app.execute(dry.id);
  expect((await app.getJob(owner, dry.id)).status).toBe("succeeded");
  expect((await app.getJob(owner, dry.id)).outputAssetIds).toEqual([]);
  // Test-only adapter exercises future provider outputs without any model service.
  const task = await app.createJob(owner, {
    graph: saved.graph,
    mode: "provider",
    workflowVersion: saved.version,
  });
  for (let n = 0; n < 4; n++) await app.execute(task.id);
  const finished = await app.getJob(owner, task.id);
  expect(finished.status).toBe("succeeded");
  await x.change({
    type: "candidate.add",
    ...shot,
    id: uuid(),
    assetId: finished.outputAssetIds[0],
    label: "任务归档",
    sourceJobId: task.id,
  });
  const reopened = await new ProductionWorkspace(app).get(owner, x.p.id);
  expect(reopened.episodes).toHaveLength(2);
  expect(reopened.episodes[0].shots[0].selectedCandidateId).toBe(b);
  expect(reopened.episodes[0].shots[0].candidates).toHaveLength(4);
  await x.change({ type: "workflow.unlink", ...shot, workflowId: saved.id });
  expect(
    await app.sql`select * from production_references where project_id=${x.p.id} and resource_kind='workflows'`,
  ).toHaveLength(0);
  expect(
    (await app.listLibrary(owner, "workflows")).some((w) => w.id === saved.id),
  ).toBe(true);
  await x.change({ type: "workflow.link", ...shot, workflowId: saved.id });
  await x.change({ type: "task.unlink", ...shot, taskId: task.id });
  // Candidate provenance still pins its archived source task after unlinking the list entry.
  await expect(app.act(owner, task.id, "delete")).rejects.toMatchObject({
    code: "RESOURCE_IN_USE",
  });
  for (const [kind, id] of [
    ["assets", front.id],
    ["assets", audio.id],
    ["voices", voice.id],
    ["workflows", saved.id],
  ] as const)
    await expect(app.removeResource(owner, kind, id)).rejects.toMatchObject({
      code: "RESOURCE_IN_USE",
    });
  await expect(app.act(owner, task.id, "delete")).rejects.toMatchObject({
    code: "RESOURCE_IN_USE",
  });
  await expect(service.remove(owner, x.p.id, 1)).rejects.toMatchObject({
    code: "REVISION_CONFLICT",
  });
  await service.remove(owner, x.p.id, x.p.revision);
  expect(
    (await app.listAssets(owner)).some((asset) => asset.id === side.id),
  ).toBe(true);
  expect(
    (await app.listLibrary(owner, "workflows")).some((w) => w.id === saved.id),
  ).toBe(true);
  expect((await app.getJob(owner, task.id)).status).toBe("succeeded");
  expect(
    await app.sql`select * from production_references where project_id=${x.p.id}`,
  ).toHaveLength(0);
});
it("enforces ownership, asset type, result provenance and stale revision without partial mutations", async () => {
  const x = await setup(),
    foreign = await upload("foreign.png", other),
    own = await upload(),
    shot = { episodeId: x.episodeId, shotId: x.shotId };
  await expect(service.get(other, x.p.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    service.remove(other, x.p.id, x.p.revision),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    x.change({
      type: "candidate.add",
      ...shot,
      id: uuid(),
      assetId: foreign.id,
      label: "其他账号素材",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  const audio = await app.upload(
    owner,
    new File([Buffer.from("RIFF0000WAVEfmt fixture")], "audio.wav", {
      type: "audio/wav",
    }),
  );
  await expect(
    x.change({
      type: "candidate.add",
      ...shot,
      id: uuid(),
      assetId: audio.id,
      label: "错误格式",
    }),
  ).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  const task = await app.createJob(owner, {
    request: {
      modelKey: "image.flux2.t2i.v1",
      prompt: "test",
      assetIds: [],
      parameters: {},
    },
  });
  await expect(
    x.change({
      type: "candidate.add",
      ...shot,
      id: uuid(),
      assetId: own.id,
      label: "伪造输出",
      sourceJobId: task.id,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  expect((await service.get(owner, x.p.id)).revision).toBe(x.p.revision);
  const attempts = await Promise.allSettled(
    ["窗口一", "窗口二"].map((name) =>
      service.change(owner, x.p.id, x.p.revision, {
        type: "project.edit",
        name,
        description: "",
      }),
    ),
  );
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  expect(
    (attempts.find((a) => a.status === "rejected") as PromiseRejectedResult)
      .reason.code,
  ).toBe("REVISION_CONFLICT");
});
it("serializes concurrent reference creation and deletion so an asset can never be dangling", async () => {
  const x = await setup(),
    image = await upload();
  const outcomes = await Promise.allSettled([
    x.change({
      type: "candidate.add",
      episodeId: x.episodeId,
      shotId: x.shotId,
      id: uuid(),
      assetId: image.id,
      label: "并发",
    }),
    app.removeResource(owner, "assets", image.id),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const persisted = await service.get(owner, x.p.id);
  if (persisted.episodes[0].shots[0].candidates.length) {
    expect((await app.listAssets(owner)).some((a) => a.id === image.id)).toBe(
      true,
    );
    expect((outcomes[1] as PromiseRejectedResult).reason.code).toBe(
      "RESOURCE_IN_USE",
    );
  } else
    expect((outcomes[0] as PromiseRejectedResult).reason.code).toBe(
      "INVALID_REFERENCE",
    );
});
it("paginates project search and isolates accounts with literal wildcard matching", async () => {
  const marker = uuid();
  for (let n = 0; n < 23; n++)
    await service.create(owner, uuid(), marker + " literal_% " + n);
  const first = await service.list(owner, marker + " literal_%"),
    second = await service.list(owner, marker, 20);
  expect(first.total).toBe(23);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map((p) => p.id)).size).toBe(
    23,
  );
  expect((await service.list(other, marker)).total).toBe(0);
});
