import { expect, it } from "vitest";
import { createTask } from "../packages/core/src/tasks";
import { createTemplate } from "../packages/core/src/workflow";
import {
  visibleInHistory,
  canCancelTask,
} from "../packages/core/src/task-views";
it("shows API workflow generations in history while excluding dry runs", () => {
  const graph = createTemplate("image-video");
  expect(visibleInHistory(createTask({ graph, mode: "provider" }))).toBe(true);
  expect(visibleInHistory(createTask({ graph, mode: "dry-run" }))).toBe(false);
});
it("offers cancellation for every cancellable server phase, but never an unknown submission", () => {
  const task = {
    ...createTask({ graph: createTemplate("image-video"), mode: "provider" }),
    backend: "server" as const,
  };
  for (const status of ["archiving", "archive_failed", "reconciling"] as const)
    expect(canCancelTask({ ...task, status })).toBe(true);
  for (const status of ["unknown", "cancel_requested", "succeeded"] as const)
    expect(canCancelTask({ ...task, status })).toBe(false);
  expect(
    canCancelTask({ ...task, backend: undefined, status: "archiving" }),
  ).toBe(false);
});
