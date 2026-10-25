import type { Message, ToolCallStatus } from "../store";
import type {
  MaContentBlock,
  MaPreviewFrame,
  MaSessionStatus,
  MaStopReason,
  MaUsage,
  MaWireEvent,
} from "./ma-types";

export const MA_TOOL_TEXT_LIMIT = 80_000;

export type MaAdapterLabels = {
  retries: string;
  refusal: string;
  policy: string;
  terminated: string;
  customToolPending: string;
  /** Visible copy for max_tool_rounds. The dedicated card needs round numbers the wire event does not carry. */
  rounds: string;
  /** Visible copy for budget_exceeded. The dedicated card needs current/max the wire event does not carry. */
  budget: string;
  confirmQuestion: (tool: string) => string;
};

export type MaAdapterOptions = {
  assistantName: string;
  labels: MaAdapterLabels;
};

export type MaTranscript = {
  sessionId: string;
  lastSeq: number;
  status: MaSessionStatus;
  stopReason: MaStopReason | null;
  rows: Message[];
  toolIndex: Record<string, number>;
  resolved: Record<string, true>;
  pendingReasoning: string;
  liveText: string;
  interrupted: boolean;
  usage: MaUsage | null;
};

export type MaPendingApproval = {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  inputPreview: string;
  createdAt: number | undefined;
};

const STOP_TYPES: readonly MaStopReason["type"][] = [
  "end_turn",
  "requires_action",
  "retries_exhausted",
  "refusal",
  "max_tool_rounds",
  "budget_exceeded",
  "policy_blocked",
];

export function createMaTranscript(sessionId: string): MaTranscript {
  return {
    sessionId,
    lastSeq: 0,
    status: "idle",
    stopReason: null,
    rows: [],
    toolIndex: {},
    resolved: {},
    pendingReasoning: "",
    liveText: "",
    interrupted: false,
    usage: null,
  };
}

export function applyMaEvents(
  transcript: MaTranscript,
  events: readonly MaWireEvent[],
  opts: MaAdapterOptions,
): MaTranscript {
  let next = transcript;
  for (const event of events) {
    if (typeof event?.seq !== "number" || !Number.isFinite(event.seq) || event.seq <= next.lastSeq) {
      continue;
    }
    next = { ...next, lastSeq: event.seq };
    if (typeof event.thread_id === "string" && event.thread_id.length > 0) continue;
    next = applyOne(next, event, opts);
  }
  return next;
}

export function applyMaPreview(transcript: MaTranscript, frame: MaPreviewFrame): MaTranscript {
  switch (frame.type) {
    case "event_start":
      if (frame.event?.type !== "agent.message" || transcript.liveText === "") return transcript;
      return { ...transcript, liveText: "" };
    case "event_delta":
      if (frame.event_type !== "agent.message") return transcript;
      return { ...transcript, liveText: transcript.liveText + frame.content_delta };
    default: {
      const unreachable: never = frame;
      return unreachable;
    }
  }
}

export function markMaApprovalResolved(
  transcript: MaTranscript,
  toolUseId: string,
  result: "allow" | "deny",
): MaTranscript {
  const index = transcript.toolIndex[toolUseId];
  const rows = transcript.rows.slice();
  if (index != null && rows[index]) {
    const { inlineConfirm: _removed, ...rest } = rows[index];
    rows[index] = {
      ...rest,
      toolStatus: result === "deny" ? "cancelled" : "running",
    };
  }
  return {
    ...transcript,
    rows,
    resolved: { ...transcript.resolved, [toolUseId]: true },
  };
}

