import { z } from "zod";
const base = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(20),
  q: z.string().trim().max(200).default(""),
  cursor: z.string().min(1).max(2048).optional(),
});
export const jobListQuerySchema = base.extend({
  kind: z.enum(["all", "image", "video", "voice", "workflow"]).default("all"),
  status: z
    .enum([
      "all",
      "outputs",
      "queued",
      "running",
      "blocked",
      "succeeded",
      "failed",
      "cancelled",
      "interrupted",
      "unknown",
      "archiving",
      "archive_failed",
      "cancel_requested",
      "reconciling",
    ])
    .default("all"),
  mode: z
    .enum(["all", "provider", "dry-run", "render", "media"])
    .default("all"),
  workflowId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
});
export const assetListQuerySchema = base.extend({
  kind: z.enum(["all", "image", "video", "audio"]).default("all"),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;
export interface TaskSummary {
  active: number;
  blocked: number;
  succeeded: number;
}
export interface ListPage<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
  summary?: TaskSummary;
}
