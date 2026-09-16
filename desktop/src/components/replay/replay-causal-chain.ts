import { failedToolResult } from "./replay-projection";
import type { ReplayEvent } from "./replay-types";

export type CausalEdgeKind = "recorded" | "inferred";

export type CausalHopReason =
  | "parent_event"
  | "tool_call_id"
  | "wait_pair"
  | "path_in_tool_input"
  | "failed_result_to_error";

export type CausalHop = {
  fromEventId: string;
  toEventId: string;
  kind: CausalEdgeKind;
  reason: CausalHopReason;
};

export type CausalChain = {
  targetEventId: string;
  eventIds: string[];
  hops: CausalHop[];
  inferredCount: number;
};

export type CausalChainMarkdownLabels = {
  heading: string;
  recorded: string;
  inferred: string;
  reasons: Record<CausalHopReason, string>;
  note: string;
};

const MAX_HOPS = 24;
const PATH_PAYLOAD_KEYS = [
  "path",
  "file",
  "filename",
  "artifact_path",
  "output_path",
  "target",
  "arguments_summary",
  "preview",
] as const;
const QUOTED_PATH = /['"`]((?:[A-Za-z]:)?(?:\/|\\)?[\w./\\-]+\.[A-Za-z0-9]{1,8})['"`]/g;
const BARE_PATH = /(?:^|[\s=:{[,])((?:[A-Za-z]:)?(?:\/|\\)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]{1,8})/g;
const TOOL_PAIR_TYPES = new Set(["tool_result", "tool_progress"]);
const ERROR_CHAIN_TYPES = new Set(["error", "stall", "subagent_error"]);
const PATH_EVENT_TYPES = new Set(["tool_call", "tool_result", "artifact"]);
const WAIT_RESPONSE_TO_REQUIRED: Record<string, string> = {
  confirm_response: "confirm_required",
  clarification_response: "clarification_required",
};

type Predecessor = {
  event: ReplayEvent;
  kind: CausalEdgeKind;
  reason: CausalHopReason;
};

function emptyChain(targetEventId: string): CausalChain {
  return {
    targetEventId,
    eventIds: [],
    hops: [],
    inferredCount: 0,
  };
}

function normalizePath(raw: string): string {
  let value = raw.replace(/\\/g, "/").trim();
  if (value.startsWith("./")) value = value.slice(2);
  return value;
}

function collectFromRegex(source: string, regex: RegExp, into: Set<string>): void {
  regex.lastIndex = 0;
  let match = regex.exec(source);
  while (match) {
    const normalized = normalizePath(match[1] ?? "");
    if (normalized) into.add(normalized);
    match = regex.exec(source);
  }
}

export function extractReplayPaths(event: ReplayEvent): string[] {
  const candidates = [event.title, event.summary];
  const payload = event.payload;
  if (payload) {
    for (const key of PATH_PAYLOAD_KEYS) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) candidates.push(value);
    }
  }
  const paths = new Set<string>();
  for (const candidate of candidates) {
    collectFromRegex(candidate, QUOTED_PATH, paths);
    collectFromRegex(candidate, BARE_PATH, paths);
  }
  return [...paths];
}

function pathsIntersect(left: readonly string[], right: readonly string[]): boolean {
  for (const first of left) {
    for (const second of right) {
      if (first === second || first.endsWith(`/${second}`) || second.endsWith(`/${first}`)) {
        return true;
      }
    }
  }
  return false;
}

function isToolPairType(type: string): boolean {
  return TOOL_PAIR_TYPES.has(type) || type.startsWith("subagent_");
}

function findLatestBefore(
  events: ReplayEvent[],
  current: ReplayEvent,
  match: (event: ReplayEvent) => boolean,
): ReplayEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index];
    if (!candidate || candidate.seq >= current.seq) continue;
    if (match(candidate)) return candidate;
  }
  return null;
}