export function pendingMaApprovals(transcript: MaTranscript): MaPendingApproval[] {
  if (transcript.status !== "requires_action") return [];
  if (!transcript.stopReason || transcript.stopReason.type !== "requires_action") return [];
  const ids = transcript.stopReason.event_ids ?? [];
  const items: MaPendingApproval[] = [];
  for (const toolUseId of ids) {
    if (transcript.resolved[toolUseId]) continue;
    const index = transcript.toolIndex[toolUseId];
    if (index == null) continue;
    const row = transcript.rows[index];
    if (!row) continue;
    const kind = row.metadata?.maKind;
    if (kind !== "tool_use" && kind !== "mcp_tool_use") continue;
    items.push({
      sessionId: transcript.sessionId,
      toolUseId,
      toolName: row.toolName ?? "",
      inputPreview: String(row.content ?? "").slice(0, 200),
      createdAt: row.timestamp,
    });
  }
  return items;
}

export function reconcilePendingUserRows(pending: readonly Message[], rows: readonly Message[]): Message[] {
  const queue = pending.slice();
  for (const row of rows) {
    if (row.role !== "user") continue;
    const text = row.content.trim();
    const index = queue.findIndex((item) => item.content.trim() === text);
    if (index >= 0) queue.splice(index, 1);
  }
  return queue;
}

function applyOne(transcript: MaTranscript, event: MaWireEvent, opts: MaAdapterOptions): MaTranscript {
  switch (event.type) {
    case "user.message":
      return appendRow(transcript, {
        id: rowId(event),
        role: "user",
        content: blocksToText(event.content),
        timestamp: timestampOf(event.created_at),
        ownerSessionId: transcript.sessionId,
      });
    case "agent.thinking": {
      const text = blocksToText(event.content);
      const pendingReasoning = transcript.pendingReasoning
        ? `${transcript.pendingReasoning}\n${text}`
        : text;
      return { ...transcript, pendingReasoning };
    }
    case "agent.message":
      return {
        ...appendRow(transcript, {
          id: rowId(event),
          role: "assistant",
          content: blocksToText(event.content),
          reasoning: transcript.pendingReasoning || undefined,
          avatarName: opts.assistantName,
          agentId: "ma",
          timestamp: timestampOf(event.created_at),
          ownerSessionId: transcript.sessionId,
        }),
        pendingReasoning: "",
        liveText: "",
      };
    case "agent.tool_use":
      return appendToolUse(transcript, event, opts, {
        toolName: stringField(event.name),
        status: "running",
        metadata: {
          maKind: "tool_use",
          maEvaluatedPolicy: event.evaluated_policy,
        },
      });
    case "agent.mcp_tool_use":
      return appendToolUse(transcript, event, opts, {
        toolName: `${stringField(event.mcp_server)}/${stringField(event.name)}`,
        status: "running",
        metadata: {
          maKind: "mcp_tool_use",
          maMcpServer: stringField(event.mcp_server),
          maEvaluatedPolicy: event.evaluated_policy,
        },
      });
    case "agent.custom_tool_use":
      return appendToolUse(transcript, event, opts, {
        toolName: stringField(event.name),
        status: "pending",
        metadata: { maKind: "custom_tool_use", maCustomTool: true },
        toolResultPreview: opts.labels.customToolPending,
      });
    case "agent.tool_result":
      return patchToolResult(transcript, event.tool_use_id, event.content, event.is_error);
    case "agent.mcp_tool_result":
      return patchToolResult(transcript, event.mcp_tool_use_id, event.content, event.is_error);
    case "user.custom_tool_result":
      return patchToolResult(transcript, event.custom_tool_use_id, event.content, event.is_error);
    case "user.tool_confirmation":
      return applyConfirmation(transcript, event);
    case "user.interrupt":
      return { ...transcript, interrupted: true };
    case "session.status_running":
      return { ...transcript, status: "running", stopReason: null, interrupted: false };
    case "session.status_idle":
      return applyIdle(transcript, event, opts);
    case "session.status_terminated":
      return {
        ...appendRow(transcript, systemNoticeRow(transcript, event, opts.labels.terminated, "terminated")),
        status: "terminated",
      };
    case "session.error":
      return appendRow(transcript, errorRow(transcript, event));
    case "session.usage": {
      const usage = asUsage(event.usage);
      return usage ? { ...transcript, usage } : transcript;
    }
    case "span.model_request_start":
    case "span.model_request_end":
      return transcript;
    default:
      return transcript;
  }
}

