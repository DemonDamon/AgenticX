import type {
  ReplayEvent,
  ReplayFilter,
  ReplayLane,
  ReplayProjection,
  ReplaySpan,
  ReplayStats,
} from "./replay-types";

const TOOL_TYPES = new Set(["tool_call", "tool_progress", "tool_result"]);
const AGENT_TYPES = new Set([
  "subagent_started",
  "subagent_progress",
  "subagent_checkpoint",
  "subagent_completed",
  "subagent_error",
]);
const WAIT_TYPES = new Set([
  "confirm_required",
  "confirm_response",
  "clarification_required",
  "clarification_response",
  "clarification_suspended",
]);
const ERROR_TYPES = new Set(["error", "ledger_gap", "subagent_error", "stall"]);
const ARTIFACT_TYPES = new Set(["artifact"]);

function normalizeAgentId(agentId: string): string {
  const normalized = agentId.trim();
  return normalized === "__meta__" || normalized === "" ? "meta" : normalized;
}

function eventMatchesFilter(event: ReplayEvent, filters: Set<string>): boolean {
  if (ERROR_TYPES.has(event.type)) return true;
  if (filters.size === 0 || filters.has("all")) return true;
  if (filters.has("tool") && TOOL_TYPES.has(event.type)) return true;
  if (filters.has("agent") && AGENT_TYPES.has(event.type)) return true;
  if (filters.has("wait") && WAIT_TYPES.has(event.type)) return true;
  if (filters.has("error") && ERROR_TYPES.has(event.type)) return true;
  if (filters.has("artifact") && ARTIFACT_TYPES.has(event.type)) return true;
  return false;
}

function stableEvents(events: ReplayEvent[]): { events: ReplayEvent[]; warnings: string[] } {
  const byId = new Set<string>();
  const bySeq = new Set<number>();
  const warnings: string[] = [];
  const sorted = [...events].sort((a, b) => a.seq - b.seq || a.eventId.localeCompare(b.eventId));
  const kept: ReplayEvent[] = [];
  for (const event of sorted) {
    if (byId.has(event.eventId)) {
      warnings.push(`duplicate event id ${event.eventId}`);
      continue;
    }
    if (bySeq.has(event.seq)) {
      warnings.push(`duplicate seq ${event.seq}`);
      byId.add(event.eventId);
      continue;
    }
    byId.add(event.eventId);
    bySeq.add(event.seq);
    kept.push({ ...event, agentId: normalizeAgentId(event.agentId) });
  }
  return { events: kept, warnings };
}

export function failedToolResult(event: ReplayEvent): boolean {
  const payloadStatus = typeof event.payload?.status === "string" ? event.payload.status : "";
  return payloadStatus === "failed"
    || payloadStatus === "error"
    || /\b(error|failed|失败)\b/i.test(`${event.title} ${event.summary}`);
}

