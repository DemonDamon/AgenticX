/**
 * Fetch helpers for Sub-Plan D's read-only run review REST API (Sub-Plan B):
 * `GET /api/subagent/run`, `/run/activity`, `/run/artifact-preview`.
 *
 * Author: Damon Li
 */

export type RunActivityEntry = {
  seq: number;
  ts: number;
  type: string;
  title: string;
  detail?: string | null;
};

export type RunArtifact = {
  path?: string;
  label?: string;
  [key: string]: unknown;
};

/** Full RunRecord payload from `GET /api/subagent/run` (snake_case, aligned with backend contract). */
export type RunDetail = {
  run_id: string;
  kind: string;
  cluster_id: string;
  badge_seq: string;
  name: string;
  role: string;
  task: string;
  status: string;
  created_at: number;
  updated_at: number;
  persona?: string | null;
  provider?: string | null;
  model?: string | null;
  avatar_id?: string | null;
  started_at?: number | null;
  completed_at?: number | null;
  result_summary?: string | null;
  error_text?: string | null;
  result_file?: string | null;
  output_files: string[];
  artifacts: RunArtifact[];
  activity_count: number;
};

export type ArtifactPreview =
  | { ok: true; kind: "text"; text: string; bytes: number; truncated: boolean; open_hint?: string | null; path: string }
  | { ok: true; kind: "binary"; bytes: number; truncated: boolean; open_hint?: string | null; path: string }
  | { ok: false; error: string; detail?: string };

type AuthCtx = { apiBase: string; apiToken: string };

function authHeaders(token: string): HeadersInit {
  return token ? { "x-agx-desktop-token": token } : {};
}

export async function fetchSubAgentRunDetail(
  { apiBase, apiToken }: AuthCtx,
  sessionId: string,
  runId: string,
): Promise<RunDetail> {
  const url = `${apiBase}/api/subagent/run?session_id=${encodeURIComponent(sessionId)}&run_id=${encodeURIComponent(runId)}`;
  const resp = await fetch(url, { headers: authHeaders(apiToken) });
  const data = await resp.json();
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `run detail fetch failed (${resp.status})`);
  }
  return data.run as RunDetail;
}

export async function fetchSubAgentRunActivity(
  { apiBase, apiToken }: AuthCtx,
  sessionId: string,
  runId: string,
  opts: { offset?: number; limit?: number; order?: "asc" | "desc" } = {},
): Promise<{ entries: RunActivityEntry[]; total: number; offset: number; limit: number }> {
  const params = new URLSearchParams({
    session_id: sessionId,
    run_id: runId,
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 100),
    order: opts.order ?? "asc",
  });
  const resp = await fetch(`${apiBase}/api/subagent/run/activity?${params.toString()}`, {
    headers: authHeaders(apiToken),
  });
  const data = await resp.json();
  if (!resp.ok || !data?.ok) {
    throw new Error(data?.error || `run activity fetch failed (${resp.status})`);
  }
  return {
    entries: Array.isArray(data.entries) ? data.entries : [],
    total: Number(data.total ?? 0),
    offset: Number(data.offset ?? 0),
    limit: Number(data.limit ?? 0),
  };
}

export async function fetchSubAgentArtifactPreview(
  { apiBase, apiToken }: AuthCtx,
  sessionId: string,
  runId: string,
  path: string,
): Promise<ArtifactPreview> {
  const params = new URLSearchParams({ session_id: sessionId, run_id: runId, path });
  const resp = await fetch(`${apiBase}/api/subagent/run/artifact-preview?${params.toString()}`, {
    headers: authHeaders(apiToken),
  });
  return (await resp.json()) as ArtifactPreview;
}
