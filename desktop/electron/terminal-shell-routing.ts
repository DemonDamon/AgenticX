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

export function resolveRegisteredShellPtySessionId(
  tabId: string,
  sessionKinds: ReadonlyMap<string, "pty" | "bridge">,
): string | null {
  const tid = tabId.trim();
  if (!tid) return null;
  const registered = shellTabPtyByTabId.get(tid);
  if (!registered || isBridgeTerminalSessionId(registered)) return null;
  if (sessionKinds.get(registered) !== "pty") return null;
  return registered;
}

export function resolveNativeShellPtySessionId(
  tabId: string,
  sessionKinds: ReadonlyMap<string, "pty" | "bridge">,
): string | null {
  const registered = resolveRegisteredShellPtySessionId(tabId, sessionKinds);
  if (registered) return registered;
  const tid = tabId.trim();
  if (!tid) return null;
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

/** Block accidental CodeBuddy login snippets on cc-bridge REPL sessions. */
export function isLikelyCodebuddyLoginPayload(data: string): boolean {
  const text = String(data ?? "");
  if (!text.includes("login")) return false;
  return (
    text.includes('"$CB" login')
    || text.includes("& $cb login")
    || text.includes("command -v codebuddy")
    || text.includes("Get-Command codebuddy")
  );
}

/** Refuse bare REPL tokens that collapse from failed shell routing. */
export function isBareCodebuddyReplLoginPayload(data: string): boolean {
  const normalized = String(data ?? "").trim();
  return normalized === "login" || normalized === "login\r" || /^login\r?\n$/i.test(normalized);
}
