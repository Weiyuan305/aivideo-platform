import { expect, it, vi } from "vitest";
import { submitStudioBatch } from "../packages/studio-ui/src/batch.js";

it("retains accepted task IDs when another submission fails", async () => {
  const accepted = vi.fn();
  const submit = vi
    .fn()
    .mockResolvedValueOnce({ pending: true, taskId: "accepted-task" })
    .mockRejectedValueOnce(new Error("第二项提交失败"));
  await expect(submitStudioBatch(2, submit, accepted)).rejects.toThrow("1/2");
  expect(accepted).toHaveBeenCalledWith({
    pending: true,
    taskId: "accepted-task",
  });
  expect(submit).toHaveBeenCalledTimes(2);
});
it("exposes every accepted task and rejects unsupported batch sizes before submitting", async () => {
  const submit = vi.fn(async () => ({
    pending: true,
    taskId: crypto.randomUUID(),
  }));
  const accepted = vi.fn();
  await submitStudioBatch(4, submit, accepted);
  expect(
    new Set(accepted.mock.calls.map(([result]) => result.taskId)).size,
  ).toBe(4);
  submit.mockClear();
  await expect(submitStudioBatch(5, submit, accepted)).rejects.toThrow(
    "1 到 4",
  );
  expect(submit).not.toHaveBeenCalled();
});
