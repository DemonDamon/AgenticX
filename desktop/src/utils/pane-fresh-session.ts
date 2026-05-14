/**
 * Tracks panes where the user explicitly requested a brand-new, empty
 * session (e.g. clicked the "全新对话" button) and is currently awaiting
 * lazy session creation on the next send.
 *
 * This guards against auto-restore effects (WorkspacePanel etc.) that
 * otherwise snap the pane back to the previously-running session —
 * especially problematic when the old session is still streaming, which
 * would cause the next user message to be queued instead of starting a
 * truly fresh session.
 */

const awaitingFreshSessionPanes = new Set<string>();

/** Parent session for `inherit_from_session_id` on the next lazy `createSession` (first send). */
const lazyInheritParentByPane = new Map<string, string>();

export function markPaneAwaitingFreshSession(paneId: string): void {
  if (!paneId) return;
  awaitingFreshSessionPanes.add(paneId);
}

export function clearPaneAwaitingFreshSession(paneId: string): void {
  if (!paneId) return;
  awaitingFreshSessionPanes.delete(paneId);
}

export function isPaneAwaitingFreshSession(paneId: string): boolean {
  if (!paneId) return false;
  return awaitingFreshSessionPanes.has(paneId);
}

export function setPaneLazyInheritParent(paneId: string, parentSessionId?: string): void {
  if (!paneId) return;
  const sid = (parentSessionId || "").trim();
  if (!sid) lazyInheritParentByPane.delete(paneId);
  else lazyInheritParentByPane.set(paneId, sid);
}

export function peekPaneLazyInheritParent(paneId: string): string | undefined {
  if (!paneId) return undefined;
  const sid = lazyInheritParentByPane.get(paneId);
  return sid?.trim() || undefined;
}

export function clearPaneLazyInheritParent(paneId: string): void {
  if (!paneId) return;
  lazyInheritParentByPane.delete(paneId);
}
