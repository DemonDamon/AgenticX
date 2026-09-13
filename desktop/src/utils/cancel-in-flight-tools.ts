import type { Message, ToolCallStatus } from "../store";

export function isInFlightToolStatus(status: Message["toolStatus"]): boolean {
  return status === "running" || status === "pending";
}

function belongsToSession(message: Message, ownerSessionId?: string): boolean {
  if (!ownerSessionId) return true;
  const owned = String(message.ownerSessionId ?? "").trim();
  return !owned || owned === ownerSessionId;
}

export function freezeToolElapsedSeconds(message: Message, now = Date.now()): number {
  if (typeof message.toolElapsedSec === "number" && Number.isFinite(message.toolElapsedSec)) {
    return Math.max(0, Math.floor(message.toolElapsedSec));
  }
  const startedAt = typeof message.timestamp === "number" ? message.timestamp : now;
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function cancelInFlightToolMessages(
  messages: Message[],
  opts?: { ownerSessionId?: string; now?: number },
): { messages: Message[]; cancelledCount: number } {
  const ownerSessionId = String(opts?.ownerSessionId ?? "").trim() || undefined;
  const now = opts?.now ?? Date.now();
  let cancelledCount = 0;
  const next = messages.map((message) => {
    if (message.role !== "tool") return message;
    if (!isInFlightToolStatus(message.toolStatus)) return message;
    if (!belongsToSession(message, ownerSessionId)) return message;
    cancelledCount += 1;
    return {
      ...message,
      toolStatus: "cancelled" as ToolCallStatus,
      toolElapsedSec: freezeToolElapsedSeconds(message, now),
      toolStreamLines: [],
    };
  });
  return { messages: next, cancelledCount };
}
