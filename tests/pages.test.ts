import { expect, it, vi } from "vitest";
import { createTask } from "../packages/core/src/tasks";
import { createTemplate } from "../packages/core/src/workflow";
import { loadJobPage, loadAssetPage } from "../packages/core/src/pages";
import { listLocal } from "../packages/core/src/local";
import { workspaceRequest } from "../packages/core/src/workspace-client";
vi.mock("../packages/core/src/local", () => ({ listLocal: vi.fn() }));
vi.mock("../packages/core/src/workspace-client", () => ({
  workspaceBackend: async () => "browser",
  workspaceRequest: vi.fn(),
  serverAsset: (asset: unknown) => asset,
}));
it("preserves local-mode paging, history policy and actual local blobs without server requests", async () => {
  const tasks = Array.from({ length: 60 }, (_, i) => ({
    ...createTask({
      request: {
        modelKey: "image.flux2.t2i.v1",
        prompt: `browser-pages-${i}`,
        assetIds: [],
        parameters: {},
      },
    }),
    createdAt: "2026-10-15T00:00:00.000Z",
  }));
  const trial = createTask({
    graph: { ...createTemplate("image-video"), name: "browser-pages-trial" },
    mode: "dry-run",
  });
  const blob = new Blob(["local image"]),
    asset = {
      id: crypto.randomUUID(),
      name: "literal_%.png",
      createdAt: "2026-10-15T00:00:00.000Z",
      kind: "image",
      blob,
    };
  vi.mocked(listLocal).mockImplementation(
    async (name) => (name === "tasks" ? [...tasks, trial] : [asset]) as never,
  );
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await loadJobPage({
      q: "browser-pages",
      mode: "provider",
      limit: 19,
      cursor,
    });
    expect(page.total).toBe(60);
    ids.push(...page.items.map((t) => t.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(60);
  expect(new Set(ids).size).toBe(60);
  expect(ids).not.toContain(trial.id);
  const found = await loadAssetPage({ q: "literal_%" });
  expect(found.items[0].blob).toBe(blob);
  expect(workspaceRequest).not.toHaveBeenCalled();
});
