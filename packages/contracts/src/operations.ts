import { z } from "zod";
export const backupManifestSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  database: z.object({
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  objects: z.array(
    z.object({
      id: z.string().uuid(),
      key: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;
export interface Incident {
  id: string;
  component: string;
  message: string;
  openedAt: string;
  resolvedAt?: string;
}
export interface BackupStatus {
  status: "idle" | "running" | "succeeded" | "failed";
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  backupId?: string;
  assetCount?: number;
  bytes?: number;
  message?: string;
}
export interface OperationsSummary {
  monitor: {
    status: "healthy" | "stale" | "missing" | "unavailable";
    lastCheckAt?: string;
  };
  incidents: Incident[];
  activeIncidents: number;
  pendingNotifications: number;
  notificationMode: "local" | "webhook";
  backup: BackupStatus;
  lastRestore?: { verifiedAt: string; backupId: string; assets: number };
}
