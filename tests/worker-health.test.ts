import { expect, it } from "vitest";
import { classifyWorker } from "../packages/server/src/health";
it("distinguishes online, disconnected, expired, stopped and never-started workers", () => {
  const now = Date.now(),
    row = {
      heartbeatAt: new Date(now - 1000),
      stoppedAt: null,
      transportReady: true,
    };
  expect(classifyWorker([row], now).status).toBe("healthy");
  expect(classifyWorker([{ ...row, transportReady: false }], now).status).toBe(
    "unhealthy",
  );
  expect(
    classifyWorker([{ ...row, heartbeatAt: new Date(now - 20001) }], now)
      .status,
  ).toBe("stale");
  expect(
    classifyWorker([{ ...row, stoppedAt: new Date(now) }], now).status,
  ).toBe("stopped");
  expect(classifyWorker([], now).status).toBe("missing");
});
