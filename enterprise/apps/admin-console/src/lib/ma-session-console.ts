export const MA_RANGE_VALUES = ["1d", "7d", "30d", "all"] as const;
export type MaRange = (typeof MA_RANGE_VALUES)[number];
export const MA_SESSION_STATUSES = ["idle", "running", "rescheduling", "terminated", "archived"] as const;
export const MA_SESSION_SOURCES = ["portal", "desktop", "api", "schedule", "channel", "eval"] as const;
export const MA_STOP_REASONS = [
  "end_turn",
  "requires_action",
  "retries_exhausted",
  "refusal",
  "max_tool_rounds",
  "budget_exceeded",
  "policy_blocked",
] as const;
export const IMPLICIT_LOCAL_ENVIRONMENT_ID = "local";
export const MAX_REPLAY_EVENTS = 2000;
export const TOOL_TEXT_PREVIEW_CHARS = 4000;

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DAY_MS = 86_400_000;
const RANGE_DAYS = { "1d": 1, "7d": 7, "30d": 30 } as const;

export type ParsedListQuery = {
  agentId?: string;
  userEmail?: string;
  status?: string;
  source?: string;
  beforeId?: string;
  limit: number;
  createdFrom?: string;
  range: MaRange;
};

export type DurationUnits = { ms: string; s: string; m: string };

export type ReplayUsage = { input: number; output: number; cacheRead: number };

export type ReplayItem =
  | { kind: "status"; seq: number; at: string; status: "running" | "idle" | "terminated"; stopReason: string | null }
  | { kind: "user_message"; seq: number; at: string; text: string; attachments: number }
  | { kind: "agent_message"; seq: number; at: string; text: string }
  | { kind: "thinking"; seq: number; at: string; text: string }
  | {
      kind: "tool";
      seq: number;
      at: string;
      toolType: "builtin" | "mcp" | "custom";
      name: string;
      server: string | null;
      policy: string | null;
      input: unknown;
      result: { seq: number; at: string; text: string; isError: boolean; durationMs: number | null } | null;
      resolution: { seq: number; at: string; result: "allow" | "deny"; message: string | null } | null;
    }
  | {
      kind: "model_request";
      seq: number;
      at: string;
      model: string;
      durationMs: number | null;
      usage: ReplayUsage | null;
      isError: boolean;
    }
  | { kind: "usage"; seq: number; at: string; usage: Record<string, number> }
  | { kind: "error"; seq: number; at: string; errorType: string; message: string; retry: string }
  | { kind: "interrupt"; seq: number; at: string }
  | { kind: "other"; seq: number; at: string; type: string };

type ToolReplay = Extract<ReplayItem, { kind: "tool" }>;
type ModelReplay = Extract<ReplayItem, { kind: "model_request" }>;

export function parseListQuery(params: URLSearchParams, now: Date): ParsedListQuery {
  const agentRaw = blankToUndefined(params.get("agent_id"));
  if (agentRaw !== undefined && !ULID_RE.test(agentRaw)) throw new Error("智能体参数不合法");

  const statusRaw = blankToUndefined(params.get("status"));
  if (statusRaw !== undefined && !isMember(MA_SESSION_STATUSES, statusRaw)) throw new Error("状态参数不合法");

  const sourceRaw = blankToUndefined(params.get("source"));
  if (sourceRaw !== undefined && !isMember(MA_SESSION_SOURCES, sourceRaw)) throw new Error("来源参数不合法");

  const rangeRaw = params.get("range");
  let range: MaRange = "7d";
  if (rangeRaw != null && rangeRaw !== "") {
    if (!isMember(MA_RANGE_VALUES, rangeRaw)) throw new Error("时间范围参数不合法");
    range = rangeRaw;
  }

  const beforeRaw = blankToUndefined(params.get("before_id"));
  if (beforeRaw !== undefined && !ULID_RE.test(beforeRaw)) throw new Error("分页参数不合法");

  const limit = readLimit(params.get("limit"));
  const emailRaw = params.get("user_email");
  const userEmail = emailRaw == null ? "" : emailRaw.trim().toLowerCase();
  const createdFrom = createdFromFor(range, now);

  const parsed: ParsedListQuery = { range, limit };
  if (agentRaw) parsed.agentId = agentRaw;
  if (userEmail) parsed.userEmail = userEmail;
  if (statusRaw) parsed.status = statusRaw;
  if (sourceRaw) parsed.source = sourceRaw;
  if (beforeRaw) parsed.beforeId = beforeRaw;
  if (createdFrom) parsed.createdFrom = createdFrom;
  return parsed;
}

