import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  outputDir: path.join(os.tmpdir(), "aivideo-playwright-results"),
  reporter: "list",
  use: {
    baseURL,
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @aivideo/web dev --port 3001",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
      },
});
