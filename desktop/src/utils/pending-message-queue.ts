import type { QueuedMessage } from "../store";

/** Return only messages owned by the active session; empty/new sessions show none. */
export function queuedMessagesForSession(
  messages: readonly QueuedMessage[],
  sessionId: string | undefined | null,
): QueuedMessage[] {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return [];
  return messages.filter((message) => String(message.sessionId ?? "").trim() === sid);
}
