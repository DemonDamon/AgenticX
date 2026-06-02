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
