export function shouldKeepWorkspaceVisibleWhenSessionMissing(
  sessionId: string,
  awaitingFreshSession: boolean
): boolean {
  return sessionId.trim().length === 0 && awaitingFreshSession;
}
