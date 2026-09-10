import { buildReplayPayloadDisplay } from "./replay-payload";

export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type EffectClass =
  | "none"
  | "read"
  | "local_write"
  | "external_write"
  | "unknown";

export type ReplayRun = {
  runId: string;
  sessionId: string;
  turnId: string;
  agentId: string;
  status: RunStatus;
  createdAt: number;
  completedAt?: number;
  eventCount: number;
  completeness: "complete" | "partial";
  parentRunId?: string;
  forkedFromEventId?: string;
};

export type ReplayEvent = {
  eventId: string;
  runId: string;
  seq: number;
  ts: number;
  type: string;
  agentId: string;
  roundIdx?: number;
  toolCallId?: string;
  parentEventId?: string;
  title: string;
  summary: string;
  effectClass: EffectClass;
  branchable: boolean;
  unbranchableReason?: string;
  payload?: Record<string, unknown>;
  payloadPreviewText?: string;
  payloadPreviewTruncated?: boolean;
  payloadRef?: string;
};

export type ReplayRunsResponse = {
  runs: ReplayRun[];
  legacy: boolean;
  reason?: string;
  parseWarnings: string[];
};

export type ReplayEventsResponse = {
  run: ReplayRun;
  events: ReplayEvent[];
  nextSeq: number;
  hasMore: boolean;
  parseWarnings: string[];
};

export type ReplayExportFormat = "markdown" | "json";
export type ReplaySpeed = 0.5 | 1 | 2 | "instant";
export type ReplayFilter = "all" | "tool" | "agent" | "wait" | "error" | "artifact";

export type ReplaySpanStatus = "running" | "completed" | "failed" | "interrupted" | "waiting";

export type ReplaySpan = {
  id: string;
  kind: "tool" | "wait";
  agentId: string;
  startEventId: string;
  endEventId?: string;
  startSeq: number;
  endSeq: number;
  startTs: number;
  endTs?: number;
  title: string;
  status: ReplaySpanStatus;
  toolCallId?: string;
};

export type ReplayLane = {
  agentId: string;
  firstSeq: number;
  events: ReplayEvent[];
  spans: ReplaySpan[];
};

export type ReplayStats = {
  durationMs: number;
  rounds: number;
  toolCalls: number;
  errors: number;
  subagents: number;
  branches: number;
};

export type ReplayProjection = {
  events: ReplayEvent[];
  visibleEvents: ReplayEvent[];
  lanes: ReplayLane[];
  spans: ReplaySpan[];
  stats: ReplayStats;
  warnings: string[];
};

