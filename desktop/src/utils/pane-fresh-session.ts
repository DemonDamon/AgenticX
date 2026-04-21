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
