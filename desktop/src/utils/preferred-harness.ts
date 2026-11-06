/**
 * Preferred coding-agent harness (Settings → General Preferences).
 *
 * The setting is global: new sessions bind to it, and existing sessions
 * rebind on their next user turn so chats can switch Claude Code ↔ CodeBuddy
 * (or back to the builtin runtime) without being stuck on creation-time
 * harness_id.
 */

export const BUILTIN_HARNESS_ID = "python-agent";
export const PREFERRED_HARNESS_STORAGE_KEY = "agx-preferred-harness";

export type SessionHarnessBinder = (payload: {
  sessionId: string;
  harnessId: string | null;
}) => Promise<{ ok: boolean; error?: string }>;

export type SessionHarnessSwitcher = (payload: {
  sessionId: string;
  harnessId: string;
}) => Promise<{ ok: boolean; error?: string }>;

/** Normalize stored preference: empty / builtin → builtin id for UI compare. */
export function normalizePreferredHarnessId(
  raw: string | null | undefined,
): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed || trimmed === BUILTIN_HARNESS_ID) return BUILTIN_HARNESS_ID;
  return trimmed;
}

/** Value stored in zustand / localStorage: null means builtin. */
export function toStoredPreferredHarnessId(
  harnessId: string | null | undefined,
): string | null {
  const trimmed = String(harnessId ?? "").trim();
  if (!trimmed || trimmed === BUILTIN_HARNESS_ID) return null;
  return trimmed;
}

export function loadPreferredHarnessIdFromStorage(): string | null {
  try {
    const saved = window.localStorage.getItem(PREFERRED_HARNESS_STORAGE_KEY);
    return toStoredPreferredHarnessId(saved);
  } catch {
    return null;
  }
}

export function persistPreferredHarnessId(harnessId: string | null): void {
  try {
    const stored = toStoredPreferredHarnessId(harnessId);
    if (stored) window.localStorage.setItem(PREFERRED_HARNESS_STORAGE_KEY, stored);
    else window.localStorage.removeItem(PREFERRED_HARNESS_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

/**
 * Bind the Settings-preferred harness onto a freshly created session.
 * No-op when preference is builtin (server default).
 */
export async function bindPreferredHarnessToSession(
  paneId: string,
  sessionId: string,
  deps: {
    getPreferredHarnessId: () => string | null;
    setPaneHarness: (paneId: string, harnessId: string | null) => void;
    setSessionHarness: SessionHarnessBinder;
  },
): Promise<void> {
  const sid = String(sessionId ?? "").trim();
  if (!sid || !paneId) return;
  const preferred = toStoredPreferredHarnessId(deps.getPreferredHarnessId());
  deps.setPaneHarness(paneId, preferred);
  if (!preferred) return;
  try {
    const resp = await deps.setSessionHarness({
      sessionId: sid,
      harnessId: preferred,
    });
    if (!resp?.ok) {
      // Fail closed to builtin for the new session if bind fails.
      deps.setPaneHarness(paneId, null);
    }
  } catch {
    deps.setPaneHarness(paneId, null);
  }
}

function shouldFallbackToRebind(error?: string): boolean {
  const msg = String(error ?? "").toLowerCase();
  if (!msg) return true;
  if (msg.includes("in flight") || msg.includes("busy")) return false;
  return true;
}

/**
 * Rebind an existing session to the current Settings preference.
 *
 * Uses mid-session switch (context handoff + clean CLI restart) when the
 * bound harness differs. Falls back to a plain metadata rebind if handoff
 * fails, except when a turn is already in flight (fail closed).
 */
export async function ensureSessionFollowsPreferredHarness(
  paneId: string,
  sessionId: string,
  deps: {
    getPreferredHarnessId: () => string | null;
    setPaneHarness: (paneId: string, harnessId: string | null) => void;
    switchSessionHarness: SessionHarnessSwitcher;
    setSessionHarness: SessionHarnessBinder;
  },
): Promise<boolean> {
  const sid = String(sessionId ?? "").trim();
  if (!sid || !paneId) return false;
  const preferred = toStoredPreferredHarnessId(deps.getPreferredHarnessId());
  const target = preferred ?? BUILTIN_HARNESS_ID;

  const applyPane = () => {
    deps.setPaneHarness(paneId, preferred);
  };

  try {
    const switched = await deps.switchSessionHarness({
      sessionId: sid,
      harnessId: target,
    });
    if (switched?.ok) {
      applyPane();
      return true;
    }
    if (!shouldFallbackToRebind(switched?.error)) return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (!shouldFallbackToRebind(message)) return false;
  }

  try {
    const bound = await deps.setSessionHarness({
      sessionId: sid,
      harnessId: preferred,
    });
    if (bound?.ok) {
      applyPane();
      return true;
    }
  } catch {
    // ignore; caller still sends so chat is not hard-blocked
  }
  return false;
}
