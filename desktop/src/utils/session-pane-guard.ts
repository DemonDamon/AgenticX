/** Minimal pane shape for async session-switch stale guards. */
export type PaneSessionLike = {
  id: string;
  sessionId?: string | null;
};

export function normalizeSessionId(sessionId: string | null | undefined): string {
  return String(sessionId ?? "").trim();
}

export function getPaneSessionId(
  panes: readonly PaneSessionLike[],
  paneId: string,
): string {
  const pane = panes.find((p) => p.id === paneId);
  return normalizeSessionId(pane?.sessionId);
}

/** True when the pane still displays the session an async load was started for. */
export function isPaneStillOnSession(
  panes: readonly PaneSessionLike[],
  paneId: string,
  sessionId: string,
): boolean {
  return getPaneSessionId(panes, paneId) === normalizeSessionId(sessionId);
}
