import { ServerWorkspace, DiskStorage } from "../../packages/server/src/index";
import { startWorker } from "../../packages/server/src/worker";
import { FixtureProvider } from "./fixture-provider";
const url = process.env.TEST_DATABASE_URL!;
if (!new URL(url).pathname.startsWith("/aivideo_test"))
  throw new Error("Fixture worker requires isolated test database");
const provider = new FixtureProvider();
if (process.env.FIXTURE_DELAY_MS)
  provider.beforePoll = () =>
    new Promise((r) => setTimeout(r, Number(process.env.FIXTURE_DELAY_MS)));
const app = new ServerWorkspace(
  url,
  new DiskStorage(process.env.TEST_STORAGE_ROOT!),
  provider,
);
const worker = await startWorker(app, url, {
  schema: process.env.TEST_QUEUE_SCHEMA ?? "pgboss_test",
  expireSeconds: 5,
  onError: (e) => console.error(e.message),
});
process.send?.({ ready: true });
console.log("fixture worker ready");
process.on("SIGTERM", async () => {
  await worker.stop();
  await app.close();
  process.exit(0);
});
