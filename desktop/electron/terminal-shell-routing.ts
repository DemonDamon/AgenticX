/**
 * Map WorkPanel terminal tab ids to their native shell PTY session ids.
 * Avoids prefix scans that can pick cc-bridge REPL sessions on the same tab.
 */

export const shellTabPtyByTabId = new Map<string, string>();

export function isBridgeTerminalSessionId(sessionId: string): boolean {
  return sessionId.includes(":bridge:");
}

export function registerShellTabPty(tabId: string, sessionId: string): void {
  const tid = tabId.trim();
  const sid = sessionId.trim();
  if (!tid || !sid || isBridgeTerminalSessionId(sid)) return;
  shellTabPtyByTabId.set(tid, sid);
}

export function unregisterShellTabPtyForSession(sessionId: string): void {
  const sid = sessionId.trim();
  if (!sid) return;
  for (const [tabId, registered] of shellTabPtyByTabId.entries()) {
    if (registered === sid) shellTabPtyByTabId.delete(tabId);
  }
}

export function resolveNativeShellPtySessionId(
  tabId: string,
  sessionKinds: ReadonlyMap<string, "pty" | "bridge">,
): string | null {
  const tid = tabId.trim();
  if (!tid) return null;
  const registered = shellTabPtyByTabId.get(tid);
  if (registered && sessionKinds.get(registered) === "pty" && !isBridgeTerminalSessionId(registered)) {
    return registered;
  }
  const prefix = `${tid}:`;
  for (const [id, kind] of sessionKinds.entries()) {
    if (!id.startsWith(prefix) || kind !== "pty" || isBridgeTerminalSessionId(id)) continue;
    return id;
  }
  return null;
}

/** Prefer native shell PTY over cc-bridge when both exist for one tab. */
export function resolveTabWriteSessionId(
  tabId: string,
  sessionKinds: ReadonlyMap<string, "pty" | "bridge">,
  shellOnly: boolean,
): string | null {
  if (shellOnly) return resolveNativeShellPtySessionId(tabId, sessionKinds);
  const prefix = `${tabId.trim()}:`;
  if (!tabId.trim()) return null;
  let bridgeFallback: string | null = null;
  for (const [id, kind] of sessionKinds.entries()) {
    if (!id.startsWith(prefix)) continue;
    if (kind === "pty" && !isBridgeTerminalSessionId(id)) return id;
    if (kind === "bridge") bridgeFallback = id;
  }
  return bridgeFallback;
}
