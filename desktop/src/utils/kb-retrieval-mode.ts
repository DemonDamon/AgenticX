/**
 * Per-session knowledge-base retrieval mode storage.
 *
 * The KB retrieval mode (智能检索 "auto" / 始终检索 "always") used to be a single
 * global value in ~/.agenticx/config.yaml, which meant concurrent sessions
 * clobbered each other's choice when switching panes. This module persists the
 * user's choice keyed by sessionId so each session keeps its own mode. The
 * global config value is only consulted as the default for sessions the user
 * has not explicitly toggled.
 */

export type KbRetrievalMode = "auto" | "always";

const STORAGE_KEY = "agx-kb-retrieval-mode-by-session-v1";

/** Fold legacy/unknown values into the simplified two-state model. */
export function clampKbRetrievalMode(raw: unknown): KbRetrievalMode {
  return raw === "always" ? "always" : "auto";
}

function readMap(): Record<string, KbRetrievalMode> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, KbRetrievalMode> = {};
    for (const [sid, val] of Object.entries(parsed)) {
      const key = String(sid || "").trim();
      if (!key) continue;
      if (val === "auto" || val === "always") out[key] = val;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, KbRetrievalMode>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

/**
 * Return the explicit per-session mode, or null when the session has no stored
 * choice (caller should fall back to the global default for display).
 */
export function getSessionKbRetrievalMode(sessionId: string): KbRetrievalMode | null {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const map = readMap();
  return map[sid] ?? null;
}

/** Persist the per-session mode choice. No-op for empty sessionId. */
export function setSessionKbRetrievalMode(sessionId: string, mode: KbRetrievalMode): void {
  const sid = String(sessionId || "").trim();
  if (!sid) return;
  const map = readMap();
  map[sid] = clampKbRetrievalMode(mode);
  writeMap(map);
}

/** Storage key for a lazy fresh pane before the first send creates a session id. */
export function kbRetrievalPanePendingKey(paneId: string): string {
  return `__pane_pending__:${String(paneId || "").trim()}`;
}

/** Resolve session id or pane-pending key used for read/write. */
export function resolveKbRetrievalStorageKey(sessionId: string, paneId?: string): string | null {
  const sid = String(sessionId || "").trim();
  if (sid) return sid;
  const pid = String(paneId || "").trim();
  if (!pid) return null;
  return kbRetrievalPanePendingKey(pid);
}

export function getKbRetrievalModeForPane(sessionId: string, paneId: string): KbRetrievalMode | null {
  const key = resolveKbRetrievalStorageKey(sessionId, paneId);
  if (!key) return null;
  return getSessionKbRetrievalMode(key);
}

export function setKbRetrievalModeForPane(
  sessionId: string,
  paneId: string,
  mode: KbRetrievalMode,
): void {
  const key = resolveKbRetrievalStorageKey(sessionId, paneId);
  if (!key) return;
  setSessionKbRetrievalMode(key, mode);
}

/** Copy lazy pane choice onto the real session id after createSession. */
export function migratePaneKbRetrievalModeToSession(paneId: string, sessionId: string): void {
  const pid = String(paneId || "").trim();
  const sid = String(sessionId || "").trim();
  if (!pid || !sid) return;
  const pendingKey = kbRetrievalPanePendingKey(pid);
  const pending = getSessionKbRetrievalMode(pendingKey);
  if (!pending) return;
  if (!getSessionKbRetrievalMode(sid)) {
    setSessionKbRetrievalMode(sid, pending);
  }
  const map = readMap();
  delete map[pendingKey];
  writeMap(map);
}
