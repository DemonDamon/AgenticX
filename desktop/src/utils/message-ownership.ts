/**
 * Cross-session message ownership invariant.
 *
 * Root cause of the recurring "session A's content shows in session B" bug:
 * `pane.messages` was keyed only by the UI slot (`paneId`), so a message had no
 * record of which session it belonged to. Every guard against cross-session
 * leakage was an ad-hoc `latestSid === sid` check scattered across call sites —
 * miss one path and a foreign message renders under the wrong session.
 *
 * The structural fix: every message carries `ownerSessionId`, and the render
 * layer only shows messages whose owner matches the pane's current session.
 * Even if a stray write lands in `pane.messages` while the pane shows another
 * session, it can never be displayed there.
 */

/** A message-like object that may carry its owning session id. */
export interface OwnedMessage {
  ownerSessionId?: string;
}

/**
 * Whether *msg* may render while the pane is showing *sessionId*.
 *
 * Backward compatible: an untagged message (no `ownerSessionId`) is always
 * visible so legacy / in-flight rows never vanish. When the pane has no bound
 * session (`""`, e.g. awaiting a fresh session), nothing is filtered.
 */
export function messageBelongsToSession(
  msg: OwnedMessage,
  sessionId: string | undefined | null,
): boolean {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return true; // no bound session → never hide
  const owner = String(msg.ownerSessionId ?? "").trim();
  if (!owner) return true; // untagged (legacy / not yet stamped) → show
  return owner === sid;
}

/**
 * Filter a message list down to those that belong to *sessionId*.
 * Pure; preserves order; never mutates the input.
 */
export function visibleMessagesForSession<T extends OwnedMessage>(
  messages: readonly T[],
  sessionId: string | undefined | null,
): T[] {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return messages.slice();
  return messages.filter((m) => messageBelongsToSession(m, sid));
}
