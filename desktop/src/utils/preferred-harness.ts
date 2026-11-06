/**
 * Preferred coding-agent harness (Settings → General Preferences)
 * plus same-session hot-switch helpers.
 *
 * The Settings value is the default for new chats. Existing chats can
 * follow that default until the user picks a different engine in the
 * composer, which rebinds *this* session immediately (handoff first,
 * then a plain metadata rebind if handoff fails).
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

/** Sessions follow the Settings default until the composer picker pins them. */
export function paneFollowsPreferredHarness(
  pane: { harnessFollowsPreference?: boolean } | null | undefined,
): boolean {
  return pane?.harnessFollowsPreference !== false;
}

/**
 * Bind a harness onto a freshly created session.
 * `getTargetHarnessId` is usually the pane's current pick (falling back
 * to the Settings default). No-op when the target is builtin.
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
 * Mid-session switch with handoff, falling back to a plain metadata rebind
 * when handoff fails. Does not fall back while a turn is already in flight.
 */
export async function switchSessionHarnessWithFallback(
  sessionId: string,
  targetHarnessId: string | null | undefined,
  deps: {
    switchSessionHarness: SessionHarnessSwitcher;
    setSessionHarness: SessionHarnessBinder;
  },
): Promise<{ ok: boolean; error?: string }> {
  const sid = String(sessionId ?? "").trim();
  if (!sid) return { ok: false, error: "sessionId is required" };
  const preferred = toStoredPreferredHarnessId(targetHarnessId);
  const target = preferred ?? BUILTIN_HARNESS_ID;

  try {
    const switched = await deps.switchSessionHarness({
      sessionId: sid,
      harnessId: target,
    });
    if (switched?.ok) return { ok: true };
    if (!shouldFallbackToRebind(switched?.error)) {
      return { ok: false, error: switched?.error };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (!shouldFallbackToRebind(message)) return { ok: false, error: message };
  }

  try {
    const bound = await deps.setSessionHarness({
      sessionId: sid,
      harnessId: preferred,
    });
    if (bound?.ok) return { ok: true };
    return { ok: false, error: bound?.error };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err ?? ""),
    };
  }
}

/**
 * Rebind an existing session to an explicit target harness (usually the
 * pane's current pick, not necessarily the Settings default).
 */
export async function ensureSessionHarness(
  paneId: string,
  sessionId: string,
  deps: {
    getTargetHarnessId: () => string | null;
    setPaneHarness: (paneId: string, harnessId: string | null) => void;
    switchSessionHarness: SessionHarnessSwitcher;
    setSessionHarness: SessionHarnessBinder;
  },
): Promise<boolean> {
  const sid = String(sessionId ?? "").trim();
  if (!sid || !paneId) return false;
  const preferred = toStoredPreferredHarnessId(deps.getTargetHarnessId());

  const result = await switchSessionHarnessWithFallback(sid, preferred, {
    switchSessionHarness: deps.switchSessionHarness,
    setSessionHarness: deps.setSessionHarness,
  });
  if (result.ok) {
    deps.setPaneHarness(paneId, preferred);
    return true;
  }
  return false;
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
  return ensureSessionHarness(paneId, sessionId, {
    getTargetHarnessId: deps.getPreferredHarnessId,
    setPaneHarness: deps.setPaneHarness,
    switchSessionHarness: deps.switchSessionHarness,
    setSessionHarness: deps.setSessionHarness,
  });
}
