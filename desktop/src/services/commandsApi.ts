export type CommandScope = "builtin" | "session" | "avatar" | "group" | "room" | "global";

export type StoredCommand = {
  id: string;
  name: string;
  description: string;
  instructions: string;
  created_at: string;
};

export type VisibleCommand = {
  name: string;
  description: string;
  kind: "local" | "prompt";
  scope: CommandScope;
  instructions: string;
};

export type PerfWait = { wait_ms: number; until: string };

export type PerfRunBrief = {
  run_id: string;
  model: string;
  status: string;
  wall_ms: number | null;
  ttft_ms: number | null;
  created_at: string | null;
};

export type PerfLatest = PerfRunBrief & {
  model_waits: PerfWait[];
  model_wait_total_ms?: number;
  tool_elapsed_ms: number;
  slowest_tool: { name: string; elapsed_ms: number } | null;
  output_tokens?: number | null;
  turn_output_tokens?: number | null;
  output_tokens_per_sec?: number | null;
};

export type PerfSummary = {
  session_id: string;
  runs: PerfRunBrief[];
  latest: PerfLatest | null;
};

export function perfCardError(error: string): { error: string } {
  return { error };
}

function headers(token: string): HeadersInit {
  return token ? { "x-agx-desktop-token": token } : {};
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function fetchVisibleCommands(
  apiBase: string,
  token: string,
  query: { context: string; subjectId?: string; sessionId?: string },
): Promise<VisibleCommand[]> {
  const params = new URLSearchParams({ context: query.context });
  if (query.subjectId) params.set("subject_id", query.subjectId);
  if (query.sessionId) params.set("session_id", query.sessionId);
  const res = await fetch(`${apiBase}/api/commands/visible?${params.toString()}`, { headers: headers(token) });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { items?: VisibleCommand[] };
  return Array.isArray(body.items) ? body.items : [];
}

export async function fetchCommands(
  apiBase: string,
  token: string,
  scope: string,
  subjectId = "",
): Promise<StoredCommand[]> {
  const params = new URLSearchParams({ scope });
  if (scope !== "global" && subjectId) params.set("subject_id", subjectId);
  const res = await fetch(`${apiBase}/api/commands?${params.toString()}`, { headers: headers(token) });
  if (!res.ok) throw new Error(await readError(res));
  const body = (await res.json()) as { commands?: StoredCommand[] };
  return Array.isArray(body.commands) ? body.commands : [];
}

export async function createCommand(
  apiBase: string,
  token: string,
  payload: { scope: string; subject_id?: string; name: string; description: string; instructions: string },
): Promise<void> {
  const res = await fetch(`${apiBase}/api/commands`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function deleteCommand(
  apiBase: string,
  token: string,
  commandId: string,
  scope: string,
  subjectId = "",
): Promise<void> {
  const params = new URLSearchParams({ scope });
  if (scope !== "global" && subjectId) params.set("subject_id", subjectId);
  const res = await fetch(`${apiBase}/api/commands/${encodeURIComponent(commandId)}?${params.toString()}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function pinCommand(
  apiBase: string,
  token: string,
  sessionId: string,
  payload: { scope: string; subject_id?: string; name: string },
): Promise<void> {
  const res = await fetch(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/commands/pin`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readError(res));
}

export async function fetchSessionPerf(apiBase: string, token: string, sessionId: string): Promise<PerfSummary> {
  const res = await fetch(`${apiBase}/api/sessions/${encodeURIComponent(sessionId)}/perf`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as PerfSummary;
}
