import type {
  AgentRecord,
  AgentVersionRecord,
  ClientEvent,
  EnvironmentRecord,
  ServerEvent,
  SessionRecord,
  SessionSource,
} from "@agenticx/core-api";

export type { AgentRecord, AgentVersionRecord, EnvironmentRecord, SessionRecord };

export type MaAgentRouting = {
  mode: "follow_latest" | "pinned";
  pinned_version: number | null;
  effective_version: number;
};

export type MaAgentEnvelope = { agent: AgentRecord; routing: MaAgentRouting };

export type MaStoredEvent = (ServerEvent | ClientEvent) & {
  id: string;
  seq: number;
  type: string;
  created_at: string;
};

export type MaPreviewFrame = { type: "event_start" | "event_delta"; [key: string]: unknown };

export type MaStreamItem = { kind: "event"; event: MaStoredEvent } | { kind: "preview"; frame: MaPreviewFrame };

export type CreateAgentInput = {
  slug: string;
  display_name: string;
  description?: string | null;
  runtime?: "cloud" | "desktop_worker";
  assignment_keys?: string[];
  worker_keys?: string[];
  manifest: Record<string, unknown>;
  note?: string;
};

export type UpdateAgentPatch = Partial<{
  display_name: string;
  description: string | null;
  status: "active" | "disabled";
  lifecycle: "draft" | "published" | "recalled";
  runtime: "cloud" | "desktop_worker";
  assignment_keys: string[];
  worker_keys: string[];
  default_environment_id: string | null;
  routing: { mode: "follow_latest" } | { mode: "pinned"; pinned_version: number };
}>;

export type CreateSessionInput = {
  agent_id: string;
  agent_version?: number;
  environment_id?: string;
  vault_ids?: string[];
  resources?: Record<string, unknown>[];
  title?: string;
  source?: SessionSource;
};
