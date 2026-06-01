import type { Message } from "../store";

export function isThinkingPlaceholderText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return /^[\s⏳….·.]+$/.test(trimmed);
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