/** 列表 / 详情头部的状态展示键：status=idle 且 stopReason.type=requires_action → "requiresAction"；否则 status 本身。 */
export function displayStatusKey(status: string, stopReason: { type?: unknown } | null): string {
  if (status === "idle" && stopReason?.type === "requires_action") return "requiresAction";
  return status;
}

/** <1000 → "320 毫秒"；<60000 → "1.5 秒"（一位小数，".0" 去掉）；否则 "2 分 5 秒"。负数 / NaN → "—"。 */
export function formatDuration(ms: number | null | undefined, units: DurationUnits): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ${units.ms}`;
  if (ms < 60_000) {
    const text = (ms / 1000).toFixed(1).replace(/\.0$/, "");
    return `${text} ${units.s}`;
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} ${units.m} ${seconds} ${units.s}`;
}

export function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatClockTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function buildReplayTimeline(events: ReadonlyArray<Record<string, unknown>>): ReplayItem[] {
  const sorted = [...events].sort((a, b) => seqOf(a) - seqOf(b));
  const items: ReplayItem[] = [];
  const toolsById = new Map<string, ToolReplay>();
  const openSpans: ModelReplay[] = [];

  for (const event of sorted) {
    const type = typeof event.type === "string" ? event.type : "";
    const seq = seqOf(event);
    const at = atOf(event);
    switch (type) {
      case "session.status_running":
      case "session.status_idle":
      case "session.status_terminated":
        items.push(statusItem(type, event, seq, at));
        break;
      case "user.message": {
        const message = userMessage(event);
        items.push({ kind: "user_message", seq, at, text: message.text, attachments: message.attachments });
        break;
      }
      case "agent.message":
        items.push({ kind: "agent_message", seq, at, text: joinText(event) });
        break;
      case "agent.thinking":
        items.push({ kind: "thinking", seq, at, text: joinText(event) });
        break;
      case "agent.tool_use":
        pushTool(event, "builtin", seq, at, items, toolsById);
        break;
      case "agent.mcp_tool_use":
        pushTool(event, "mcp", seq, at, items, toolsById);
        break;
      case "agent.custom_tool_use":
        pushTool(event, "custom", seq, at, items, toolsById);
        break;
      case "agent.tool_result":
        applyToolResult(event, "tool_use_id", seq, at, items, toolsById);
        break;
      case "agent.mcp_tool_result":
        applyToolResult(event, "mcp_tool_use_id", seq, at, items, toolsById);
        break;
      case "user.custom_tool_result":
        applyToolResult(event, "custom_tool_use_id", seq, at, items, toolsById);
        break;
      case "user.tool_confirmation":
        applyConfirmation(event, seq, at, items, toolsById);
        break;
      case "span.model_request_start": {
        const item: ModelReplay = {
          kind: "model_request",
          seq,
          at,
          model: textField(event.model),
          durationMs: null,
          usage: null,
          isError: false,
        };
        items.push(item);
        openSpans.push(item);
        break;
      }
      case "span.model_request_end":
        closeModelSpan(event, seq, at, items, openSpans);
        break;
      case "session.usage":
        items.push({ kind: "usage", seq, at, usage: numericRecord(event.usage) });
        break;
      case "session.error":
        items.push(errorItem(event, seq, at));
        break;
      case "user.interrupt":
        items.push({ kind: "interrupt", seq, at });
        break;
      default:
        items.push({ kind: "other", seq, at, type });
        break;
    }
  }

  items.sort((a, b) => a.seq - b.seq);
  return items;
}

function createdFromFor(range: MaRange, now: Date): string | undefined {
  switch (range) {
    case "all":
      return undefined;
    case "1d":
    case "7d":
    case "30d":
      return new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS).toISOString();
    default: {
      const _exhaustive: never = range;
      return _exhaustive;
    }
  }
}

function readLimit(raw: string | null): number {
  if (raw == null || raw === "") return 50;
  if (!/^\d+$/.test(raw)) throw new Error("分页参数不合法");
  const n = Number(raw);
  if (n < 1 || n > 200) throw new Error("分页参数不合法");
  return n;
}

function blankToUndefined(value: string | null): string | undefined {
  if (value == null || value === "") return undefined;
  return value;
}

function isMember<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function seqOf(event: Record<string, unknown>): number {
  const n = typeof event.seq === "number" ? event.seq : Number(event.seq);
  return Number.isFinite(n) ? n : 0;
}

function atOf(event: Record<string, unknown>): string {
  return String(event.created_at ?? "");
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function blocksOf(event: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(event.content)) return [];
  return event.content.filter(isRecord);
}

function joinText(event: Record<string, unknown>): string {
  return blocksOf(event)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("\n");
}

