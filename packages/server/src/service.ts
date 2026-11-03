import { withRenderedMovie } from "./render";
import { createReadStream } from "node:fs";
import type { RenderSnapshot, Production } from "@aivideo/contracts";
import postgres from "postgres";
import { queryJobs, queryAssets } from "./listing";
import { createHash, randomUUID } from "node:crypto";
import {
  generationRequestSchema,
  timelineSchema,
  workflowSchema,
  modelCatalog,
  type GenerationRequest,
  type LocalTask,
  type WorkflowGraph,
  type LocalVoice,
  type LocalWorkflow,
} from "@aivideo/contracts";
import {
  createTask,
  retryTaskSnapshot,
  referencesForTask,
  transitionTask,
} from "@aivideo/core/tasks";
import {
  checkRun,
  performWorkflowStep,
  type ExecutionResult,
} from "@aivideo/core/execution";
import { validateFile, kindForMime } from "@aivideo/core/local";
import {
  maxBytes,
  checkedMedia,
  webChunks,
  boundedSource,
  type ObjectStorage,
} from "./storage";
import {
  ServiceError,
  ProviderRejected,
  ProviderUncertain,
  disabledProvider,
  type ProviderAdapter,
  type StoredAsset,
  type Artifact,
  terminal,
} from "./types";
type Creation =
  | { request: GenerationRequest }
  | { render: RenderSnapshot }
  | {
      graph: WorkflowGraph;
      mode: "provider" | "dry-run";
      workflowVersion?: number;
    };
