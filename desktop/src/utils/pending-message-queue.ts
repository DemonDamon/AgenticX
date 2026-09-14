import type { QueuedMessage } from "../store";

/**
 * Return only queued follow-ups owned by the session currently shown in a pane.
 *
 * A pane can retain queued messages while the user navigates between sessions;
 * callers must never render or trigger a continuation from another session.
 */
export function queuedMessagesForSession(
  messages: readonly QueuedMessage[],
  sessionId: string | undefined | null,
): QueuedMessage[] {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return [];
  return messages.filter((message) => String(message.sessionId ?? "").trim() === sid);
}
