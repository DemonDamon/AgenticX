import type { Message } from "../store";

export function isThinkingPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^[\s⏳….·.]+$/.test(trimmed);
}

/** Strip model-emitted thinking wrappers before persisting subagent reasoning. */
export function stripThinkingTags(text: string): string {
  return text
    .replace(/<\/?redacted_thinking>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

export const SUBAGENT_LIVE_STATUSES = new Set([
  "running",
  "pending",
  "awaiting_confirm",
  "awaiting_input",
]);

export function isSubAgentLiveStatus(status: string): boolean {
  return SUBAGENT_LIVE_STATUSES.has(status);
}

function lastCommittedAssistantText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    if (m.role === "assistant" && (!m.agentId || m.agentId === "meta")) {
      return String(m.content ?? "").trim();
    }
  }
  return "";
}

/**
 * Hide the synthetic __stream__ row when it would duplicate committed text,
 * or when the stream buffer was cleared for a mid-turn tool gap but SSE is still open.
 */
export function shouldHideStreamOverlay(
  isStreaming: boolean,
  streamText: string,
  visibleMessages: Message[],
): boolean {
  if (!isStreaming) return false;
  const streamTrimmed = streamText.trim();
  const committed = lastCommittedAssistantText(visibleMessages);
  if (!streamTrimmed) {
    return committed.length > 0 && !isThinkingPlaceholderText(committed);
  }
  return committed.length > 0 && committed === streamTrimmed;
}

/** SSE still open but __stream__ row hidden — show mid-turn activity dots elsewhere. */
export function shouldShowMidTurnStreamActivity(
  isStreaming: boolean,
  hideStreamOverlay: boolean,
): boolean {
  return isStreaming && hideStreamOverlay;
}