function applyIdle(transcript: MaTranscript, event: MaWireEvent, opts: MaAdapterOptions): MaTranscript {
  const stopReason = asStopReason(event.stop_reason);
  let next: MaTranscript = {
    ...transcript,
    status: stopReason?.type === "requires_action" ? "requires_action" : "idle",
    stopReason,
    liveText: "",
  };
  if (next.pendingReasoning) {
    next = appendRow(next, {
      id: `ma-${eventIdentity(event)}-r`,
      role: "assistant",
      content: "",
      reasoning: next.pendingReasoning,
      avatarName: opts.assistantName,
      agentId: "ma",
      timestamp: timestampOf(event.created_at),
      ownerSessionId: next.sessionId,
    });
    next = { ...next, pendingReasoning: "" };
  }
  if (stopReason?.type === "requires_action") {
    let rows = next.rows;
    for (const toolUseId of stopReason.event_ids ?? []) {
      if (next.resolved[toolUseId]) continue;
      const index = next.toolIndex[toolUseId];
      if (index == null || !rows[index]) continue;
      const row = rows[index];
      const kind = row.metadata?.maKind;
      if (kind !== "tool_use" && kind !== "mcp_tool_use") continue;
      const toolName = row.toolName ?? "";
      const patched: Message = {
        ...row,
        toolStatus: "pending",
        inlineConfirm: {
          requestId: toolUseId,
          question: opts.labels.confirmQuestion(toolName),
          agentId: "ma",
          sessionId: next.sessionId,
          context: { maManaged: true, toolName },
        },
      };
      if (rows === next.rows) rows = rows.slice();
      rows[index] = patched;
    }
    next = { ...next, rows };
  }
  if (next.interrupted) {
    let rows = next.rows;
    let changed = false;
    const mapped = rows.map((row) => {
      if (row.role === "tool" && (row.toolStatus === "running" || row.toolStatus === "pending")) {
        changed = true;
        return { ...row, toolStatus: "cancelled" as const };
      }
      return row;
    });
    if (changed) next = { ...next, rows: mapped };
  }
  const notice = stopReason ? stopNoticeRow(next, event, stopReason, opts) : null;
  if (notice) next = appendRow(next, notice);
  return next;
}

function stopNoticeRow(
  transcript: MaTranscript,
  event: MaWireEvent,
  stopReason: MaStopReason,
  opts: MaAdapterOptions,
): Message | null {
  const id = `ma-${eventIdentity(event)}-stop`;
  const base = {
    id,
    timestamp: timestampOf(event.created_at),
    ownerSessionId: transcript.sessionId,
  };
  switch (stopReason.type) {
    case "end_turn":
    case "requires_action":
      return null;
    case "max_tool_rounds":
      // MessageRenderer skips BudgetExceededCard unless roundsRound and roundsMax
      // are both present. The wire stop reason has neither, so an empty tool row
      // would fall through to a blank ToolCallCard. Keep noticeKind and also
      // surface the label as a system notice.
      return {
        ...base,
        role: "tool",
        content: opts.labels.rounds,
        noticeKind: "rounds_exhausted",
        systemNotice: true,
        metadata: { maStopReason: stopReason.type },
      };
    case "budget_exceeded":
      return {
        ...base,
        role: "tool",
        content: opts.labels.budget,
        noticeKind: "budget_exceeded",
        budgetSource: "managed",
        systemNotice: true,
        metadata: { maStopReason: stopReason.type },
      };
    case "retries_exhausted":
      return systemNoticeRow(transcript, event, opts.labels.retries, stopReason.type, id);
    case "refusal":
      return systemNoticeRow(transcript, event, opts.labels.refusal, stopReason.type, id);
    case "policy_blocked":
      return systemNoticeRow(transcript, event, opts.labels.policy, stopReason.type, id);
    default: {
      const unreachable: never = stopReason.type;
      return unreachable;
    }
  }
}