const RUN_STATUSES = new Set<RunStatus>([
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const EFFECT_CLASSES = new Set<EffectClass>([
  "none",
  "read",
  "local_write",
  "external_write",
  "unknown",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalText(value: unknown): string | undefined {
  const normalized = text(value);
  return normalized || undefined;
}

function optionalInteger(value: unknown): number | undefined {
  const normalized = finiteNumber(value);
  return normalized !== null && Number.isInteger(normalized) ? normalized : undefined;
}

function epochMs(value: unknown): number {
  const normalized = finiteNumber(value) ?? 0;
  return normalized > 0 && normalized < 100_000_000_000 ? normalized * 1_000 : normalized;
}

function nestedSubagentRunId(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const run = record(record(item)?.run);
    const runId = optionalText(run?.run_id);
    if (runId) return runId;
  }
  return undefined;
}

function normalizeRun(value: unknown, warnings: string[]): ReplayRun | null {
  const raw = record(value);
  if (!raw) {
    warnings.push("invalid run row");
    return null;
  }
  const runId = text(raw.run_id);
  const sessionId = text(raw.session_id);
  const turnId = text(raw.turn_id);
  if (!runId || !sessionId || !turnId) {
    warnings.push(`invalid run row ${runId || "<unknown>"}`);
    return null;
  }
  const rawStatus = text(raw.status);
  const status = RUN_STATUSES.has(rawStatus as RunStatus)
    ? rawStatus as RunStatus
    : "interrupted";
  if (status !== rawStatus) warnings.push(`run ${runId}: unknown status ${rawStatus || "<empty>"}`);
  const completeness = raw.completeness === "complete" ? "complete" : "partial";
  if (raw.completeness !== "complete" && raw.completeness !== "partial") {
    warnings.push(`run ${runId}: unknown completeness`);
  }
  const completedAt = finiteNumber(raw.completed_at);
  return {
    runId,
    sessionId,
    turnId,
    agentId: text(raw.agent_id) || "meta",
    status,
    createdAt: epochMs(raw.created_at),
    ...(completedAt !== null ? { completedAt: epochMs(completedAt) } : {}),
    eventCount: Math.max(0, Math.trunc(finiteNumber(raw.event_count) ?? 0)),
    completeness,
    ...(optionalText(raw.parent_run_id) ? { parentRunId: optionalText(raw.parent_run_id) } : {}),
    ...(optionalText(raw.forked_from_event_id)
      ? { forkedFromEventId: optionalText(raw.forked_from_event_id) }
      : {}),
  };
}

function normalizeEvent(value: unknown, warnings: string[]): ReplayEvent | null {
  const raw = record(value);
  if (!raw) {
    warnings.push("invalid event row");
    return null;
  }
  const eventId = text(raw.event_id);
  const runId = text(raw.run_id);
  const seq = finiteNumber(raw.seq);
  if (!eventId || !runId || seq === null || !Number.isInteger(seq) || seq < 1) {
    warnings.push(`invalid event row ${eventId || "<unknown>"}`);
    return null;
  }
  const rawEffect = text(raw.effect_class) || "none";
  const effectClass = EFFECT_CLASSES.has(rawEffect as EffectClass)
    ? rawEffect as EffectClass
    : "unknown";
  if (effectClass !== rawEffect) warnings.push(`event ${eventId}: unknown effect ${rawEffect}`);
  const inlinePayload = record(raw.payload);
  const resolvedPayload = record(raw.resolved_payload);
  const subagentRunId = nestedSubagentRunId(raw.subagent_runs);
  const basePayload = {
    ...(inlinePayload ?? {}),
    ...(subagentRunId ? { subagent_run_id: subagentRunId } : {}),
  };
  const resolved = resolvedPayload
    ? { ...basePayload, ...resolvedPayload }
    : Object.keys(basePayload).length > 0
      ? basePayload
      : undefined;
  const payloadPreview = buildReplayPayloadDisplay(resolved);
  return {
    eventId,
    runId,
    seq,
    ts: epochMs(raw.ts),
    type: text(raw.type) || "unknown",
    agentId: text(raw.agent_id) || "meta",
    ...(optionalInteger(raw.round_idx) !== undefined
      ? { roundIdx: optionalInteger(raw.round_idx) }
      : {}),
    ...(optionalText(raw.tool_call_id) ? { toolCallId: optionalText(raw.tool_call_id) } : {}),
    ...(optionalText(raw.parent_event_id)
      ? { parentEventId: optionalText(raw.parent_event_id) }
      : {}),
    title: typeof raw.title === "string" ? raw.title : "",
    summary: typeof raw.summary === "string" ? raw.summary : "",
    effectClass,
    branchable: raw.branchable === true,
    ...(optionalText(raw.unbranchable_reason)
      ? { unbranchableReason: optionalText(raw.unbranchable_reason) }
      : {}),
    ...(resolved
      ? {
          payload: resolved,
          payloadPreviewText: payloadPreview.displayText,
          payloadPreviewTruncated: payloadPreview.truncated,
        }
      : {}),
    ...(optionalText(raw.payload_ref) ? { payloadRef: optionalText(raw.payload_ref) } : {}),
  };
}

export function normalizeReplayRunsResponse(value: unknown): ReplayRunsResponse {
  const warnings: string[] = [];
  const raw = record(value);
  const rows = Array.isArray(raw?.runs) ? raw.runs : [];
  if (!raw || !Array.isArray(raw.runs)) warnings.push("runs response missing runs");
  return {
    runs: rows.flatMap((row) => {
      const normalized = normalizeRun(row, warnings);
      return normalized ? [normalized] : [];
    }),
    legacy: raw?.legacy_summary_available === true || raw?.reason === "no_replay_ledger",
    ...(optionalText(raw?.reason) ? { reason: optionalText(raw?.reason) } : {}),
    parseWarnings: warnings,
  };
}

export function normalizeReplayRunResponse(value: unknown): {
  run: ReplayRun;
  parseWarnings: string[];
} {
  const warnings: string[] = [];
  const raw = record(value);
  const run = normalizeRun(raw?.run, warnings);
  if (!run) throw new Error("Replay response did not include a valid run");
  return { run, parseWarnings: warnings };
}

export function normalizeReplayEventsResponse(value: unknown): ReplayEventsResponse {
  const warnings: string[] = [];
  const raw = record(value);
  const run = normalizeRun(raw?.run, warnings);
  if (!run) throw new Error("Replay events response did not include a valid run");
  const rows = Array.isArray(raw?.events) ? raw.events : [];
  if (!Array.isArray(raw?.events)) warnings.push("events response missing events");
  const events = rows.flatMap((row) => {
    const normalized = normalizeEvent(row, warnings);
    return normalized ? [normalized] : [];
  });
  return {
    run,
    events,
    nextSeq: Math.max(0, Math.trunc(finiteNumber(raw?.next_seq) ?? 0)),
    hasMore: raw?.has_more === true,
    parseWarnings: warnings,
  };
}
