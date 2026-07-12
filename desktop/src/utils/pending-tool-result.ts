import type { Message, MessageToolExtras } from "../store";

export type PendingToolResultPatch = Pick<
  Message,
  "content" | "toolStatus" | "toolResultPreview" | "toolStreamLines"
>;

export type PendingToolResult = {
  callId: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolGroupId?: string;
  patch: PendingToolResultPatch;
};

export type DeferredToolRow = {
  role: Message["role"];
  extras?: MessageToolExtras;
};

export type DeferredToolResultResolution = {
  index: number;
  content: string;
  extras: MessageToolExtras;
};

export function buildDeferredToolResultResolution(
  rows: DeferredToolRow[],
  pending: PendingToolResult,
): DeferredToolResultResolution | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.role !== "tool" || row.extras?.toolCallId !== pending.callId) continue;
    return {
      index,
      content: pending.patch.content,
      extras: {
        ...(row.extras ?? {}),
        ...buildPendingToolFallback(pending),
      },
    };
  }
  return null;
}

export function drainPendingToolResults(
  pendingByCallId: Record<string, PendingToolResult>,
): PendingToolResult[] {
  const entries = Object.entries(pendingByCallId);
  for (const [callId] of entries) delete pendingByCallId[callId];
  return entries.map(([, pending]) => pending);
}

function normalizeSessionId(value: unknown): string {
  return String(value ?? "").replace(/^dlgpoll-/, "").trim();
}

export function matchesToolCallForSession(
  message: Message,
  callId: string,
  sessionId: string,
): boolean {
  const normalizedCallId = String(callId ?? "").trim();
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedCallId || !normalizedSessionId) return false;
  return (
    message.role === "tool"
    && message.toolCallId === normalizedCallId
    && normalizeSessionId(message.ownerSessionId) === normalizedSessionId
  );
}

export function hasMatchingToolCall(
  messages: Message[],
  callId: string,
  sessionId?: string,
): boolean {
  const normalizedCallId = String(callId ?? "").trim();
  if (!normalizedCallId) return false;
  if (sessionId) {
    return messages.some((message) => matchesToolCallForSession(message, normalizedCallId, sessionId));
  }
  return messages.some(
    (message) => message.role === "tool" && message.toolCallId === normalizedCallId,
  );
}

export function resolvePendingToolName(
  metadataName: unknown,
  payloadName: unknown,
  callId: unknown,
): string {
  const explicitName = String(metadataName ?? "").trim() || String(payloadName ?? "").trim();
  if (explicitName) return explicitName;
  const match = /^functions\.([^:]+)(?::\d+)?$/.exec(String(callId ?? "").trim());
  return match?.[1]?.trim() || "unknown_tool";
}

export function buildPendingToolFallback(pending: PendingToolResult): MessageToolExtras {
  const extras: MessageToolExtras = {
    toolCallId: pending.callId,
    toolName: resolvePendingToolName(pending.toolName, "", pending.callId),
    toolStatus: pending.patch.toolStatus,
    toolResultPreview: pending.patch.toolResultPreview,
    toolStreamLines: pending.patch.toolStreamLines,
  };
  if (pending.toolArgs) extras.toolArgs = pending.toolArgs;
  if (pending.toolGroupId) extras.toolGroupId = pending.toolGroupId;
  return extras;
}