function appendToolUse(
  transcript: MaTranscript,
  event: MaWireEvent,
  opts: MaAdapterOptions,
  spec: {
    toolName: string;
    status: ToolCallStatus;
    metadata: Record<string, unknown>;
    toolResultPreview?: string;
  },
): MaTranscript {
  let next = transcript;
  const identity = eventIdentity(event);
  if (next.pendingReasoning) {
    next = appendRow(next, {
      id: `ma-${identity}-r`,
      role: "assistant",
      content: "",
      reasoning: next.pendingReasoning,
      avatarName: opts.assistantName,
      agentId: "ma",
      timestamp: timestampOf(event.created_at),
      ownerSessionId: next.sessionId,
    });
    next = { ...next, pendingReasoning: "" };
  }
  const input = isRecord(event.input) ? event.input : {};
  const content = argsJson(input);
  const last = next.rows[next.rows.length - 1];
  const toolGroupId = last?.role === "tool" && last.toolGroupId ? last.toolGroupId : `ma-group-${identity}`;
  const row: Message = {
    id: `ma-${identity}`,
    role: "tool",
    content,
    toolCallId: identity,
    toolName: spec.toolName,
    toolArgs: input,
    toolStatus: spec.status,
    toolGroupId,
    metadata: spec.metadata,
    timestamp: timestampOf(event.created_at),
    ownerSessionId: next.sessionId,
    ...(spec.toolResultPreview ? { toolResultPreview: spec.toolResultPreview } : {}),
  };
  return {
    ...next,
    rows: [...next.rows, row],
    toolIndex: { ...next.toolIndex, [identity]: next.rows.length },
  };
}

function patchToolResult(
  transcript: MaTranscript,
  toolId: unknown,
  content: unknown,
  isError: unknown,
): MaTranscript {
  if (typeof toolId !== "string" || !toolId) return transcript;
  const index = transcript.toolIndex[toolId];
  if (index == null || !transcript.rows[index]) return transcript;
  const text = limitText(blocksToText(content));
  const rows = transcript.rows.slice();
  rows[index] = {
    ...transcript.rows[index],
    content: text,
    toolStatus: resultStatus(text, isError === true),
    toolResultPreview: preview(text),
    toolStreamLines: [],
  };
  return { ...transcript, rows };
}

function applyConfirmation(transcript: MaTranscript, event: MaWireEvent): MaTranscript {
  const toolId = typeof event.tool_use_id === "string" ? event.tool_use_id : "";
  if (!toolId) return transcript;
  const resolved = { ...transcript.resolved, [toolId]: true as const };
  const index = transcript.toolIndex[toolId];
  if (index == null || !transcript.rows[index]) return { ...transcript, resolved };
  const { inlineConfirm: _removed, ...rest } = transcript.rows[index];
  const nextRow: Message = { ...rest };
  if (event.result === "deny") nextRow.toolStatus = "cancelled";
  else if (event.result === "allow") nextRow.toolStatus = "running";
  const rows = transcript.rows.slice();
  rows[index] = nextRow;
  return { ...transcript, rows, resolved };
}

function errorRow(transcript: MaTranscript, event: MaWireEvent): Message {
  const info = asError(event.error);
  const message = info?.message ?? "";
  const retrying = info?.retry === "retrying";
  return {
    id: rowId(event),
    role: "assistant",
    content: retrying ? `正在重试：${message}` : `⚠️ ${message}`,
    systemNotice: true,
    avatarName: undefined,
    timestamp: timestampOf(event.created_at),
    ownerSessionId: transcript.sessionId,
    metadata: {
      maErrorType: info?.type ?? "",
      retry: info?.retry ?? "",
    },
  };
}

function systemNoticeRow(
  transcript: MaTranscript,
  event: MaWireEvent,
  text: string,
  stopType: string,
  id = rowId(event),
): Message {
  return {
    id,
    role: "assistant",
    content: text,
    systemNotice: true,
    timestamp: timestampOf(event.created_at),
    ownerSessionId: transcript.sessionId,
    metadata: { maStopReason: stopType },
  };
}

