import { validateTimeline, timelineAssetIds } from "./timeline";
import {
  productionSchema,
  productionCommandSchema,
  shotInputSchema,
  type Production,
  type ProductionCommand,
  type ProductionShot,
  type DefinitionRef,
} from "@aivideo/contracts";
export function newProduction(id: string, name: string): Production {
  return productionSchema.parse({
    schemaVersion: 1,
    id,
    name,
    description: "",
    revision: 1,
    updatedAt: new Date().toISOString(),
    definitions: [],
    episodes: [],
  });
}
export function definitionVersion(
  p: Production,
  ref: DefinitionRef,
  kind?: "character" | "scene",
) {
  const definition = p.definitions.find(
    (d) => d.id === ref.id && (!kind || d.kind === kind),
  );
  const version = definition?.versions.find((v) => v.version === ref.version);
  if (!version) throw new Error("设定版本不存在或类型不匹配");
  return version;
}
function validateShot(
  p: Production,
  shot: Pick<ProductionShot, "characters" | "scene">,
) {
  if (new Set(shot.characters.map((r) => r.id)).size !== shot.characters.length)
    throw new Error("角色不能重复");
  shot.characters.forEach((r) => definitionVersion(p, r, "character"));
  if (shot.scene) definitionVersion(p, shot.scene, "scene");
}
export function applyProductionCommand(
  previous: Production,
  raw: ProductionCommand,
  voiceAssetId?: string,
): Production {
  const command = productionCommandSchema.parse(raw),
    p = structuredClone(previous);
  const now = new Date().toISOString();
  const findEpisode = (id: string) => {
    const e = p.episodes.find((e) => e.id === id);
    if (!e) throw new Error("分集不存在");
    return e;
  };
  if (command.type === "project.edit")
    Object.assign(p, { name: command.name, description: command.description });
  else if (command.type === "episode.save") {
    const e = p.episodes.find((e) => e.id === command.id);
    if (e) Object.assign(e, { name: command.name, script: command.script });
    else
      p.episodes.push({
        id: command.id,
        name: command.name,
        script: command.script,
        shots: [],
      });
  } else if (command.type === "episode.delete") {
    if (
      findEpisode(command.episodeId).shots.length ||
      findEpisode(command.episodeId).timeline?.draft.clips.length
    )
      throw new Error("请先删除本集分镜并清空剪辑时间线，再删除分集");
    p.episodes = p.episodes.filter((e) => e.id !== command.episodeId);
  } else if (command.type === "definition.save") {
    let d = p.definitions.find((d) => d.id === command.id);
    if (d && d.kind !== command.kind) throw new Error("不能修改设定类型");
    if (command.kind === "scene" && command.input.voiceId)
      throw new Error("场景不能绑定声音");
    if (!d) {
      d = { id: command.id, kind: command.kind, versions: [] };
      p.definitions.push(d);
    }
    d.versions.push({
      ...command.input,
      assetIds: [...new Set(command.input.assetIds)],
      voiceAssetId,
      version: d.versions.length + 1,
      createdAt: now,
    });
  } else if (command.type === "definition.delete") {
    if (!p.definitions.some((d) => d.id === command.id))
      throw new Error("设定不存在");
    const used = p.episodes
      .flatMap((e) => e.shots)
      .flatMap((s) => [s, ...s.candidates.map((c) => c.basis)])
      .some(
        (s) =>
          s.scene?.id === command.id ||
          s.characters.some((r) => r.id === command.id),
      );
    if (used) throw new Error("设定仍被分镜或候选快照引用");
    p.definitions = p.definitions.filter((d) => d.id !== command.id);
  } else {
    const e = findEpisode(command.episodeId);
    if (command.type === "timeline.save") {
      e.timeline = {
        version: (e.timeline?.version ?? 0) + 1,
        draft: validateTimeline(command.input),
      };
    } else if (command.type === "shot.order") {
      if (
        command.ids.length !== e.shots.length ||
        new Set(command.ids).size !== e.shots.length ||
        command.ids.some((id) => !e.shots.some((s) => s.id === id))
      )
        throw new Error("排序必须包含本集所有分镜且不能重复");
      e.shots = command.ids.map((id) => e.shots.find((s) => s.id === id)!);
    } else if (command.type === "shot.save") {
      validateShot(p, command.input);
      const s = e.shots.find((s) => s.id === command.shotId);
      if (s) {
        // Optional scene must also be cleared when omitted; preserve candidates and selection.
        Object.assign(s, command.input, {
          scene: command.input.scene,
          revision: s.revision + 1,
        });
      } else
        e.shots.push({
          ...command.input,
          id: command.shotId,
          revision: 1,
          candidates: [],
          taskIds: [],
          workflowIds: [],
        });
    } else {
      const s = e.shots.find((s) => s.id === command.shotId);
      if (!s) throw new Error("分镜不存在");
      if (command.type === "shot.delete")
        e.shots = e.shots.filter((s) => s.id !== command.shotId);
      else if (command.type === "candidate.add") {
        if (
          s.candidates.some(
            (c) => c.id === command.id || c.assetId === command.assetId,
          )
        )
          throw new Error("此素材已在本镜头候选中");
        const {
          name,
          description,
          dialogue,
          framing,
          camera,
          durationSeconds,
          characters,
          scene,
        } = s;
        const basis = shotInputSchema.parse({
          name,
          description,
          dialogue,
          framing,
          camera,
          durationSeconds,
          characters,
          scene,
        });
        s.candidates.push({
          id: command.id,
          assetId: command.assetId,
          label: command.label,
          sourceJobId: command.sourceJobId,
          createdAt: now,
          basis: { ...basis, revision: s.revision },
        });
        if (command.sourceJobId && !s.taskIds.includes(command.sourceJobId))
          s.taskIds.push(command.sourceJobId);
      } else if (command.type === "candidate.select") {
        if (
          command.candidateId &&
          !s.candidates.some((c) => c.id === command.candidateId)
        )
          throw new Error("候选不属于当前镜头");
        s.selectedCandidateId = command.candidateId ?? undefined;
      } else if (command.type === "candidate.delete") {
        if (s.selectedCandidateId === command.candidateId)
          throw new Error("请先取消采用或选择其他候选");
        if (!s.candidates.some((c) => c.id === command.candidateId))
          throw new Error("候选不存在");
        s.candidates = s.candidates.filter((c) => c.id !== command.candidateId);
      } else if (command.type === "task.unlink")
        s.taskIds = s.taskIds.filter((id) => id !== command.taskId);
      else if (command.type === "workflow.unlink")
        s.workflowIds = s.workflowIds.filter((id) => id !== command.workflowId);
      else if (
        command.type === "task.link" &&
        !s.taskIds.includes(command.taskId)
      )
        s.taskIds.push(command.taskId);
      else if (
        command.type === "workflow.link" &&
        !s.workflowIds.includes(command.workflowId)
      )
        s.workflowIds.push(command.workflowId);
    }
  }
  p.revision++;
  p.updatedAt = now;
  if (p.episodes.reduce((n, e) => n + e.shots.length, 0) > 500)
    throw new Error("单项目最多 500 个分镜，请拆分项目");
  if (JSON.stringify(p).length > 2_000_000)
    throw new Error("项目已达到当前容量，请拆分项目");
  return productionSchema.parse(p);
}
export function productionReferences(p: Production) {
  const refs = {
    assets: new Set<string>(),
    voices: new Set<string>(),
    workflows: new Set<string>(),
    jobs: new Set<string>(),
  };
  for (const d of p.definitions)
    for (const v of d.versions) {
      v.assetIds.forEach((id) => refs.assets.add(id));
      if (v.voiceId) refs.voices.add(v.voiceId);
      if (v.voiceAssetId) refs.assets.add(v.voiceAssetId);
    }
  for (const e of p.episodes) {
    if (e.timeline)
      timelineAssetIds(e.timeline.draft).forEach((id) => refs.assets.add(id));
    for (const s of e.shots) {
      s.taskIds.forEach((id) => refs.jobs.add(id));
      s.workflowIds.forEach((id) => refs.workflows.add(id));
      for (const c of s.candidates) {
        refs.assets.add(c.assetId);
        if (c.sourceJobId) refs.jobs.add(c.sourceJobId);
      }
    }
  }
  return refs;
}
