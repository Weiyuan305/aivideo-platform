export interface HealthCheck {
  status: "healthy" | "unhealthy" | "unknown";
  message: string;
  checkedAt: string;
  latencyMs?: number;
}
export interface WorkerHealth {
  status: "healthy" | "unhealthy" | "stale" | "stopped" | "missing" | "unknown";
  message: string;
  activeWorkers?: number;
  lastHeartbeatAt?: string;
  lastErrorAt?: string;
}
export interface QueueHealth {
  status: "healthy" | "backlogged" | "unknown";
  queued: number;
  running: number;
  archiving: number;
  archiveFailed: number;
  unknown: number;
  pendingDispatch: number;
  oldestQueuedSeconds: number;
}
export interface WorkspaceHealth {
  status: "healthy" | "degraded" | "unavailable" | "local";
  generationEnabled: boolean;
  checkedAt: string;
  database: HealthCheck;
  storage: HealthCheck;
  worker: WorkerHealth;
  queue?: QueueHealth;
}