function appendRow(transcript: MaTranscript, row: Message): MaTranscript {
  return { ...transcript, rows: [...transcript.rows, row] };
}

function rowId(event: MaWireEvent): string {
  return `ma-${eventIdentity(event)}`;
}

function eventIdentity(event: MaWireEvent): string {
  return typeof event.id === "string" && event.id ? event.id : String(event.seq);
}

export function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    const parsed = asBlock(block);
    if (parsed) parts.push(renderBlock(parsed));
  }
  return parts.join("\n\n");
}

export function argsJson(input: unknown): string {
  let raw = "{}";
  try {
    raw = JSON.stringify(input ?? {});
  } catch {
    raw = "{}";
  }
  return limitText(raw);
}

function renderBlock(block: MaContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
      return "[图片]";
    case "document":
      return renderDocument(block);
    default: {
      const unreachable: never = block;
      return unreachable;
    }
  }
}

function renderDocument(block: Extract<MaContentBlock, { type: "document" }>): string {
  const title = block.title ?? "未命名";
  switch (block.source.type) {
    case "text":
      return `[文档：${title}]\n${block.source.text}`;
    case "file":
      return `[文档：${title}]`;
    default: {
      const unreachable: never = block.source;
      return unreachable;
    }
  }
}

function resultStatus(text: string, isError: boolean): ToolCallStatus {
  if (isError) return "error";
  if (text.startsWith("CANCELLED:")) return "cancelled";
  if (text.startsWith("ERROR:")) return "error";
  return "done";
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function limitText(text: string): string {
  if (text.length > MA_TOOL_TEXT_LIMIT) return `${text.slice(0, MA_TOOL_TEXT_LIMIT)}\n… (truncated)`;
  return text;
}

function timestampOf(iso: unknown): number | undefined {
  if (typeof iso !== "string" || !iso) return undefined;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asBlock(value: unknown): MaContentBlock | null {
  if (!isRecord(value)) return null;
  if (value.type === "text" && typeof value.text === "string") return { type: "text", text: value.text };
  if (value.type === "image") return { type: "image", source: isRecord(value.source) ? value.source : {} };
  if (value.type === "document" && isRecord(value.source)) {
    const title = typeof value.title === "string" || value.title === null ? value.title : undefined;
    if (value.source.type === "text" && typeof value.source.text === "string") {
      return { type: "document", source: { type: "text", text: value.source.text }, title };
    }
    if (value.source.type === "file" && typeof value.source.file_id === "string") {
      return { type: "document", source: { type: "file", file_id: value.source.file_id }, title };
    }
  }
  return null;
}

function asStopReason(value: unknown): MaStopReason | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (!STOP_TYPES.includes(value.type as MaStopReason["type"])) return null;
  const eventIds = Array.isArray(value.event_ids)
    ? value.event_ids.filter((id): id is string => typeof id === "string")
    : [];
  return { type: value.type as MaStopReason["type"], event_ids: eventIds };
}

function asUsage(value: unknown): MaUsage | null {
  if (!isRecord(value)) return null;
  return {
    input_tokens: numberField(value.input_tokens),
    output_tokens: numberField(value.output_tokens),
    cache_read_input_tokens: numberField(value.cache_read_input_tokens),
    tool_calls: numberField(value.tool_calls),
    runtime_ms: numberField(value.runtime_ms),
  };
}

function asError(value: unknown): { type: string; message: string; retry: string } | null {
  if (!isRecord(value)) return null;
  const retryStatus = isRecord(value.retry_status) ? value.retry_status : null;
  return {
    type: typeof value.type === "string" ? value.type : "",
    message: typeof value.message === "string" ? value.message : "",
    retry: retryStatus && typeof retryStatus.type === "string" ? retryStatus.type : "",
  };
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
