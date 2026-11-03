import { validateTimeline } from "@aivideo/core/timeline";
import type { ServerWorkspace } from "./service";
import { ServiceError } from "./types";
import {
  productionCommandSchema,
  type Production,
  type ProductionSummary,
  type ProductionCommand,
} from "@aivideo/contracts";
import {
  newProduction,
  applyProductionCommand,
  productionReferences,
} from "@aivideo/core/production";
export class ProductionWorkspace {
  constructor(private app: ServerWorkspace) {}
  async list(owner: string, q = "", offset = 0) {
    const escaped = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = await this.app
      .sql`select payload from productions where owner_user_id=${owner} and name ilike ${escaped} order by updated_at desc,id limit 20 offset ${offset}`;
    const [count] = await this.app
      .sql`select count(*)::int as total from productions where owner_user_id=${owner} and name ilike ${escaped}`;
    return {
      items: rows.map((row): ProductionSummary => {
        const p = row.payload as Production;
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          revision: p.revision,
          updatedAt: p.updatedAt,
          episodes: p.episodes.length,
          shots: p.episodes.flatMap((e) => e.shots).length,
          selected: p.episodes
            .flatMap((e) => e.shots)
            .filter((s) => s.selectedCandidateId).length,
        };
      }),
      total: count.total as number,
    };
  }
  async create(owner: string, id: string, name: string) {
    const p = newProduction(id, name);
    await this.app
      .sql`insert into productions(id,owner_user_id,name,payload) values(${id},${owner},${p.name},${this.app.sql.json(p as never)}) on conflict(id) do nothing`;
    const existing = await this.get(owner, id);
    if (existing.name !== p.name)
      throw new ServiceError("CONFLICT", "项目标识已被使用", 409);
    return existing;
  }
  async get(owner: string, id: string): Promise<Production> {
    const [row] = await this.app
      .sql`select payload from productions where id=${id} and owner_user_id=${owner}`;
    if (!row) throw new ServiceError("NOT_FOUND", "项目不存在", 404);
    return row.payload;
  }
  async change(
    owner: string,
    id: string,
    revision: number,
    raw: ProductionCommand,
  ) {
    const command = productionCommandSchema.parse(raw);
    return this.app.sql.begin(async (tx) => {
      const [row] =
        await tx`select payload from productions where id=${id} and owner_user_id=${owner} for update`;
      if (!row) throw new ServiceError("NOT_FOUND", "项目不存在", 404);
      const p = row.payload as Production;
      if (p.revision !== revision)
        throw new ServiceError(
          "REVISION_CONFLICT",
          "项目已在其他页面更新，请刷新后重新编辑；本次修改未覆盖已有内容",
          409,
        );
      let voiceAssetId: string | undefined;
      if (command.type === "definition.save" && command.input.voiceId) {
        const [voice] =
          await tx`select reference_asset_id from voices where id=${command.input.voiceId} and owner_user_id=${owner} for share`;
        if (!voice)
          throw new ServiceError("INVALID_REFERENCE", "声音不存在或无权使用");
        voiceAssetId = voice.reference_asset_id;
      }
      let next: Production;
      try {
        next = applyProductionCommand(p, command, voiceAssetId);
      } catch (error) {
        throw new ServiceError(
          "INVALID_PRODUCTION",
          error instanceof Error ? error.message : "项目更新失败",
        );
      }
      const refs = productionReferences(next);
      // Lock in the same order as generation submission: voices, assets, workflows, jobs.
      const resourceRows: Record<
        string,
        {
          id: string;
          kind?: string;
          payload?: import("@aivideo/contracts").LocalTask;
        }[]
      > = {};
      for (const table of ["voices", "assets", "workflows", "jobs"] as const) {
        const ids = [...refs[table]].sort();
        const rows =
          await tx`select * from ${tx(table)} where owner_user_id=${owner} and id=any(${tx.array(ids)}::uuid[]) order by id for share`;
        if (rows.length !== ids.length)
          throw new ServiceError(
            "INVALID_REFERENCE",
            "引用的素材、声音、任务或工作流不存在或无权使用",
          );
        resourceRows[table] = rows as never;
      }
      if (
        command.type === "definition.save" &&
        command.input.assetIds.some(
          (id) =>
            resourceRows.assets.find((a) => a.id === id)?.kind !== "image",
        )
      )
        throw new ServiceError("INVALID_REFERENCE", "角色和场景参考必须是图片");
      if (command.type === "timeline.save") {
        for (const item of [...command.input.clips, ...command.input.audio]) {
          const kind = "kind" in item ? item.kind : "audio";
          if (
            resourceRows.assets.find((a) => a.id === item.assetId)?.kind !==
            kind
          )
            throw new ServiceError(
              "INVALID_REFERENCE",
              "剪辑素材类型不匹配或无权使用",
            );
        }
      }
      if (command.type === "candidate.add") {
        const asset = resourceRows.assets.find(
          (a) => a.id === command.assetId,
        )!;
        if (!["image", "video"].includes(asset.kind!))
          throw new ServiceError(
            "INVALID_REFERENCE",
            "镜头候选仅支持图片或视频",
          );
        if (command.sourceJobId) {
          const task = resourceRows.jobs.find(
            (j) => j.id === command.sourceJobId,
          )?.payload;
          if (!task?.outputAssetIds.includes(command.assetId))
            throw new ServiceError(
              "INVALID_REFERENCE",
              "此素材不是所选任务的归档输出",
            );
        }
      }
      await tx`delete from production_references where project_id=${id}`;
      const items = Object.entries(refs).flatMap(([kind, ids]) =>
        [...ids].map((resource_id) => ({
          project_id: id,
          resource_kind: kind,
          resource_id,
        })),
      );
      if (items.length)
        await tx`insert into production_references ${tx(items, "project_id", "resource_kind", "resource_id")}`;
      await tx`update productions set name=${next.name},payload=${tx.json(next as never)},updated_at=now() where id=${id}`;
      return next;
    });
  }
  async render(
    owner: string,
    id: string,
    episodeId: string,
    version: number,
    key: string,
  ) {
    const p = await this.get(owner, id),
      e = p.episodes.find((e) => e.id === episodeId);
    if (!e?.timeline || e.timeline.version !== version)
      throw new ServiceError(
        "VERSION_MISMATCH",
        "剪辑版本已改变，请刷新并保存后再合成",
        409,
      );
    try {
      validateTimeline(e.timeline.draft, true);
    } catch (error) {
      throw new ServiceError(
        "INVALID_TIMELINE",
        error instanceof Error ? error.message : "剪辑参数无效",
      );
    }
    return this.app.createJob(
      owner,
      {
        render: {
          projectId: id,
          episodeId,
          projectName: p.name,
          episodeName: e.name,
          version,
          timeline: e.timeline.draft,
        },
      },
      key,
    );
  }
  async remove(owner: string, id: string, revision: number) {
    return this.app.sql.begin(async (tx) => {
      const [row] =
        await tx`select payload from productions where id=${id} and owner_user_id=${owner} for update`;
      if (!row) throw new ServiceError("NOT_FOUND", "项目不存在", 404);
      if (row.payload.revision !== revision)
        throw new ServiceError(
          "REVISION_CONFLICT",
          "项目已更新，请刷新后再删除",
          409,
        );
      await tx`delete from productions where id=${id} and owner_user_id=${owner}`;
    });
  }
}