function userMessage(event: Record<string, unknown>): { text: string; attachments: number } {
  const texts: string[] = [];
  const docs: string[] = [];
  let attachments = 0;
  for (const block of blocksOf(event)) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
    } else if (block.type === "image") {
      attachments += 1;
    } else if (block.type === "document") {
      const source = isRecord(block.source) ? block.source : null;
      if (source?.type === "text") {
        const title = typeof block.title === "string" ? block.title : "";
        docs.push(`\n[文档] ${title}`);
      } else if (source?.type === "file") {
        attachments += 1;
      }
    }
  }
  return { text: `${texts.join("\n")}${docs.join("")}`, attachments };
}

function durationBetween(startAt: string, endAt: string): number | null {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const delta = end - start;
  return delta < 0 ? null : delta;
}

function statusItem(type: string, event: Record<string, unknown>, seq: number, at: string): ReplayItem {
  const status = type === "session.status_running" ? "running" : type === "session.status_idle" ? "idle" : "terminated";
  let stopReason: string | null = null;
  if (status === "idle") {
    const reason = isRecord(event.stop_reason) ? event.stop_reason : null;
    stopReason = typeof reason?.type === "string" ? reason.type : null;
  }
  return { kind: "status", seq, at, status, stopReason };
}

function pushTool(
  event: Record<string, unknown>,
  toolType: ToolReplay["toolType"],
  seq: number,
  at: string,
  items: ReplayItem[],
  toolsById: Map<string, ToolReplay>,
): void {
  const item: ToolReplay = {
    kind: "tool",
    seq,
    at,
    toolType,
    name: textField(event.name),
    server: toolType === "mcp" && typeof event.mcp_server === "string" ? event.mcp_server : null,
    policy: typeof event.evaluated_policy === "string" ? event.evaluated_policy : null,
    input: event.input,
    result: null,
    resolution: null,
  };
  items.push(item);
  if (typeof event.id === "string" && event.id) toolsById.set(event.id, item);
}

function applyToolResult(
  event: Record<string, unknown>,
  idKey: "tool_use_id" | "mcp_tool_use_id" | "custom_tool_use_id",
  seq: number,
  at: string,
  items: ReplayItem[],
  toolsById: Map<string, ToolReplay>,
): void {
  const ref = typeof event[idKey] === "string" ? event[idKey] : "";
  const tool = ref ? toolsById.get(ref) : undefined;
  if (!tool) {
    items.push({ kind: "other", seq, at, type: textField(event.type) });
    return;
  }
  tool.result = {
    seq,
    at,
    text: joinText(event),
    isError: event.is_error === true,
    durationMs: durationBetween(tool.at, at),
  };
}

function applyConfirmation(
  event: Record<string, unknown>,
  seq: number,
  at: string,
  items: ReplayItem[],
  toolsById: Map<string, ToolReplay>,
): void {
  const ref = typeof event.tool_use_id === "string" ? event.tool_use_id : "";
  const tool = ref ? toolsById.get(ref) : undefined;
  const decision = event.result === "allow" || event.result === "deny" ? event.result : null;
  if (!tool || !decision) {
    items.push({ kind: "other", seq, at, type: textField(event.type) });
    return;
  }
  const message = typeof event.deny_message === "string" ? event.deny_message : null;
  tool.resolution = { seq, at, result: decision, message };
}

function closeModelSpan(
  event: Record<string, unknown>,
  seq: number,
  at: string,
  items: ReplayItem[],
  openSpans: ModelReplay[],
): void {
  const model = textField(event.model);
  const usage = readUsage(event.model_usage);
  const isError = event.is_error === true;
  let matched: ModelReplay | undefined;
  for (let index = openSpans.length - 1; index >= 0; index -= 1) {
    const span = openSpans[index];
    if (span && span.model === model) {
      openSpans.splice(index, 1);
      matched = span;
      break;
    }
  }
  if (!matched) {
    items.push({ kind: "model_request", seq, at, model, durationMs: null, usage, isError });
    return;
  }
  matched.durationMs = durationBetween(matched.at, at);
  matched.usage = usage;
  matched.isError = isError;
}

function readUsage(value: unknown): ReplayUsage {
  const record = isRecord(value) ? value : {};
  return {
    input: countField(record.input_tokens),
    output: countField(record.output_tokens),
    cacheRead: countField(record.cache_read_input_tokens),
  };
}

function countField(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function numericRecord(value: unknown): Record<string, number> {
  const record = isRecord(value) ? value : {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

function errorItem(event: Record<string, unknown>, seq: number, at: string): ReplayItem {
  const info = isRecord(event.error) ? event.error : {};
  const retry = isRecord(info.retry_status) ? info.retry_status : {};
  return {
    kind: "error",
    seq,
    at,
    errorType: textField(info.type),
    message: textField(info.message),
    retry: textField(retry.type),
  };
}
