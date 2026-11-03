import { createReadStream } from "node:fs";
import { join } from "node:path";
import { ServerWorkspace, DiskStorage } from "../../packages/server/src/index";
import { startWorker } from "../../packages/server/src/worker";
import type { Artifact } from "../../packages/server/src/types";
import { FixtureProvider } from "./fixture-provider";
const url = process.env.TEST_DATABASE_URL!;
if (!new URL(url).pathname.startsWith("/aivideo_test_ui_"))
  throw new Error("UI fixture worker requires its own isolated test DB");
class UIProvider extends FixtureProvider {
  async openOutput(artifact: Artifact) {
    if (artifact.kind !== "image")
      return createReadStream(
        join(
          process.env.TEST_FIXTURE_ROOT!,
          artifact.kind === "video" ? "fixture.mp4" : "fixture.wav",
        ),
      );
    return super.openOutput(artifact);
  }
}
const app = new ServerWorkspace(
  url,
  new DiskStorage(process.env.TEST_STORAGE_ROOT!),
  new UIProvider(),
);
const worker = await startWorker(app, url, {
  schema: "pgboss_ui",
  onError: (e) => console.error(e.message),
});
console.log("Isolated UI fixture worker ready; zero external model calls");
process.on("SIGTERM", async () => {
  await worker.stop();
  await app.close();
  process.exit(0);
});
