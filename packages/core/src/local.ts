import {
  workspaceBackend,
  workspaceRequest,
  workspaceChanged,
  serverAsset,
  serverTaskAction,
} from "./workspace-client";
import {
  workflowSchema,
  type WorkflowGraph,
  type LocalAsset,
  type LocalVoice,
  type LocalWorkflow,
  type LocalTask,
} from "@aivideo/contracts";
import { referencesForTask, isTerminal } from "./tasks";

const DB_NAME = "aivideo-local-workspace-v1";
type Stores = {
  assets: LocalAsset;
  voices: LocalVoice;
  workflows: LocalWorkflow;
  tasks: LocalTask;
};
export const LOCAL_CHANGE = "aivideo:local-change";
const channel =
  typeof BroadcastChannel !== "undefined" && typeof window !== "undefined"
    ? new BroadcastChannel("aivideo-workspace")
    : undefined;
channel?.addEventListener("message", (event) =>
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGE, { detail: event.data })),
);
function notify(store: string) {
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGE, { detail: { store } }));
  channel?.postMessage({ store });
}
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const name of ["assets", "voices", "workflows", "tasks"])
        if (!req.result.objectStoreNames.contains(name)) {
          const store = req.result.createObjectStore(name, { keyPath: "id" });
          if (name === "tasks")
            store.createIndex("idempotencyKey", "idempotencyKey", {
              unique: true,
            });
        }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onblocked = () =>
      reject(new Error("存储升级被旧页面阻塞，请刷新其他创作工作台页面"));
    req.onerror = () =>
      reject(new Error("无法打开浏览器本地存储，请检查浏览器隐私设置"));
  });
}
async function transaction<K extends keyof Stores, T>(
  name: K,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = action(tx.objectStore(name));
    let value: T;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      if (mode === "readwrite") notify(name);
      resolve(value!);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("本地保存失败，存储空间可能不足"));
    };
  });
}
export async function listLocal<K extends keyof Stores>(
  name: K,
): Promise<Stores[K][]> {
  if (
    typeof window !== "undefined" &&
    (await workspaceBackend()) === "server"
  ) {
    const result = await workspaceRequest<{ items: Stores[K][] }>(
      name === "tasks"
        ? "/api/jobs?limit=500"
        : `/api/workspace/${name}${name === "assets" ? "?limit=500" : ""}`,
    );
    return name === "assets"
      ? (result.items.map((a) => serverAsset(a as LocalAsset)) as Stores[K][])
      : result.items;
  }
  return transaction<K, Stores[K][]>(name, "readonly", (s) => s.getAll());
}
export async function getLocal<K extends keyof Stores>(
  name: K,
  id: string,
): Promise<Stores[K] | undefined> {
  if (
    typeof window !== "undefined" &&
    (await workspaceBackend()) === "server"
  ) {
    try {
      const result = await workspaceRequest<{ item: Stores[K] }>(
        name === "tasks" ? `/api/jobs/${id}` : `/api/workspace/${name}/${id}`,
      );
      return name === "assets"
        ? (serverAsset(result.item as LocalAsset) as Stores[K])
        : result.item;
    } catch (e) {
      if ((e as { code: string }).code === "NOT_FOUND") return undefined;
      throw e;
    }
  }
  return transaction<K, Stores[K] | undefined>(name, "readonly", (s) =>
    s.get(id),
  );
}
export async function putLocal<K extends keyof Stores>(
  name: K,
  value: Stores[K],
) {
  if (
    typeof window !== "undefined" &&
    (await workspaceBackend()) === "server"
  ) {
    if (name !== "voices") throw new Error("此资源必须使用服务端专用保存接口");
    await workspaceRequest(`/api/workspace/${name}`, {
      method: "POST",
      body: JSON.stringify(value),
    });
    workspaceChanged(name);
    return;
  }
  return transaction(name, "readwrite", (s) => s.put(value));
}
/** Read/increment/write in one transaction, including concurrent browser tabs. */
export async function saveWorkflowVersion(
  raw: WorkflowGraph,
): Promise<LocalWorkflow> {
  const graph = workflowSchema.parse(raw);
  if (
    typeof window !== "undefined" &&
    (await workspaceBackend()) === "server"
  ) {
    const result = await workspaceRequest<{ item: LocalWorkflow }>(
      "/api/workspace/workflows",
      { method: "POST", body: JSON.stringify(graph) },
    );
    workspaceChanged("workflows");
    return result.item;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workflows", "readwrite"),
      store = tx.objectStore("workflows"),
      read = store.get(graph.id);
    let value: LocalWorkflow;
    read.onsuccess = () => {
      const previous = read.result as LocalWorkflow | undefined,
        version = (previous?.version ?? 0) + 1,
        updatedAt = new Date().toISOString();
      const history =
        previous?.history ??
        (previous
          ? [
              {
                version: previous.version,
                graph: previous.graph,
                savedAt: previous.updatedAt,
              },
            ]
          : []);
      value = {
        id: graph.id,
        name: graph.name,
        graph,
        version,
        updatedAt,
        history: [...history, { version, graph, savedAt: updatedAt }],
      };
      store.put(value);
    };
    tx.oncomplete = () => {
      db.close();
      notify("workflows");
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("工作流版本保存失败"));
    };
  });
}
export async function removeLocal<K extends keyof Stores>(name: K, id: string) {
  if (
    typeof window !== "undefined" &&
    (await workspaceBackend()) === "server"
  ) {
    if (name === "tasks") await serverTaskAction(id, "delete");
    else
      await workspaceRequest(`/api/workspace/${name}/${id}`, {
        method: "DELETE",
      });
    workspaceChanged(name);
    return;
  }
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    // Hold reference stores and the deleted store in one transaction across tabs.
    const tx = db.transaction(
      ["assets", "voices", "workflows", "tasks"],
      "readwrite",
    );
    let failure: unknown;
    const reads = ["voices", "workflows", "tasks"].map((key) =>
      tx.objectStore(key).getAll(),
    );
    let remaining = reads.length;
    for (const read of reads)
      read.onsuccess = () => {
        if (--remaining) return;
        try {
          const voices = reads[0].result as LocalVoice[],
            workflows = reads[1].result as LocalWorkflow[],
            tasks = reads[2].result as LocalTask[];
          const graphs = workflows.flatMap((w) => [
            w.graph,
            ...(w.history ?? []).map((h) => h.graph),
          ]);
          if (
            name === "assets" &&
            (voices.some((v) => v.assetId === id) ||
              graphs.some((g) => g.nodes.some((n) => n.data.assetId === id)) ||
              tasks.some((t) => referencesForTask(t).assetIds.has(id)))
          )
            throw new Error(
              "素材仍被声音或工作流引用，或用于任务记录；请先移除引用（含历史版本）",
            );
          if (
            name === "voices" &&
            (graphs.some((g) => g.nodes.some((n) => n.data.voiceId === id)) ||
              tasks.some((t) => referencesForTask(t).voiceIds.has(id)))
          )
            throw new Error(
              "声音仍被工作流引用或用于任务记录，请先移除引用（含历史版本）",
            );
          const task = name === "tasks" && tasks.find((t) => t.id === id);
          if (task && !isTerminal(task.status))
            throw new Error("请先取消任务，再删除记录");
          tx.objectStore(name).delete(id);
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
    tx.oncomplete = () => {
      db.close();
      notify(name);
      resolve();
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error("本地删除失败"));
    };
  });
}
/** Atomic read/update prevents a late executor response from overwriting cancellation. */
export async function mutateTask(
  id: string,
  update: (current: LocalTask) => LocalTask,
): Promise<LocalTask> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite"),
      store = tx.objectStore("tasks");
    let value: LocalTask,
      failure: unknown,
      changed = false;
    const read = store.get(id);
    read.onsuccess = () => {
      try {
        if (!read.result) throw new Error("任务不存在");
        const current = read.result as LocalTask;
        value = update(current);
        if (value === current) return;
        changed = true;
        value = { ...value, revision: current.revision + 1 };
        store.put(value);
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      if (changed) notify("tasks");
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error("任务更新失败"));
    };
  });
}
export async function createLocalTask(task: LocalTask): Promise<LocalTask> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["tasks", "assets", "voices"], "readwrite"),
      store = tx.objectStore("tasks");
    let value: LocalTask,
      failure: unknown,
      changed = false;
    const reads = [
      store.index("idempotencyKey").get(task.idempotencyKey),
      tx.objectStore("assets").getAll(),
      tx.objectStore("voices").getAll(),
    ];
    let remaining = reads.length;
    for (const read of reads)
      read.onsuccess = () => {
        if (--remaining) return;
        try {
          const existing = reads[0].result as LocalTask | undefined;
          if (
            existing &&
            JSON.stringify([
              existing.request,
              existing.graph,
              existing.mode,
            ]) !== JSON.stringify([task.request, task.graph, task.mode])
          )
            throw new Error("相同幂等键对应不同请求");
          value = existing ?? task;
          if (existing) return;
          const assets = reads[1].result as LocalAsset[],
            voices = reads[2].result as LocalVoice[],
            refs = referencesForTask(task);
          if (
            [...refs.assetIds].some((id) => !assets.some((a) => a.id === id)) ||
            [...refs.voiceIds].some(
              (id) =>
                !voices.some(
                  (v) =>
                    v.id === id &&
                    assets.some(
                      (a) => a.id === v.assetId && a.kind === "audio",
                    ),
                ),
            )
          )
            throw new Error("参考资源已不存在，请重新选择");
          changed = true;
          store.add(task);
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
    tx.oncomplete = () => {
      db.close();
      if (changed) notify("tasks");
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error("任务保存失败"));
    };
  });
}
export function kindForMime(mime: string) {
  const allowed: Record<string, LocalAsset["kind"]> = {
    "image/png": "image",
    "image/jpeg": "image",
    "image/webp": "image",
    "audio/wav": "audio",
    "audio/x-wav": "audio",
    "audio/mpeg": "audio",
    "audio/mp3": "audio",
    "audio/webm": "audio",
    "audio/ogg": "audio",
    "video/mp4": "video",
    "video/webm": "video",
  };
  const kind = allowed[mime];
  if (!kind)
    throw new Error("支持 PNG/JPEG/WebP、WAV/MP3/WebM 音频和 MP4/WebM 视频");
  return kind;
}
export function validateFile(file: File) {
  const kind = kindForMime(file.type);
  const max = kind === "image" ? 20 : kind === "audio" ? 30 : 100;
  if (file.size === 0 || file.size > max * 1024 * 1024)
    throw new Error(`文件不能为空，且不得超过 ${max} MB`);
  return kind;
}
export async function saveFile(file: File) {
  const kind = validateFile(file);
  if (
    typeof window !== "undefined" &&
    (await workspaceBackend()) === "server"
  ) {
    const response = await workspaceRequest<{ item: LocalAsset }>(
      "/api/workspace/assets",
      {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      },
    );
    workspaceChanged("assets");
    return serverAsset(response.item);
  }
  const asset: LocalAsset = {
    id: crypto.randomUUID(),
    name: file.name,
    kind,
    mime: file.type,
    bytes: file.size,
    createdAt: new Date().toISOString(),
    blob: file,
  };
  await putLocal("assets", asset);
  return asset;
}
export async function localAssetURL(id: string) {
  const asset = await getLocal("assets", id);
  if (!asset) throw new Error("本地素材不存在，请重新选择");
  return asset.url ?? URL.createObjectURL(asset.blob);
}
export async function fileForAsset(asset: LocalAsset) {
  let blob = asset.blob;
  if (asset.url) {
    const response = await fetch(asset.url);
    if (!response.ok) throw new Error("无法读取参考文件");
    blob = await response.blob();
  }
  return Object.assign(new File([blob], asset.name, { type: asset.mime }), {
    localAssetId: asset.id,
  });
}
export const assetReference = (id: string) => `local-asset:${id}`;
export const referenceID = (value: string) =>
  value?.startsWith("local-asset:") ? value.slice(12) : undefined;
