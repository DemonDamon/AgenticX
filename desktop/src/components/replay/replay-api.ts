import {
  normalizeReplayEventsResponse,
  normalizeReplayRunResponse,
  normalizeReplayRunsResponse,
  type ReplayEventsResponse,
  type ReplayExportFormat,
  type ReplayRun,
  type ReplayRunsResponse,
} from "./replay-types";

export class ReplayApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ReplayApiError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  signal?: AbortSignal;
};

export type ListReplayEventsOptions = RequestOptions & {
  afterSeq?: number;
  limit?: number;
  types?: string[];
  includePayload?: boolean;
};

function apiUrl(apiBase: string, path: string, params?: URLSearchParams): string {
  const base = apiBase.trim().replace(/\/+$/, "");
  const query = params?.toString();
  return `${base}${path}${query ? `?${query}` : ""}`;
}

function headers(apiToken: string): HeadersInit {
  return { "x-agx-desktop-token": apiToken };
}

function detailText(value: unknown): { message?: string; code?: string } {
  if (typeof value === "string") return { message: value };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const detail = raw.detail;
  const code = typeof raw.code === "string" ? raw.code : undefined;
  if (typeof detail === "string") return { message: detail, code };
  if (detail !== undefined) {
    try {
      return { message: JSON.stringify(detail), code };
    } catch {
      return { code };
    }
  }
  return { code };
}

async function requireOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const parsed = detailText(body);
  throw new ReplayApiError(
    parsed.message || `Replay request failed (HTTP ${response.status})`,
    response.status,
    parsed.code,
  );
}

export async function listReplayRuns(
  apiBase: string,
  apiToken: string,
  sessionId: string,
  options: RequestOptions = {},
): Promise<ReplayRunsResponse> {
  const params = new URLSearchParams({ session_id: sessionId });
  const response = await requireOk(await fetch(apiUrl(apiBase, "/api/runs", params), {
    headers: headers(apiToken),
    signal: options.signal,
  }));
  return normalizeReplayRunsResponse(await response.json() as unknown);
}

export async function getReplayRun(
  apiBase: string,
  apiToken: string,
  runId: string,
  options: RequestOptions = {},
): Promise<{ run: ReplayRun; parseWarnings: string[] }> {
  const response = await requireOk(await fetch(
    apiUrl(apiBase, `/api/runs/${encodeURIComponent(runId)}`),
    { headers: headers(apiToken), signal: options.signal },
  ));
  return normalizeReplayRunResponse(await response.json() as unknown);
}

export async function listAllReplayEvents(
  apiBase: string,
  apiToken: string,
  runId: string,
  options: RequestOptions = {},
): Promise<{ run: ReplayRun; events: ReplayEventsResponse["events"]; parseWarnings: string[] }> {
  const events: ReplayEventsResponse["events"] = [];
  const seen = new Set<string>();
  const parseWarnings: string[] = [];
  let afterSeq = 0;
  let run: ReplayRun | undefined;
  while (true) {
    const page = await listReplayEvents(apiBase, apiToken, runId, {
      afterSeq,
      limit: 100,
      includePayload: false,
      signal: options.signal,
    });
    run = page.run;
    parseWarnings.push(...page.parseWarnings);
    for (const event of page.events) {
      if (seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      events.push(event);
    }
    if (!page.hasMore || events.length >= page.run.eventCount) break;
    if (page.nextSeq <= afterSeq) break;
    afterSeq = page.nextSeq;
  }
  if (!run) {
    throw new ReplayApiError(`Replay request failed (empty events for ${runId})`, 404);
  }
  return { run, events, parseWarnings };
}

export async function listReplayEvents(
  apiBase: string,
  apiToken: string,
  runId: string,
  options: ListReplayEventsOptions = {},
): Promise<ReplayEventsResponse> {
  const params = new URLSearchParams();
  if (options.afterSeq !== undefined) params.set("after_seq", String(options.afterSeq));
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.types?.length) params.set("types", options.types.join(","));
  if (options.includePayload !== undefined) {
    params.set("include_payload", String(options.includePayload));
  }
  const response = await requireOk(await fetch(
    apiUrl(apiBase, `/api/runs/${encodeURIComponent(runId)}/events`, params),
    { headers: headers(apiToken), signal: options.signal },
  ));
  return normalizeReplayEventsResponse(await response.json() as unknown);
}

export async function getReplayExport(
  apiBase: string,
  apiToken: string,
  runId: string,
  format: ReplayExportFormat,
  options: RequestOptions = {},
): Promise<string> {
  const params = new URLSearchParams({
    format,
    redact: "true",
  });
  const response = await requireOk(await fetch(
    apiUrl(apiBase, `/api/runs/${encodeURIComponent(runId)}/export`, params),
    { headers: headers(apiToken), signal: options.signal },
  ));
  return response.text();
}
