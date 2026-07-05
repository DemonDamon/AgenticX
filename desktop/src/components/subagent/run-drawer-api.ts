/**
 * Sub-Plan D — REST helpers for sub-agent run drawer (run detail, activity, artifacts).
 */
import type { SubAgentRunRecord } from "./badge-vm";
import type { SubAgentCluster } from "./badge-vm";

export type ActivityEntry = {
  seq: number;
  ts: number;
  type: string;
  title: string;
  detail?: string | null;
};

export type RunDetailResponse = {
  ok: boolean;
  run?: SubAgentRunRecord & Record<string, unknown>;
  error?: string;
  detail?: string;
};

export type ActivityPageResponse = {
  ok: boolean;
  entries?: ActivityEntry[];
  total?: number;
  offset?: number;
  limit?: number;
  error?: string;
  detail?: string;
};

export type ArtifactPreviewResponse = {
  ok: boolean;
  kind?: "text" | "binary";
  text?: string;
  bytes?: number;
  truncated?: boolean;
  open_hint?: string | null;
  path?: string;
  error?: string;
  detail?: string;
};

export type ClusterListResponse = {
  ok: boolean;
  clusters?: SubAgentCluster[];
  error?: string;
  detail?: string;
};

const ACTIVITY_PAGE_SIZE = 80;

export async function fetchRunDetail(
  apiBase: string,
  apiToken: string,
  sessionId: string,
  runId: string,
): Promise<RunDetailResponse> {
  const params = new URLSearchParams({ session_id: sessionId, run_id: runId });
  const resp = await fetch(`${apiBase}/api/subagent/run?${params}`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}`, detail: await resp.text().catch(() => "") };
  }
  return (await resp.json()) as RunDetailResponse;
}

export async function fetchRunActivityPage(
  apiBase: string,
  apiToken: string,
  sessionId: string,
  runId: string,
  offset: number,
  limit = ACTIVITY_PAGE_SIZE,
): Promise<ActivityPageResponse> {
  const params = new URLSearchParams({
    session_id: sessionId,
    run_id: runId,
    offset: String(Math.max(0, offset)),
    limit: String(limit),
    order: "asc",
  });
  const resp = await fetch(`${apiBase}/api/subagent/run/activity?${params}`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}`, detail: await resp.text().catch(() => "") };
  }
  return (await resp.json()) as ActivityPageResponse;
}

export async function fetchArtifactPreview(
  apiBase: string,
  apiToken: string,
  sessionId: string,
  runId: string,
  path: string,
): Promise<ArtifactPreviewResponse> {
  const params = new URLSearchParams({ session_id: sessionId, run_id: runId, path });
  const resp = await fetch(`${apiBase}/api/subagent/run/artifact-preview?${params}`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}`, detail: await resp.text().catch(() => "") };
  }
  return (await resp.json()) as ArtifactPreviewResponse;
}

export async function fetchSubAgentClusters(
  apiBase: string,
  apiToken: string,
  sessionId: string,
): Promise<ClusterListResponse> {
  const params = new URLSearchParams({ session_id: sessionId });
  const resp = await fetch(`${apiBase}/api/session/subagent-clusters?${params}`, {
    headers: { "x-agx-desktop-token": apiToken },
  });
  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}`, detail: await resp.text().catch(() => "") };
  }
  return (await resp.json()) as ClusterListResponse;
}

export { ACTIVITY_PAGE_SIZE };
