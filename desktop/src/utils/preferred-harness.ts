/**
 * Preferred coding-agent harness (Settings → General Preferences).
 * Applies to newly created sessions only — not mid-session handoff.
 */

export const BUILTIN_HARNESS_ID = "python-agent";
export const PREFERRED_HARNESS_STORAGE_KEY = "agx-preferred-harness";

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
 * No-op when preference is builtin (server default). Never used for history open.
 */
export async function bindPreferredHarnessToSession(
  paneId: string,
  sessionId: string,
  deps: {
    getPreferredHarnessId: () => string | null;
    setPaneHarness: (paneId: string, harnessId: string | null) => void;
    setSessionHarness: (payload: {
      sessionId: string;
      harnessId: string | null;
    }) => Promise<{ ok: boolean; error?: string }>;
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