function findPredecessor(
  current: ReplayEvent,
  byId: Map<string, ReplayEvent>,
  ordered: ReplayEvent[],
): Predecessor | null {
  if (current.parentEventId) {
    const parent = byId.get(current.parentEventId);
    if (parent && parent.seq < current.seq) {
      return { event: parent, kind: "recorded", reason: "parent_event" };
    }
  }

  if (isToolPairType(current.type) && current.toolCallId) {
    const toolCall = findLatestBefore(
      ordered,
      current,
      (event) => event.type === "tool_call" && event.toolCallId === current.toolCallId,
    );
    if (toolCall) {
      return { event: toolCall, kind: "recorded", reason: "tool_call_id" };
    }
  }

  if (ERROR_CHAIN_TYPES.has(current.type)) {
    const failed = findLatestBefore(
      ordered,
      current,
      (event) => event.type === "tool_result" && failedToolResult(event),
    );
    if (failed) {
      return { event: failed, kind: "inferred", reason: "failed_result_to_error" };
    }
  }

  const currentPaths = extractReplayPaths(current);
  if (currentPaths.length > 0) {
    const pathSource = findLatestBefore(
      ordered,
      current,
      (event) => (
        PATH_EVENT_TYPES.has(event.type)
        && pathsIntersect(currentPaths, extractReplayPaths(event))
      ),
    );
    if (pathSource) {
      return { event: pathSource, kind: "inferred", reason: "path_in_tool_input" };
    }
  }

  const requiredType = WAIT_RESPONSE_TO_REQUIRED[current.type];
  if (requiredType) {
    const wait = findLatestBefore(
      ordered,
      current,
      (event) => event.type === requiredType && event.agentId === current.agentId,
    );
    if (wait) {
      return { event: wait, kind: "inferred", reason: "wait_pair" };
    }
  }

  return null;
}

export function buildCausalChain(
  events: ReplayEvent[],
  targetEventId: string,
): CausalChain {
  const ordered = [...events].sort((left, right) => (
    left.seq - right.seq || left.eventId.localeCompare(right.eventId)
  ));
  const byId = new Map(ordered.map((event) => [event.eventId, event]));
  const target = byId.get(targetEventId);
  if (!target) return emptyChain(targetEventId);

  const hops: CausalHop[] = [];
  const visited = new Set<string>([target.eventId]);
  let current = target;

  while (hops.length < MAX_HOPS) {
    const predecessor = findPredecessor(current, byId, ordered);
    if (!predecessor || visited.has(predecessor.event.eventId)) break;
    visited.add(predecessor.event.eventId);
    hops.unshift({
      fromEventId: predecessor.event.eventId,
      toEventId: current.eventId,
      kind: predecessor.kind,
      reason: predecessor.reason,
    });
    current = predecessor.event;
  }

  return {
    targetEventId,
    eventIds: [...hops.map((hop) => hop.fromEventId), target.eventId],
    hops,
    inferredCount: hops.filter((hop) => hop.kind === "inferred").length,
  };
}

export function formatCausalChainMarkdown(
  chain: CausalChain,
  events: ReplayEvent[],
  labels: CausalChainMarkdownLabels,
): string {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const target = byId.get(chain.targetEventId);
  const lines = [
    `## ${labels.heading}`,
    "",
    `目标：#${target?.seq ?? "?"} \`${target?.type ?? "unknown"}\` ${target?.title || ""}`.trimEnd(),
    `步数：${chain.eventIds.length} · 推断：${chain.inferredCount}`,
    "",
  ];

  chain.eventIds.forEach((eventId, index) => {
    const event = byId.get(eventId);
    const hop = index > 0 ? chain.hops[index - 1] : undefined;
    const title = event?.title && event.title !== event.type ? event.title : "";
    const base = `${index + 1}. #${event?.seq ?? "?"} \`${event?.type ?? "unknown"}\`${
      title ? ` ${title}` : ""
    }`;
    if (!hop) {
      lines.push(base);
      return;
    }
    const kindLabel = hop.kind === "recorded" ? labels.recorded : labels.inferred;
    lines.push(`${base} — ${kindLabel} · ${labels.reasons[hop.reason]}`);
  });

  lines.push("", labels.note);
  return `${lines.join("\n")}\n`;
}
