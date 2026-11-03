export async function submitStudioBatch(count, submit, onAccepted) {
  if (!Number.isInteger(count) || count < 1 || count > 4)
    throw new Error("图片批量数量必须为 1 到 4");
  const results = await Promise.allSettled(
    Array.from({ length: count }, async (_, index) => {
      const result = await submit(index);
      onAccepted(result);
      return result;
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    const first = failures[0].reason;
    throw Object.assign(
      new AggregateError(
        failures.map((result) => result.reason),
        `${failures.length}/${count} 项提交失败：${first?.message || "请稍后重试"}`,
      ),
      { code: first?.code },
    );
  }
}
