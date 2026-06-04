/**
 * Pure decision helper for the "one pane shows exactly one session" invariant.
 *
 * When a pane is rebound to a *different, non-empty* session id, the previous
 * session's messages must be wiped so no async path (history switch, 404
 * migration, binding re-bind, automation reuse, etc.) can leave a pane visually
 * merging two sessions. Centralizing this predicate keeps every call site from
 * having to remember to clear messages itself.
 */
export function shouldClearMessagesOnSessionSwitch(
  prevSessionId: string | null | undefined,
  nextSessionId: string | null | undefined,
): boolean {
  const prev = String(prevSessionId ?? "").trim();
  const next = String(nextSessionId ?? "").trim();
  // Only a genuine switch between two distinct real sessions clears messages.
  // Binding the same id (rehydrate / model sync) or the empty -> id lazy-create
  // path must preserve whatever the caller already placed in the pane.
  return next.length > 0 && prev.length > 0 && next !== prev;
}
