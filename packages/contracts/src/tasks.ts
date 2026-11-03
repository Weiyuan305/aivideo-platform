import type { GenerationRequest, MediaKind, WorkflowGraph } from "./index";

export type TaskStatus =
  | "queued"
  | "running"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "unknown"
  | "archiving"
  | "archive_failed"
  | "cancel_requested"
  | "reconciling";
export type NodeStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "blocked"
  | "failed"
  | "cancelled"
  | "archive_failed";
export type RunValue =
  | { type: "text"; text: string }
  | {
      type: "image" | "video" | "audio" | "voice";
      assetId: string;
      voiceId?: string;
    }
  | { type: "image" | "video" | "audio"; planned: true; nodeId: string };
export interface NodeCheckpoint {
  nodeId: string;
  status: NodeStatus;
  inputs: Record<string, RunValue>;
  outputs: Record<string, RunValue>;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
}
export interface TaskEvent {
  at: string;
  message: string;
  status: TaskStatus;
  nodeId?: string;
}
export interface LocalTask {
  schemaVersion: 1;
  backend?: "server";
  id: string;
  groupId: string;
  idempotencyKey: string;
  attempt: number;
  revision: number;
  title: string;
  kind: MediaKind | "workflow";
  mode: "provider" | "dry-run" | "render";
  render?: import("./timeline").RenderSnapshot;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  request?: GenerationRequest;
  graph?: WorkflowGraph;
  workflowVersion?: number;
  nodes: NodeCheckpoint[];
  outputAssetIds: string[];
  events: TaskEvent[];
  error?: { code: string; message: string };
}
/** Real provider adapters belong on the server. No browser credential or inference implementation. */
export interface ProviderSubmission {
  requestId: string;
}
export interface MediaProviderAdapter {
  submit(
    request: GenerationRequest,
    context: { idempotencyKey: string; signal: AbortSignal },
  ): Promise<ProviderSubmission>;
  status(requestId: string): Promise<{
    status: "pending" | "succeeded" | "failed";
    outputAssetIds: string[];
  }>;
}