function buildSpans(events: ReplayEvent[]): ReplaySpan[] {
  const spans: ReplaySpan[] = [];
  const openTools = new Map<string, ReplaySpan>();
  const openWaits = new Map<string, ReplaySpan>();
  for (const event of events) {
    if (event.type === "tool_call" && event.toolCallId) {
      const span: ReplaySpan = {
        id: `tool:${event.toolCallId}`,
        kind: "tool",
        agentId: event.agentId,
        startEventId: event.eventId,
        startSeq: event.seq,
        endSeq: event.seq,
        startTs: event.ts,
        title: event.title || event.summary || event.toolCallId,
        status: "running",
        toolCallId: event.toolCallId,
      };
      spans.push(span);
      openTools.set(event.toolCallId, span);
      continue;
    }
    if (event.type === "tool_result" && event.toolCallId) {
      const span = openTools.get(event.toolCallId);
      if (!span) continue;
      span.endEventId = event.eventId;
      span.endSeq = event.seq;
      span.endTs = Math.max(span.startTs, event.ts);
      span.status = failedToolResult(event) ? "failed" : "completed";
      openTools.delete(event.toolCallId);
      continue;
    }
    if (event.type === "confirm_required" || event.type === "clarification_required") {
      const key = `${event.agentId}:${event.type === "confirm_required" ? "confirm" : "clarification"}`;
      const span: ReplaySpan = {
        id: `wait:${event.eventId}`,
        kind: "wait",
        agentId: event.agentId,
        startEventId: event.eventId,
        startSeq: event.seq,
        endSeq: event.seq,
        startTs: event.ts,
        title: event.title || event.summary || event.type,
        status: "waiting",
      };
      spans.push(span);
      openWaits.set(key, span);
      continue;
    }
    if (event.type === "confirm_response" || event.type === "clarification_response") {
      const key = `${event.agentId}:${event.type === "confirm_response" ? "confirm" : "clarification"}`;
      const span = openWaits.get(key);
      if (!span) continue;
      span.endEventId = event.eventId;
      span.endSeq = event.seq;
      span.endTs = Math.max(span.startTs, event.ts);
      span.status = "completed";
      openWaits.delete(key);
    }
  }
  if (events.some((event) => event.type === "run_completed")) {
    for (const span of openTools.values()) span.status = "interrupted";
    for (const span of openWaits.values()) span.status = "interrupted";
  }
  return spans;
}

function lanesFor(events: ReplayEvent[], spans: ReplaySpan[]): ReplayLane[] {
  const firstSeq = new Map<string, number>();
  const grouped = new Map<string, ReplayEvent[]>();
  for (const event of events) {
    const agentId = normalizeAgentId(event.agentId);
    if (!firstSeq.has(agentId)) firstSeq.set(agentId, event.seq);
    const rows = grouped.get(agentId) ?? [];
    rows.push(event);
    grouped.set(agentId, rows);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => {
      if (a === "meta") return -1;
      if (b === "meta") return 1;
      return (firstSeq.get(a) ?? 0) - (firstSeq.get(b) ?? 0);
    })
    .map(([agentId, laneEvents]) => ({
      agentId,
      firstSeq: firstSeq.get(agentId) ?? 0,
      events: laneEvents,
      spans: spans.filter((span) => span.agentId === agentId),
    }));
}

export function resolveReplayDuration(events: ReplayEvent[]): number {
  if (events.length < 2) return 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (!Number.isFinite(event.ts)) continue;
    min = Math.min(min, event.ts);
    max = Math.max(max, event.ts);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? Math.max(0, max - min) : 0;
}

export function summarizeRun(events: ReplayEvent[]): ReplayStats {
  const subagentIds = events
    .filter((event) => event.type === "subagent_started")
    .map((event) => {
      for (const key of ["run_id", "subagent_run_id", "agent_id", "avatar_id"]) {
        const value = event.payload?.[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return event.eventId;
    });
  return {
    durationMs: resolveReplayDuration(events),
    rounds: events.filter((event) => event.type === "round_started").length,
    toolCalls: events.filter((event) => event.type === "tool_call").length,
    errors: events.filter((event) => ERROR_TYPES.has(event.type)).length,
    subagents: new Set(subagentIds).size,
    branches: 0,
  };
}

export function visibleEventsAtCursor(events: ReplayEvent[], cursorSeq: number): ReplayEvent[] {
  return events.filter((event) => event.seq <= cursorSeq);
}

export function groupEventsIntoLanes(events: ReplayEvent[]): ReplayLane[] {
  const normalized = stableEvents(events).events;
  return lanesFor(normalized, buildSpans(normalized));
}

export function projectReplay(
  events: ReplayEvent[],
  filters: Set<string> = new Set<ReplayFilter>(["all"]),
): ReplayProjection {
  const normalized = stableEvents(events);
  const spans = buildSpans(normalized.events);
  return {
    events: normalized.events,
    visibleEvents: normalized.events.filter((event) => eventMatchesFilter(event, filters)),
    lanes: lanesFor(normalized.events, spans),
    spans,
    stats: summarizeRun(normalized.events),
    warnings: normalized.warnings,
  };
}
