import { expect, it } from "vitest";
import {
  newProduction,
  applyProductionCommand,
  productionReferences,
} from "../packages/core/src/production";
import {
  shotInputSchema,
  type ProductionCommand,
} from "../packages/contracts/src/index";
const uuid = () => crypto.randomUUID();
function setup() {
  let p = newProduction(uuid(), "末班地铁");
  const episodeId = uuid(),
    shotId = uuid(),
    character = uuid(),
    scene = uuid(),
    image = uuid();
  const apply = (c: ProductionCommand, voiceAssetId?: string) =>
    (p = applyProductionCommand(p, c, voiceAssetId));
  apply({
    type: "episode.save",
    id: episodeId,
    name: "第一集",
    script: "相遇",
  });
  apply({
    type: "definition.save",
    id: character,
    kind: "character",
    input: { name: "林", description: "灰色外套", assetIds: [image] },
  });
  apply({
    type: "definition.save",
    id: scene,
    kind: "scene",
    input: { name: "地铁", description: "空车厢", assetIds: [] },
  });
  const input = shotInputSchema.parse({
    name: "相遇",
    characters: [{ id: character, version: 1 }],
    scene: { id: scene, version: 1 },
  });
  apply({ type: "shot.save", episodeId, shotId, input });
  return {
    get p() {
      return p;
    },
    apply,
    episodeId,
    shotId,
    character,
    scene,
    image,
    input,
    get shot() {
      return p.episodes[0].shots[0];
    },
  };
}
it("freezes setting versions and candidate basis; editing and adding never replaces the adopted take", () => {
  const x = setup(),
    candidateId = uuid(),
    oldProject = structuredClone(x.p);
  x.apply({
    type: "candidate.add",
    episodeId: x.episodeId,
    shotId: x.shotId,
    id: candidateId,
    assetId: x.image,
    label: "A",
  });
  x.apply({
    type: "candidate.select",
    episodeId: x.episodeId,
    shotId: x.shotId,
    candidateId,
  });
  x.apply({
    type: "definition.save",
    id: x.character,
    kind: "character",
    input: { name: "林", description: "黑色外套", assetIds: [] },
  });
  expect(x.shot.characters[0].version).toBe(1);
  x.apply({
    type: "shot.save",
    episodeId: x.episodeId,
    shotId: x.shotId,
    input: {
      ...x.input,
      scene: undefined,
      characters: [{ id: x.character, version: 2 }],
      description: "新的镜头",
    },
  });
  x.apply({
    type: "candidate.add",
    episodeId: x.episodeId,
    shotId: x.shotId,
    id: uuid(),
    assetId: uuid(),
    label: "B",
  });
  expect(x.shot.scene).toBeUndefined();
  expect(x.shot.selectedCandidateId).toBe(candidateId);
  expect(x.shot.candidates[0].basis).toEqual({ ...x.input, revision: 1 });
  expect(x.p.definitions[0].versions[0].description).toBe("灰色外套");
  expect(oldProject.episodes[0].shots[0].revision).toBe(1);
});
it("validates fixed references, complete reorder, and adoption membership", () => {
  const x = setup();
  expect(() =>
    x.apply({
      type: "shot.save",
      episodeId: x.episodeId,
      shotId: x.shotId,
      input: { ...x.input, characters: [{ id: x.scene, version: 1 }] },
    }),
  ).toThrow("类型");
  expect(() =>
    x.apply({
      type: "shot.save",
      episodeId: x.episodeId,
      shotId: x.shotId,
      input: { ...x.input, scene: { id: x.scene, version: 2 } },
    }),
  ).toThrow("版本");
  expect(() =>
    x.apply({ type: "shot.order", episodeId: x.episodeId, ids: [] }),
  ).toThrow("排序");
  expect(() =>
    x.apply({
      type: "candidate.select",
      episodeId: x.episodeId,
      shotId: x.shotId,
      candidateId: uuid(),
    }),
  ).toThrow("不属于");
  const second = uuid();
  x.apply({
    type: "shot.save",
    episodeId: x.episodeId,
    shotId: second,
    input: { ...x.input, name: "反打" },
  });
  expect(() =>
    x.apply({
      type: "shot.order",
      episodeId: x.episodeId,
      ids: [second, second],
    }),
  ).toThrow("排序");
  x.apply({
    type: "shot.order",
    episodeId: x.episodeId,
    ids: [second, x.shotId],
  });
  expect(x.shot.id).toBe(second);
});
it("protects selected candidates and historical definition references without deleting underlying assets", () => {
  const x = setup(),
    id = uuid(),
    shot = { episodeId: x.episodeId, shotId: x.shotId };
  x.apply({
    type: "candidate.add",
    ...shot,
    id,
    assetId: x.image,
    label: "采用",
  });
  expect(() =>
    x.apply({
      type: "candidate.add",
      ...shot,
      id: uuid(),
      assetId: x.image,
      label: "重复",
    }),
  ).toThrow("已在");
  x.apply({ type: "candidate.select", ...shot, candidateId: id });
  expect(() =>
    x.apply({ type: "candidate.delete", ...shot, candidateId: id }),
  ).toThrow("取消采用");
  x.apply({
    type: "shot.save",
    ...shot,
    input: { ...x.input, characters: [], scene: undefined },
  });
  expect(() => x.apply({ type: "definition.delete", id: x.character })).toThrow(
    "快照引用",
  );
  expect(() =>
    x.apply({ type: "episode.delete", episodeId: x.episodeId }),
  ).toThrow("先删除");
  expect(productionReferences(x.p).assets.has(x.image)).toBe(true);
  x.apply({ type: "candidate.select", ...shot, candidateId: null });
  x.apply({ type: "candidate.delete", ...shot, candidateId: id });
  x.apply({ type: "definition.delete", id: x.character });
  expect(productionReferences(x.p).assets.has(x.image)).toBe(false);
});
it("keeps the reference audio pinned to each character version", () => {
  const x = setup(),
    voiceId = uuid(),
    oldAudio = uuid(),
    newAudio = uuid();
  const command: ProductionCommand = {
    type: "definition.save",
    id: x.character,
    kind: "character",
    input: { name: "林", description: "", assetIds: [], voiceId },
  };
  x.apply(command, oldAudio);
  x.apply(command, newAudio);
  expect([...productionReferences(x.p).assets]).toEqual(
    expect.arrayContaining([x.image, oldAudio, newAudio]),
  );
  expect(x.p.definitions[0].versions[1].voiceAssetId).toBe(oldAudio);
});
it("unlinks reusable jobs and workflows without dropping candidate provenance", () => {
  const x = setup(),
    taskId = uuid(),
    workflowId = uuid(),
    shot = { episodeId: x.episodeId, shotId: x.shotId };
  x.apply({ type: "workflow.link", ...shot, workflowId });
  x.apply({ type: "task.link", ...shot, taskId });
  x.apply({
    type: "candidate.add",
    ...shot,
    id: uuid(),
    assetId: uuid(),
    sourceJobId: taskId,
    label: "已归档输出",
  });
  x.apply({ type: "workflow.unlink", ...shot, workflowId });
  x.apply({ type: "task.unlink", ...shot, taskId });
  expect(x.shot.workflowIds).toEqual([]);
  expect(x.shot.taskIds).toEqual([]);
  expect(productionReferences(x.p).workflows.size).toBe(0);
  expect(productionReferences(x.p).jobs.has(taskId)).toBe(true);
});
