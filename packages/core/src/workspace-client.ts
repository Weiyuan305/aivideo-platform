let configuration: Promise<"server" | "browser"> | undefined;
function networkFailure(error: unknown): never {
  if (error instanceof TypeError)
    throw Object.assign(new Error("工作区请求未能完成，请检查网络连接后重试"), {
      code: "NETWORK_ERROR",
      cause: error,
    });
  throw error;
}
export function workspaceBackend() {
  return (configuration ??= fetch("/api/config", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("无法读取工作区配置");
      return (await response.json()).workspaceBackend === "server"
        ? ("server" as const)
        : ("browser" as const);
    })
    .catch((error) => {
      configuration = undefined;
      networkFailure(error);
    }));
}
export async function workspaceRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      ...(init?.body instanceof File
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  }).catch(networkFailure);
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(body.error?.message || "服务端请求失败"), {
      code: body.error?.code,
    });
  return body;
}
export function workspaceChanged(store: string) {
  window.dispatchEvent(
    new CustomEvent("aivideo:local-change", { detail: { store } }),
  );
}
export async function serverTaskAction(id: string, action: string) {
  const result = await workspaceRequest<{
    item: import("@aivideo/contracts").LocalTask;
  }>(`/api/jobs/${id}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ action }),
  });
  workspaceChanged("tasks");
  return result.item;
}
export function serverAsset<T extends { id: string; mime: string }>(asset: T) {
  return {
    ...asset,
    blob: new Blob([], { type: asset.mime }),
    url: `/api/workspace/assets/${asset.id}/file`,
  };
}
