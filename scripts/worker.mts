import { configuredWorkspace } from "../packages/server/src/index";
import { startWorker } from "../packages/server/src/worker";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
const app = configuredWorkspace(process.env);
const worker = await startWorker(app, process.env.DATABASE_URL, {
  onError: () =>
    console.error("后台队列处理失败，请检查数据库、存储和任务记录"),
});
console.log(`AIvideo worker ready; provider=${app.provider.id}`);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await worker.stop();
  await app.close();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
