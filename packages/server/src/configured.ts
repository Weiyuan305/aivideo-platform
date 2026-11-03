import { ServerWorkspace } from "./service";
import { storageFromEnv } from "./storage";
import { AgnesProvider, agnesConfigured } from "./agnes";
import type { Artifact } from "./types";

/** Web and worker use the same explicit provider selection and private archive. */
export function configuredWorkspace(env: NodeJS.ProcessEnv) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
  const storage = storageFromEnv(env);
  const app = new ServerWorkspace(env.DATABASE_URL, storage);
  if (agnesConfigured(env) && env.WORKSPACE_BACKEND === "server") {
    app.provider = new AgnesProvider({
      key: env.AGNES_API_KEY!,
      storage,
      referenceURL: async (asset) => {
        if (storage.inputURL) return storage.inputURL(asset.objectKey);
        // Reuse only the output URL belonging to this owner's exact archived asset.
        // URLs stay server-side and are not accepted from client request payloads.
        const rows = await app.sql`
          select p.outputs,p.asset_ids from provider_operations p
          join jobs j on j.id=p.job_id
          where j.owner_user_id=${asset.ownerId} and p.provider='agnes'
          and p.state='archived' and p.asset_ids @> ${app.sql.json([asset.id])}::jsonb`;
        for (const row of rows) {
          const index = (row.asset_ids as string[]).indexOf(asset.id);
          const output = (row.outputs as Artifact[])[index];
          if (output?.kind === "image") return output.url;
        }
        return undefined;
      },
    });
  }
  return app;
}
