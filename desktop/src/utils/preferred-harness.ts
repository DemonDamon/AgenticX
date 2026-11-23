/**
 * Preferred coding-agent harness (Settings → General Preferences)
 * plus same-session hot-switch helpers.
 *
 * The Settings value seeds NEW chats only. Existing conversations stay
 * sticky to the harness last bound on that session; opening them again
 * restores that binding. The composer picker can still hot-switch the
 * current session (handoff first, metadata rebind fallback).
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

/** True unless the composer picker explicitly pinned a different engine. */
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

export type StickyHarnessPlan = {
  /** undefined = leave the pane harness unset */
  harnessId: string | null | undefined;
  /** External id to write with a plain rebind. No switch boundary. */
  rebindHarnessId?: string;
};

export type SessionHarnessBinding = {
  harnessId: string | null;
  recoveredHarnessId: string | null;
};

/**
 * Existing-session composer harness.
 *
 * Settings preferred is intentionally not an input. A missing session field
 * uses the recovered id (latest message stamp). An explicit pane pin
 * (follow === false) is left alone, except an external pin rebinds the
 * server when the stored field is still empty.
 */
export function planStickyHarnessRestore(input: {
  pinned: boolean;
  paneHarnessId: string | null | undefined;
  serverHarnessId: string | null | undefined;
  recoveredHarnessId?: string | null;
}): StickyHarnessPlan {
  const server =
    input.serverHarnessId === undefined
      ? undefined
      : toStoredPreferredHarnessId(input.serverHarnessId);
  const recovered = input.recoveredHarnessId
    ? toStoredPreferredHarnessId(input.recoveredHarnessId)
    : null;

  if (input.pinned) {
    const pane = toStoredPreferredHarnessId(input.paneHarnessId);
    return {
      harnessId: pane,
      rebindHarnessId: pane && server !== undefined && pane !== server ? pane : undefined,
    };
  }
  if (server) return { harnessId: server };
  if (recovered) return { harnessId: recovered, rebindHarnessId: recovered };
  if (server === null) return { harnessId: null };
  return { harnessId: undefined };
}

export async function readSessionHarnessBinding(
  base: string,
  token: string,
  sessionId: string,
): Promise<SessionHarnessBinding | undefined> {
  const sid = String(sessionId ?? "").trim();
  const root = String(base ?? "").replace(/\/$/, "");
  if (!sid || !root) return undefined;
  const resp = await fetch(`${root}/api/sessions/${encodeURIComponent(sid)}/harness`, {
    headers: token ? { "x-agx-desktop-token": token } : {},
  });
  if (!resp.ok) return undefined;
  const body = (await resp.json()) as {
    harness_id?: string | null;
    recovered_harness_id?: string | null;
  };
  if (!body || typeof body !== "object" || !("harness_id" in body)) return undefined;
  return {
    harnessId: body.harness_id ?? null,
    recoveredHarnessId: body.recovered_harness_id ?? null,
  };
}

export async function resolveStickyPaneHarness(input: {
  pinned: boolean;
  paneHarnessId: string | null | undefined;
  readBinding: () => Promise<SessionHarnessBinding | undefined>;
}): Promise<StickyHarnessPlan> {
  let binding: SessionHarnessBinding | undefined;
  try {
    binding = await input.readBinding();
  } catch {
    binding = undefined;
  }
  if (!binding) {
    if (input.paneHarnessId !== undefined) {
      return { harnessId: toStoredPreferredHarnessId(input.paneHarnessId) };
    }
    return { harnessId: undefined };
  }
  return planStickyHarnessRestore({
    pinned: input.pinned,
    paneHarnessId: input.paneHarnessId,
    serverHarnessId: binding.harnessId,
    recoveredHarnessId: binding.recoveredHarnessId,
  });
}

export async function restorePaneHarnessFromSession(
  paneId: string,
  sessionId: string,
  deps: {
    getPane: () => { harnessId?: string | null; harnessFollowsPreference?: boolean } | undefined;
    readBinding: () => Promise<SessionHarnessBinding | undefined>;
    setPaneHarness: (
      paneId: string,
      harnessId: string | null,
      followPreference?: boolean,
      options?: { preserveModel?: boolean },
    ) => void;
    rebindSessionHarness: (harnessId: string) => Promise<unknown>;
  },
): Promise<void> {
  const sid = String(sessionId ?? "").trim();
  if (!sid || !paneId) return;
  const before = deps.getPane();
  if (!before) return;
  let binding: SessionHarnessBinding | undefined;
  try {
    binding = await deps.readBinding();
  } catch {
    binding = undefined;
  }
  const live = deps.getPane();
  if (!live) return;
  if (
    live.harnessId !== before.harnessId ||
    live.harnessFollowsPreference !== before.harnessFollowsPreference
  ) {
    return;
  }
  if (!binding) return;
  const plan = planStickyHarnessRestore({
    pinned: live.harnessFollowsPreference === false,
    paneHarnessId: live.harnessId,
    serverHarnessId: binding.harnessId,
    recoveredHarnessId: binding.recoveredHarnessId,
  });
  if (plan.harnessId !== undefined) {
    const same =
      toStoredPreferredHarnessId(live.harnessId) === plan.harnessId &&
      live.harnessFollowsPreference === false;
    if (!same) {
      deps.setPaneHarness(paneId, plan.harnessId, false, { preserveModel: true });
    }
  }
  if (plan.rebindHarnessId) {
    await deps.rebindSessionHarness(plan.rebindHarnessId);
  }
}