type Operation = {
  key: string;
  state: string;
  request_id: string | null;
  outputs: Artifact[] | null;
  asset_ids: string[];
  provider: string;
  outcome?: import("./types").ProviderState;
};
export class ServerWorkspace {
  readonly sql: ReturnType<typeof postgres>;
  constructor(
    url: string,
    public storage: ObjectStorage,
    public provider: ProviderAdapter = disabledProvider,
  ) {
    this.sql = postgres(url, {
      max: 5,
      connect_timeout: 3,
      prepare: false,
      connection: { statement_timeout: 15000 },
    });
  }
  async close() {
    await this.sql.end();
  }
  async ensureOwner(id: string) {
    await this
      .sql`insert into "user" (id,name,email) values (${id},${id},${id + "@local.invalid"}) on conflict (id) do nothing`;
  }
  async getJob(owner: string, id: string) {
    const [row] = await this
      .sql`select payload from jobs where id=${id} and owner_user_id=${owner}`;
    if (!row) throw new ServiceError("NOT_FOUND", "任务不存在", 404);
    return row.payload as LocalTask;
  }
  async listJobs(owner: string) {
    return (await this.listJobPage(owner, { limit: 500 })).items;
  }
  listJobPage(owner: string, query: unknown = {}) {
    return queryJobs(this.sql, owner, query);
  }
  listAssetPage(owner: string, query: unknown = {}) {
    return queryAssets(this.sql, owner, query);
  }
  private async mutate(id: string, update: (t: LocalTask) => LocalTask) {
    return this.sql.begin(async (tx) => {
      const [row] =
        await tx`select payload from jobs where id=${id} for update`;
      if (!row) throw new ServiceError("NOT_FOUND", "任务不存在", 404);
      const prev = row.payload as LocalTask;
      const changed = update(prev);
      if (changed === prev) return prev;
      const next = {
        ...changed,
        revision: prev.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await tx`update jobs set payload=${tx.json(next as never)},status=${next.status},updated_at=now() where id=${id}`;
      return next;
    });
  }
  async createJob(
    owner: string,
    input: Creation,
    key: string = randomUUID(),
    attempt?: { groupId: string; attempt: number },
  ) {
    const task = {
      ...createTask(input, key),
      backend: "server" as const,
      ...attempt,
    };
    if (
      task.workflowVersion !== undefined &&
      (!Number.isSafeInteger(task.workflowVersion) || task.workflowVersion < 1)
    )
      throw new ServiceError("INVALID_VERSION", "工作流版本无效");
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          task.request,
          task.graph,
          task.mode,
          task.workflowVersion,
          ...(task.render ? [task.render] : []),
        ]),
      )
      .digest("hex");
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${owner + ":" + key},0))`;
      const [existing] =
        await tx`select fingerprint,payload from jobs where owner_user_id=${owner} and idempotency_key=${key}`;
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new ServiceError(
            "IDEMPOTENCY_CONFLICT",
            "幂等键对应了不同请求",
            409,
          );
        return existing.payload as LocalTask;
      }
      if (task.render && !attempt) {
        const [saved] =
          await tx`select payload from productions where id=${task.render.projectId} and owner_user_id=${owner} for share`;
        const episode = (
          saved?.payload as Production | undefined
        )?.episodes.find((e) => e.id === task.render!.episodeId);
        if (
          !episode?.timeline ||
          episode.timeline.version !== task.render.version ||
          JSON.stringify(timelineSchema.parse(episode.timeline.draft)) !==
            JSON.stringify(task.render.timeline)
        )
          throw new ServiceError(
            "VERSION_MISMATCH",
            "剪辑版本已改变，请刷新并保存后再合成",
            409,
          );
      }
      const refs = referencesForTask(task);
      const voices =
        await tx`select id,reference_asset_id as "assetId" from voices where owner_user_id=${owner} and id=any(${tx.array([...refs.voiceIds])}::uuid[]) for share`;
      const ids = [
        ...new Set([...refs.assetIds, ...voices.map((v) => v.assetId)]),
      ];
      const assets =
        await tx`select id,kind from assets where owner_user_id=${owner} and id=any(${tx.array(ids)}::uuid[]) for share`;
      if (task.graph) {
        if (task.workflowVersion !== undefined && !attempt) {
          const [saved] =
            await tx`select history from workflows where id=${task.graph.id} and owner_user_id=${owner} for share`;
          const version = saved?.history?.find(
            (h: { version: number }) => h.version === task.workflowVersion,
          );
          if (
            !version ||
            JSON.stringify(workflowSchema.parse(version.graph)) !==
              JSON.stringify(task.graph)
          )
            throw new ServiceError(
              "VERSION_MISMATCH",
              "快照与保存版本不一致，请保存新版本或以草稿运行",
              409,
            );
        }
        try {
          checkRun(task, { assets: assets as never, voices: voices as never });
        } catch (e) {
          throw new ServiceError(
            "INVALID_GRAPH",
            e instanceof Error ? e.message : "工作流校验失败",
          );
        }
      } else if (task.render) {
        for (const clip of [
          ...task.render.timeline.clips,
          ...task.render.timeline.audio,
        ]) {
          if (
            !assets.some(
              (a) =>
                a.id === clip.assetId &&
                a.kind === ("kind" in clip ? clip.kind : "audio"),
            )
          )
            throw new ServiceError(
              "INVALID_REFERENCE",
              "合成素材不存在、类型不符或无权使用",
            );
        }
      } else {
        const model = modelCatalog.find(
          (m) => m.key === task.request!.modelKey,
        )!;
        for (const id of task.request!.assetIds)
          if (
            !assets.some(
              (a) =>
                a.id === id &&
                a.kind === (model.kind === "voice" ? "audio" : "image"),
            )
          )
            throw new ServiceError(
              "INVALID_REFERENCE",
              "参考素材不存在或无权使用",
            );
        if (
          task.request!.voiceId &&
          !voices.some(
            (v) =>
              v.id === task.request!.voiceId &&
              assets.some((a) => a.id === v.assetId && a.kind === "audio"),
          )
        )
          throw new ServiceError(
            "INVALID_REFERENCE",
            "参考声音不存在或无权使用",
          );
      }
      await tx`insert into jobs(id,owner_user_id,idempotency_key,fingerprint,status,payload,created_at) values(${task.id},${owner},${key},${fingerprint},${task.status},${tx.json(task as never)},${task.createdAt})`;
      await tx`insert into job_outbox(job_id) values(${task.id})`;
      return task;
    });
  }
  async pendingDispatches() {
    const rows = await this
      .sql`select id,job_id as "jobId" from job_outbox where delivered=false order by created_at limit 50`;
    return rows as unknown as { id: string; jobId: string }[];
  }
  async dispatched(id: string) {
    await this.sql`update job_outbox set delivered=true where id=${id}`;
  }
  async act(
    owner: string,
    id: string,
    action: string,
    actionKey: string = randomUUID(),
  ) {
    await this.getJob(owner, id);
    if (action === "delete") {
      return this.sql.begin(async (tx) => {
        const [row] =
          await tx`select payload from jobs where id=${id} and owner_user_id=${owner} for update`;
        if (!row) throw new ServiceError("NOT_FOUND", "任务不存在", 404);
        const used =
          await tx`select project_id from production_references where resource_kind='jobs' and resource_id=${id} limit 1`;
        if (used.length)
          throw new ServiceError(
            "RESOURCE_IN_USE",
            "任务仍被短剧项目引用",
            409,
          );
        const task = row.payload as LocalTask;
        if (!["succeeded", "failed", "cancelled"].includes(task.status))
          throw new ServiceError("ACTIVE_TASK", "请先取消或核对任务", 409);
        await tx`delete from job_outbox where job_id=${id}`;
        await tx`delete from provider_operations where job_id=${id}`;
        await tx`delete from jobs where id=${id}`;
        return task;
      });
    }
    if (action === "retry") {
      const previous = await this.getJob(owner, id);
      if (previous.status === "unknown")
        throw new ServiceError("RECONCILE_REQUIRED", "请先核对提交结果", 409);
      try {
        retryTaskSnapshot(previous);
      } catch (e) {
        // Validate whether creating a fresh attempt is safe.
        throw new ServiceError(
          "INVALID_STATE",
          e instanceof Error ? e.message : "此状态不能重试",
          409,
        );
      }
      return this.createJob(
        owner,
        previous.render
          ? { render: previous.render }
          : previous.graph
            ? {
                graph: previous.graph,
                mode: previous.mode === "dry-run" ? "dry-run" : "provider",
                workflowVersion: previous.workflowVersion,
              }
            : { request: previous.request! },
        `retry:${id}:${actionKey}`,
        { groupId: previous.groupId, attempt: previous.attempt + 1 },
      );
    }
    return this.sql.begin(async (tx) => {
      const [row] =
        await tx`select payload from jobs where id=${id} and owner_user_id=${owner} for update`;
      if (!row) throw new ServiceError("NOT_FOUND", "任务不存在", 404);
      const t = row.payload as LocalTask;
      let next: LocalTask;
      if (action === "cancel") {
        if (["cancel_requested", "cancelled"].includes(t.status)) return t;
        if (
          ![
            "queued",
            "running",
            "blocked",
            "interrupted",
            "archiving",
            "archive_failed",
            "reconciling",
          ].includes(t.status)
        )
          throw new ServiceError("INVALID_STATE", "此状态不能申请取消", 409);
        const [operation] =
          await tx`select key from provider_operations where job_id=${id} limit 1`;
        const rendering =
          t.mode === "render" && ["running", "archiving"].includes(t.status);
        next = {
          ...t,
          status: operation || rendering ? "cancel_requested" : "cancelled",
          events: [
            ...t.events,
            {
              at: new Date().toISOString(),
              status:
                operation || rendering
                  ? ("cancel_requested" as const)
                  : ("cancelled" as const),
              message:
                t.mode === "render"
                  ? rendering
                    ? "已申请停止合成，等待 worker 清理临时文件"
                    : "已取消合成"
                  : operation
                    ? "已申请取消，等待供应商确认；任务仍可能完成"
                    : "已取消，未向模型提交",
            },
          ],
        };
      } else if (action === "retry-archive") {
        if (t.status !== "archive_failed")
          throw new ServiceError(
            "INVALID_STATE",
            "只能重试归档失败的任务",
            409,
          );
        next = {
          ...t,
          status: "queued",
          error: undefined,
          events: [
            ...t.events,
            {
              at: new Date().toISOString(),
              status: "queued" as const,
              message:
                t.mode === "render"
                  ? "重新合成冻结版本并重试归档"
                  : "重试归档，复用供应商已有输出",
            },
          ],
        };
      } else if (action === "resume") {
        if (t.mode !== "dry-run" || t.status !== "interrupted")
          throw new ServiceError("INVALID_STATE", "只能继续中断的试运行", 409);
        next = { ...t, status: "queued", error: undefined };
      } else if (action === "reconcile") {
        if (t.status !== "unknown")
          throw new ServiceError("INVALID_STATE", "此任务无需核对", 409);
        next = {
          ...t,
          status: "reconciling",
          error: undefined,
          events: [
            ...t.events,
            {
              at: new Date().toISOString(),
              status: "reconciling" as const,
              message: "核对已保存的供应商请求；不会重新提交生成",
            },
          ],
        };
      } else throw new ServiceError("INVALID_ACTION", "不支持的操作");
      next = {
        ...next,
        revision: t.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await tx`update jobs set payload=${tx.json(next as never)},status=${next.status},updated_at=now() where id=${id}`;
      if (next.status !== "cancelled")
        await tx`insert into job_outbox(job_id) values(${id})`;
      return next;
    });
  }
  async getAsset(owner: string, id: string): Promise<StoredAsset> {
    const [row] = await this
      .sql`select id,owner_user_id as "ownerId",name,kind,mime,bytes,object_key as "objectKey",sha256,created_at as "createdAt",source_job_id as "sourceJobId",exists(select 1 from jobs where jobs.id=assets.source_job_id and jobs.owner_user_id=assets.owner_user_id) as "sourceJobAvailable" from assets where id=${id} and owner_user_id=${owner}`;
    if (!row) throw new ServiceError("NOT_FOUND", "素材不存在", 404);
    return {
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
    } as StoredAsset;
  }
  async listAssets(owner: string) {
    return (await this.listAssetPage(owner, { limit: 500 })).items;
  }
  async upload(owner: string, file: File) {
    validateFile(file);
    return this.uploadStream(
      owner,
      file.name,
      file.type,
      webChunks(file.stream()),
    );
  }
  async uploadStream(
    owner: string,
    name: string,
    mime: string,
    source: AsyncIterable<Uint8Array>,
  ) {
    const kind = kindForMime(mime),
      id = randomUUID(),
      key = `inputs/${id}`;
    if (!name.trim() || name.length > 200)
      throw new ServiceError("INVALID_NAME", "文件名称无效");
    const result = await this.storage.put(
      key,
      checkedMedia(source, mime),
      maxBytes(kind),
    );
    try {
      await this
        .sql`insert into assets(id,owner_user_id,name,kind,mime,bytes,object_key,sha256) values(${id},${owner},${name},${kind},${mime},${result.bytes},${key},${result.sha256})`;
      return this.getAsset(owner, id);
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
  }
  async listLibrary(owner: string, name: "voices" | "workflows") {
    if (name === "voices") {
      const rows = await this
        .sql`select id,name,reference_asset_id as "assetId",created_at as "createdAt" from voices where owner_user_id=${owner} order by created_at desc`;
      return rows.map((r) => ({
        ...r,
        createdAt: new Date(r.createdAt).toISOString(),
      })) as LocalVoice[];
    }
    const rows = await this
      .sql`select id,name,graph,version,history,updated_at as "updatedAt" from workflows where owner_user_id=${owner} order by updated_at desc`;
    return rows.map((r) => ({
      ...r,
      updatedAt: new Date(r.updatedAt).toISOString(),
    })) as LocalWorkflow[];
  }
  async saveVoice(owner: string, voice: LocalVoice) {
    if (!voice.name.trim() || voice.name.length > 100)
      throw new ServiceError("INVALID_NAME", "声音名称无效");
    return this.sql.begin(async (tx) => {
      const [asset] =
        await tx`select id from assets where id=${voice.assetId} and owner_user_id=${owner} and kind='audio' for share`;
      if (!asset) throw new ServiceError("INVALID_REFERENCE", "参考录音不存在");
      const [existing] =
        await tx`select owner_user_id from voices where id=${voice.id} for update`;
      if (existing && existing.owner_user_id !== owner)
        throw new ServiceError("NOT_FOUND", "声音不存在", 404);
      const saved =
        await tx`insert into voices(id,owner_user_id,name,reference_asset_id) values(${voice.id},${owner},${voice.name.trim()},${voice.assetId}) on conflict(id) do update set name=excluded.name,reference_asset_id=excluded.reference_asset_id where voices.owner_user_id=${owner} returning id`;
      if (!saved.length) throw new ServiceError("NOT_FOUND", "声音不存在", 404);
      return voice;
    });
  }
  async saveWorkflow(owner: string, raw: WorkflowGraph) {
    const graph = workflowSchema.parse(raw);
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${graph.id},0))`;
      const [prev] =
        await tx`select owner_user_id,version,history from workflows where id=${graph.id} for update`;
      if (prev && prev.owner_user_id !== owner)
        throw new ServiceError("NOT_FOUND", "工作流不存在", 404);
      const version = (prev?.version ?? 0) + 1,
        updatedAt = new Date().toISOString(),
        history = [
          ...(prev?.history ?? []),
          { version, graph, savedAt: updatedAt },
        ];
      await tx`insert into workflows(id,owner_user_id,name,graph,version,history) values(${graph.id},${owner},${graph.name},${tx.json(graph as never)},${version},${tx.json(history)}) on conflict(id) do update set name=excluded.name,graph=excluded.graph,version=excluded.version,history=excluded.history,updated_at=now()`;
      return {
        id: graph.id,
        name: graph.name,
        graph,
        version,
        updatedAt,
        history,
      };
    });
  }
  async removeResource(
    owner: string,
    name: "assets" | "voices" | "workflows",
    id: string,
  ) {
    return this.sql
      .begin(async (tx) => {
        const [row] =
          await tx`select * from ${tx(name)} where id=${id} and owner_user_id=${owner} for update`;
        if (!row) throw new ServiceError("NOT_FOUND", "资源不存在", 404);
        const used =
          await tx`select project_id from production_references where resource_kind=${name} and resource_id=${id} limit 1`;
        if (used.length)
          throw new ServiceError(
            "RESOURCE_IN_USE",
            "资源仍被短剧项目、设定版本或镜头候选引用",
            409,
          );
        const tasks =
          await tx`select payload from jobs where owner_user_id=${owner}`;
        const workflows =
          await tx`select graph,history from workflows where owner_user_id=${owner}`;
        const nodes = workflows
          .flatMap((w) => [
            w.graph,
            ...(w.history ?? []).map((h: { graph: WorkflowGraph }) => h.graph),
          ])
          .flatMap((g) => g.nodes);
        if (name === "assets") {
          const voices =
            await tx`select id from voices where reference_asset_id=${id}`;
          if (
            voices.length ||
            tasks.some((t) => referencesForTask(t.payload).assetIds.has(id)) ||
            nodes.some((n) => n.data.assetId === id)
          )
            throw new ServiceError(
              "RESOURCE_IN_USE",
              "素材仍被声音、工作流或任务记录引用",
              409,
            );
        }
        if (
          name === "voices" &&
          (tasks.some((t) => referencesForTask(t.payload).voiceIds.has(id)) ||
            nodes.some((n) => n.data.voiceId === id))
        )
          throw new ServiceError(
            "RESOURCE_IN_USE",
            "声音仍被工作流或任务记录引用",
            409,
          );
        await tx`delete from ${tx(name)} where id=${id} and owner_user_id=${owner}`;
        return row.object_key as string | undefined;
      })
      .then(async (key) => {
        if (key) await this.storage.remove(key);
      });
  }
  /** Called only after the selected adapter has authenticated and normalized a webhook. */
  async recordProviderEvent(
    provider: string,
    eventId: string,
    requestId: string,
    state: import("./types").ProviderState,
  ) {
    if (
      !eventId ||
      eventId.length > 200 ||
      !requestId ||
      requestId.length > 200
    )
      throw new ServiceError("INVALID_EVENT", "供应商事件无效");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([requestId, state]))
      .digest("hex");
    return this.sql.begin(async (tx) => {
      const eventKey = provider + ":" + eventId;
      const created =
        await tx`insert into provider_events(id,fingerprint) values(${eventKey},${fingerprint}) on conflict do nothing returning id`;
      if (!created.length) {
        const [prior] =
          await tx`select fingerprint from provider_events where id=${eventKey}`;
        if (prior.fingerprint !== fingerprint)
          throw new ServiceError("EVENT_CONFLICT", "重复事件内容不一致", 409);
        return { duplicate: true };
      }
      const [found] =
        await tx`select key,job_id from provider_operations where provider=${provider} and request_id=${requestId}`;
      if (!found) throw new ServiceError("NOT_FOUND", "供应商请求不存在", 404);
      const [row] =
        await tx`select payload from jobs where id=${found.job_id} for update`;
      if (!row) throw new ServiceError("NOT_FOUND", "任务不存在", 404);
      const [operation] =
        await tx`select * from provider_operations where key=${found.key} for update`;
      if (
        ["generated", "archived", "failed", "cancelled"].includes(
          operation.state,
        )
      )
        return { duplicate: false };
      await tx`update provider_operations set outcome=${tx.json(state as never)},updated_at=now() where key=${operation.key}`;
      if (["succeeded", "failed", "cancelled"].includes(state.status)) {
        await tx`update provider_operations set state=${state.status === "succeeded" ? "generated" : state.status},outputs=${state.status === "succeeded" ? tx.json((state.outputs ?? []) as never) : null},updated_at=now() where key=${operation.key}`;
        const task = row.payload as LocalTask;
        if (task.status !== "succeeded") {
          const next = {
            ...task,
            status:
              task.status === "cancel_requested"
                ? "cancel_requested"
                : "queued",
            revision: task.revision + 1,
            updatedAt: new Date().toISOString(),
          };
          await tx`update jobs set status=${next.status},payload=${tx.json(next as never)},updated_at=now() where id=${operation.job_id}`;
          await tx`insert into job_outbox(job_id) values(${operation.job_id})`;
        }
      }
      return { duplicate: false };
    });
  }
  private async archive(owner: string, id: string, operation: Operation) {
    const assetIds: string[] = [];
    for (const output of operation.outputs ?? []) {
      const keyHash = createHash("sha256")
          .update(operation.key + ":" + output.key)
          .digest("hex"),
        objectKey = `outputs/${id}/${keyHash}`;
      const [existing] = await this
        .sql`select id from assets where object_key=${objectKey} and owner_user_id=${owner}`;
      if (existing) {
        assetIds.push(existing.id);
        continue;
      }
      const meta = await this.storage.put(
        objectKey,
        checkedMedia(
          boundedSource(
            await deadlineCall(this.provider.openOutput(output), 15000),
          ),
          output.mime,
        ),
        maxBytes(output.kind),
      );
      const assetId = randomUUID();
      await this
        .sql`insert into assets(id,owner_user_id,name,kind,mime,bytes,object_key,sha256,source_job_id) values(${assetId},${owner},${output.name.slice(0, 200)},${output.kind},${output.mime},${meta.bytes},${objectKey},${meta.sha256},${id}) on conflict(object_key) do nothing`;
      const [saved] = await this
        .sql`select id from assets where object_key=${objectKey} and owner_user_id=${owner}`;
      assetIds.push(saved.id);
    }
    if (!assetIds.length) throw new Error("供应商未返回可归档文件");
    await this
      .sql`update provider_operations set state='archived',asset_ids=${this.sql.json(assetIds)},updated_at=now() where key=${operation.key}`;
    return assetIds;
  }
  private async generation(
    owner: string,
    task: LocalTask,
    request: GenerationRequest,
    scopeKey: string,
  ): Promise<ExecutionResult> {
    // Client keys are unique per owner, whereas provider operations are globally unique.
    const key = `${task.id}:${scopeKey}`;
    let [raw] = await this
      .sql`select * from provider_operations where key=${key}`;
    let operation = raw as Operation | undefined;
    if (!operation) {
      const current = await this.getJob(owner, task.id);
      if (["cancelled", "cancel_requested"].includes(current.status)) {
        await this.mutate(task.id, (t) => ({ ...t, status: "cancelled" }));
        return {
          status: "failed",
          error: { code: "CANCELLED", message: "提交前已取消" },
        };
      }
      if (this.provider.id === "disabled")
        return {
          status: "blocked",
          error: {
            code: "GENERATION_NOT_ENABLED",
            message: "真实模型执行尚未启用；任务与参数已保存",
          },
        };
      const unavailable = this.provider.readiness?.(request);
      if (unavailable) return { status: "blocked", error: unavailable };
      // Serialize the final pre-submit checkpoint with cancellation. Once this
      // transaction commits, cancellation must be treated as an external request.
      const reserved = await this.sql.begin(async (tx) => {
        const [row] =
          await tx`select payload from jobs where id=${task.id} for update`;
        if (
          !row ||
          ["cancelled", "cancel_requested"].includes(row.payload.status)
        )
          return "cancelled";
        const inserted =
          await tx`insert into provider_operations(key,job_id,provider,state) values(${key},${task.id},${this.provider.id},'submitting') on conflict do nothing returning key`;
        return inserted.length ? "created" : "existing";
      });
      if (reserved === "cancelled") {
        await this.mutate(task.id, (t) => ({ ...t, status: "cancelled" }));
        return {
          status: "failed",
          error: { code: "CANCELLED", message: "提交前已取消" },
        };
      }
      if (reserved === "existing")
        return this.generation(owner, task, request, scopeKey);
      try {
        const inputs = await Promise.all(
          request.assetIds.map((id) => this.getAsset(owner, id)),
        );
        if (request.voiceId) {
          const [v] = await this
            .sql`select reference_asset_id from voices where id=${request.voiceId} and owner_user_id=${owner}`;
          if (v) inputs.push(await this.getAsset(owner, v.reference_asset_id));
        }
        const result = await deadlineCall(
          this.provider.submit(request, key, inputs),
          this.provider.submitTimeoutMs ?? 15000,
        );
        await this
          .sql`update provider_operations set state=${result.outputs ? "generated" : "submitted"},request_id=${result.requestId},outputs=${result.outputs ? this.sql.json(result.outputs as never) : null},updated_at=now() where key=${key}`;
      } catch (e) {
        if (e instanceof ProviderRejected) {
          const outcome = {
            status: "failed",
            error: { code: e.code, message: e.message },
          };
          await this
            .sql`update provider_operations set state='failed',outcome=${this.sql.json(outcome)},updated_at=now() where key=${key}`;
          return { status: "failed", error: outcome.error };
        }
        const error =
          e instanceof ProviderUncertain
            ? { code: e.code, message: e.message }
            : {
                code: "SUBMISSION_UNKNOWN",
                message: "供应商受理结果待核对；不会自动重新提交",
              };
        await this
          .sql`update provider_operations set outcome=${this.sql.json({ error })},updated_at=now() where key=${key}`;
        return {
          status: "unknown",
          error,
        };
      }
      [raw] = await this
        .sql`select * from provider_operations where key=${key}`;
      operation = raw as Operation;
    }
    if (operation.provider !== this.provider.id)
      return {
        status: "unknown",
        error: {
          code: "PROVIDER_CHANGED",
          message: "供应商适配器已变更，需核对原请求",
        },
      };
    if (operation.state === "failed")
      return {
        status: "failed",
        error: operation.outcome?.error ?? {
          code: "PROVIDER_FAILED",
          message: "供应商执行失败",
        },
      };
    if (operation.state === "cancelled") {
      await this.mutate(task.id, (t) => ({
        ...t,
        status: "cancelled",
        events: [
          ...t.events,
          {
            at: new Date().toISOString(),
            status: "cancelled",
            message: "供应商已确认取消",
          },
        ],
      }));
      return {
        status: "failed",
        error: { code: "CANCELLED", message: "供应商已取消" },
      };
    }
    if (operation.state === "archived") {
      const assets = await Promise.all(
        operation.asset_ids.map((id) => this.getAsset(owner, id)),
      );
      return {
        status: "succeeded",
        outputs: Object.fromEntries(
          assets.map((a, i) => [
            i === 0 ? a.kind : `${a.kind}:${i}`,
            { type: a.kind, assetId: a.id },
          ]),
        ),
      };
    }
    if (!operation.outputs) {
      if (!operation.request_id)
        return {
          status: "unknown",
          error: operation.outcome?.error ?? {
            code: "SUBMISSION_UNKNOWN",
            message: "未获得供应商任务 ID，需人工核对，禁止重新提交",
          },
        };
      const deadline = Date.now() + (this.provider.pollWindowMs ?? 120000);
      while (Date.now() < deadline) {
        // A callback may have completed the request while this delivery was polling.
        const [saved] = await this
          .sql`select * from provider_operations where key=${key}`;
        operation = saved as Operation;
        if (operation.outputs) break;
        if (operation.state === "failed")
          return {
            status: "failed",
            error: operation.outcome?.error ?? {
              code: "PROVIDER_FAILED",
              message: "供应商执行失败",
            },
          };
        if (operation.state === "cancelled") {
          await this.mutate(task.id, (t) => ({ ...t, status: "cancelled" }));
          return {
            status: "failed",
            error: { code: "CANCELLED", message: "供应商已取消" },
          };
        }
        const current = await this.getJob(owner, task.id);
        if (current.status === "cancel_requested")
          await deadlineCall(
            this.provider.cancel(operation.request_id!),
            15000,
          ).catch(() => "requested");
        const result = await deadlineCall(
          this.provider.poll(operation.request_id!),
          15000,
        ).catch(() => ({ status: "running" as const }));
        if (["succeeded", "failed", "cancelled"].includes(result.status)) {
          const state =
            result.status === "succeeded" ? "generated" : result.status;
          await this
            .sql`update provider_operations set state=${state},outcome=${this.sql.json(result as never)},outputs=${result.status === "succeeded" ? this.sql.json((result.outputs ?? []) as never) : null},updated_at=now() where key=${key} and state not in ('generated','archived','failed','cancelled')`;
          const [saved] = await this
            .sql`select * from provider_operations where key=${key}`;
          operation = saved as Operation;
        }
        if (operation.state === "cancelled") {
          await this.mutate(task.id, (t) => ({
            ...t,
            status: "cancelled",
            events: [
              ...t.events,
              {
                at: new Date().toISOString(),
                status: "cancelled",
                message: "供应商已确认取消",
              },
            ],
          }));
          return {
            status: "failed",
            error: { code: "CANCELLED", message: "供应商已取消" },
          };
        }
        if (operation.state === "failed") {
          return {
            status: "failed",
            error: operation.outcome?.error ?? {
              code: "PROVIDER_FAILED",
              message: "供应商执行失败",
            },
          };
        }
        if (operation.outputs) break;
        await new Promise((r) =>
          setTimeout(r, this.provider.pollIntervalMs ?? 1000),
        );
      }
      if (!operation.outputs)
        return {
          status: "unknown",
          error: {
            code: "POLL_TIMEOUT",
            message: "查询超时，已保留供应商任务 ID，可继续核对",
          },
        };
    }
    try {
      const expected = modelCatalog.find(
        (m) => m.key === request.modelKey,
      )!.kind;
      const keys = new Set<string>();
      if (!operation.outputs?.length || operation.outputs.length > 8)
        throw new Error("供应商输出数量无效");
      for (const output of operation.outputs) {
        if (
          !output.key ||
          output.key.length > 500 ||
          keys.has(output.key) ||
          typeof output.name !== "string" ||
          output.kind !== (expected === "voice" ? "audio" : expected) ||
          kindForMime(output.mime) !== output.kind
        )
          throw new Error("供应商输出格式无效");
        keys.add(output.key);
      }
      if (!task.graph)
        await this.mutate(task.id, (t) => ({
          ...t,
          status: t.status === "cancel_requested" ? t.status : "archiving",
          events: [
            ...t.events,
            {
              at: new Date().toISOString(),
              status: "archiving",
              message: "供应商已完成，正在归档文件",
            },
          ],
        }));
      const ids = await this.archive(owner, task.id, operation);
      const assets = await Promise.all(
        ids.map((id) => this.getAsset(owner, id)),
      );
      return {
        status: "succeeded",
        outputs: Object.fromEntries(
          assets.map((a, i) => [
            i === 0 ? a.kind : `${a.kind}:${i}`,
            { type: a.kind, assetId: a.id },
          ]),
        ),
      };
    } catch {
      return {
        status: "archive_failed",
        error: {
          code: "ARCHIVE_FAILED",
          message: "生成已完成但文件归档失败，可单独重试归档，不会重新生成",
        },
      };
    }
  }
  private async executeRender(owner: string, task: LocalTask) {
    const id = task.id,
      controller = new AbortController();
    const stop = new ServiceError(
      "RENDER_CANCELLED",
      "合成已取消，临时文件已清理",
    );
    const objectKey = `outputs/${id}/${createHash("sha256").update("render-v1").digest("hex")}`;
    let pollBusy = false;
    const check = async () => {
      const current = await this.getJob(owner, id);
      if (["cancel_requested", "cancelled"].includes(current.status)) {
        controller.abort(stop);
        throw stop;
      }
    };
    const timer = setInterval(() => {
      if (!pollBusy) {
        pollBusy = true;
        void check()
          .catch((e) => controller.abort(e))
          .finally(() => {
            pollBusy = false;
          });
      }
    }, 400);
    let archiving = false;
    try {
      await check();
      const current = await this.mutate(id, (t) =>
        ["cancel_requested", "cancelled"].includes(t.status)
          ? t
          : transitionTask(
              { ...t, status: "running" },
              "running",
              "后台开始合成已保存的剪辑版本",
            ),
      );
      if (current.status !== "running") {
        controller.abort(stop);
        throw stop;
      }
      await withRenderedMovie(
        {
          snapshot: task.render!,
          storage: this.storage,
          asset: (assetId) => this.getAsset(owner, assetId),
          signal: controller.signal,
          progress: async (message) => {
            await check();
            await this.mutate(id, (t) =>
              t.status === "running"
                ? transitionTask(t, "running", message)
                : t,
            );
          },
        },
        async (path) => {
          await check();
          archiving = true;
          await this.mutate(id, (t) =>
            t.status === "running"
              ? transitionTask(t, "archiving", "成片已编码，正在归档私有素材")
              : t,
          );
          await check();
          const meta = await this.storage.put(
            objectKey,
            boundedSource(createReadStream(path)),
            maxBytes("video"),
          );
          // Publish the asset and final task together; cancellation cannot expose a partial output.
          const saved = await this.sql.begin(async (tx) => {
            const [row] =
              await tx`select payload from jobs where id=${id} for update`;
            const t = row.payload as LocalTask;
            if (t.status === "cancel_requested" || t.status === "cancelled")
              return false;
            const assetId = randomUUID();
            await tx`insert into assets(id,owner_user_id,name,kind,mime,bytes,object_key,sha256,source_job_id) values(${assetId},${owner},${task.render!.episodeName + "-v" + task.render!.version + ".mp4"},'video','video/mp4',${meta.bytes},${objectKey},${meta.sha256},${id}) on conflict(object_key) do nothing`;
            const [asset] =
              await tx`select id from assets where object_key=${objectKey} and owner_user_id=${owner}`;
            const next = {
              ...transitionTask(
                t,
                "succeeded",
                "成片已归档，可预览、下载和复用",
              ),
              outputAssetIds: [asset.id],
              revision: t.revision + 1,
            };
            await tx`update jobs set payload=${tx.json(next as never)},status='succeeded',updated_at=now() where id=${id}`;
            return true;
          });
          if (!saved) {
            await this.storage.remove(objectKey);
            throw stop;
          }
        },
      );
    } catch (e) {
      const current = await this.getJob(owner, id);
      const cancelled = ["cancel_requested", "cancelled"].includes(
        current.status,
      );
      if (!terminal(current))
        await this.mutate(id, (t) => {
          if (terminal(t)) return t;
          const status = ["cancel_requested", "cancelled"].includes(t.status)
            ? "cancelled"
            : archiving
              ? "archive_failed"
              : "failed";
          const message =
            status === "cancelled"
              ? stop.message
              : e instanceof ServiceError
                ? e.message
                : archiving
                  ? "成片归档失败，可重新合成此版本并重试归档"
                  : "合成失败，请检查媒体是否损坏及 FFmpeg、ffprobe、中文字体配置";
          return transitionTask(
            t,
            status,
            message,
            status === "cancelled"
              ? undefined
              : {
                  code: e instanceof ServiceError ? e.code : "RENDER_FAILED",
                  message,
                },
          );
        });
      if (cancelled) await this.storage.remove(objectKey).catch(() => {});
      else if (!(e instanceof ServiceError))
        console.error("Render failed", id, e);
    } finally {
      clearInterval(timer);
    }
  }
  async execute(id: string) {
    const conn = await this.sql.reserve();
    try {
      const [lock] =
        await conn`select pg_try_advisory_lock(hashtextextended(${id},0)) as locked`;
      if (!lock.locked) return;
      const [row] =
        await conn`select owner_user_id,payload from jobs where id=${id}`;
      if (!row) return;
      const owner = row.owner_user_id;
      let task = row.payload as LocalTask;
      if (
        ![
          "queued",
          "running",
          "archiving",
          "reconciling",
          "cancel_requested",
        ].includes(task.status)
      )
        return;
      if (task.render) {
        await this.executeRender(owner, task);
        return;
      }
      if (task.status === "cancel_requested") {
        const [op] =
          await conn`select request_id from provider_operations where job_id=${id} and request_id is not null limit 1`;
        if (!op) {
          await this.mutate(id, (t) => ({
            ...t,
            status: "unknown",
            error: {
              code: "SUBMISSION_UNKNOWN",
              message: "取消时提交状态不明，需要核对",
            },
          }));
          return;
        }
      }
      task = await this.mutate(id, (t) => ({
        ...(terminal(t)
          ? t
          : {
              ...t,
              status: t.status === "cancel_requested" ? t.status : "running",
              error: undefined,
              events: [
                ...t.events,
                {
                  at: new Date().toISOString(),
                  status: "running",
                  message: "后台执行已接管；关闭页面不影响任务",
                },
              ],
            }),
      }));
      if (terminal(task)) return;
      if (task.request) {
        const result = await this.generation(
          owner,
          task,
          task.request,
          task.idempotencyKey,
        );
        await this.mutate(id, (current) =>
          current.status === "cancelled"
            ? current
            : {
                ...current,
                status: result.status,
                error: result.status === "succeeded" ? undefined : result.error,
                outputAssetIds:
                  result.status === "succeeded"
                    ? Object.values(result.outputs).flatMap((v) =>
                        "assetId" in v ? [v.assetId] : [],
                      )
                    : current.outputAssetIds,
                events: [
                  ...current.events,
                  {
                    at: new Date().toISOString(),
                    status: result.status,
                    message:
                      result.status === "succeeded"
                        ? "文件已归档，任务完成"
                        : result.error.message,
                  },
                ],
              },
        );
        return;
      }
      const refs = referencesForTask(task);
      const voices = (
        (await this.listLibrary(owner, "voices")) as LocalVoice[]
      ).filter((v) => refs.voiceIds.has(v.id));
      const assetIds = new Set([
        ...refs.assetIds,
        ...voices.map((v) => v.assetId),
      ]);
      const resources = {
        assets: await Promise.all(
          [...assetIds].map((id) => this.getAsset(owner, id)),
        ),
        voices,
      };
      if (!terminal(task)) {
        const current = await this.getJob(owner, id);
        if (current.status === "cancelled") return;
        if (
          current.status === "cancel_requested" &&
          (task.mode === "dry-run" ||
            !task.nodes.some((n) => n.status === "running"))
        ) {
          await this.mutate(id, (t) => ({ ...t, status: "cancelled" }));
          return;
        }
        const next = await performWorkflowStep(
          { ...task, status: "running" },
          resources,
          (request, key) => this.generation(owner, task, request, key),
          async (prepared) => {
            await this.mutate(id, (current) =>
              current.status === "cancelled"
                ? current
                : {
                    ...current,
                    nodes: prepared.nodes,
                    events: prepared.events,
                  },
            );
          },
        );
        task = await this.mutate(id, (current) =>
          current.status === "cancelled"
            ? current
            : {
                ...next,
                status:
                  current.status === "cancel_requested" &&
                  next.status === "running"
                    ? "cancel_requested"
                    : next.status,
                backend: "server",
                revision: current.revision,
              },
        );
        if (["running", "cancel_requested"].includes(task.status))
          await this.sql`insert into job_outbox(job_id) values(${id})`;
      }
    } catch (e) {
      await this.mutate(id, (t) =>
        terminal(t)
          ? t
          : {
              ...t,
              status: "failed",
              error: {
                code: "EXECUTION_FAILED",
                message:
                  e instanceof ServiceError
                    ? e.message
                    : "后台执行异常，检查点已保留",
              },
            },
      ).catch(() => {});
      throw e;
    } finally {
      await conn`select pg_advisory_unlock(hashtextextended(${id},0))`.catch(
        () => {},
      );
      conn.release();
    }
  }
}

async function deadlineCall<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
