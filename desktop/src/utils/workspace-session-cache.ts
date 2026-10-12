/**
 * Build session-scoped workspace tree keys and validate async responses.
 *
 * Author: Damon Li
 */

export function workspaceNodeKey(
  sessionId: string,
  taskspaceId: string,
  relPath: string,
): string {
  return `${sessionId}:${taskspaceId}:${relPath || "."}`;
}

export function isCurrentWorkspaceRequest(
  requestSessionId: string,
  currentSessionId: string,
): boolean {
  return String(requestSessionId || "").trim() === String(currentSessionId || "").trim();
}
