/** Resolve the session a send is bound to: explicit lock wins over live pane sid. */
export function resolveSendSessionId(
  lockedSessionId: string | undefined,
  livePaneSessionId: string | undefined,
): string {
  const locked = String(lockedSessionId ?? "").trim();
  if (locked) return locked;
  return String(livePaneSessionId ?? "").trim();
}
