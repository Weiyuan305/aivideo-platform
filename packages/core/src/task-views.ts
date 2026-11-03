import type { LocalTask } from "@aivideo/contracts";
export function visibleInHistory(task: LocalTask) {
  return task.mode !== "dry-run";
}
export function canCancelTask(task: LocalTask) {
  return [
    "queued",
    "running",
    "blocked",
    "interrupted",
    ...(task.backend === "server"
      ? ["archiving", "archive_failed", "reconciling"]
      : []),
  ].includes(task.status);
}
