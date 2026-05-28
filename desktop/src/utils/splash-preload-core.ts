/** Splash-time core data preload helpers (avatars / sessions / taskspaces). */

import type { Avatar, Message, Taskspace } from "../store";
import { useAppStore } from "../store";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "./session-message-map";

const WORKSPACE_STATE_STORAGE_KEY = "agx-workspace-state-v1";

export type SplashPreloadTargets = {
  avatarId?: string;
  sessionId?: string;
};

type PersistedPaneRow = {
  id: string;
  avatarId?: string | null;
  sessionId?: string;
};

function readWorkspaceStateRaw(): unknown {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Resolve active pane avatar/session from persisted workspace before pane hydration. */
export function resolveSplashPreloadTargets(): SplashPreloadTargets {
  const parsed = readWorkspaceStateRaw();
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed as Record<string, unknown>;
  const activePaneId = String(obj.activePaneId ?? "").trim();
  const panesRaw = Array.isArray(obj.panes) ? obj.panes : [];
  const panes = panesRaw
    .map((item): PersistedPaneRow | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? "").trim();
      if (!id) return null;
      const avatarId =
        row.avatarId == null || row.avatarId === undefined
          ? null
          : String(row.avatarId);
      return {
        id,
        avatarId,
        sessionId: String(row.sessionId ?? "").trim() || undefined,
      };
    })
    .filter((item): item is PersistedPaneRow => item !== null);
  const active =
    panes.find((p) => p.id === activePaneId) ?? panes[0] ?? null;
  if (!active) {
    const fallbackSid = String(obj.sessionId ?? "").trim();
    return fallbackSid ? { sessionId: fallbackSid } : {};
  }
  const avatarId = active.avatarId == null ? undefined : String(active.avatarId).trim() || undefined;
  const sessionId = active.sessionId?.trim() || String(obj.sessionId ?? "").trim() || undefined;
  const out: SplashPreloadTargets = {};
  if (avatarId) out.avatarId = avatarId;
  if (sessionId) out.sessionId = sessionId;
  return out;
}

export function avatarPreloadKey(avatarId?: string | null): string {
  return (avatarId ?? "").trim();
}

export type CorePreloadApiResult = {
  ok: boolean;
  avatars: { ok: boolean; avatars: unknown[] };
  sessions: { ok: boolean; sessions: unknown[] };
  taskspaces: { ok: boolean; workspaces: unknown[]; error?: string };
  messages: { ok: boolean; messages: unknown[]; error?: string };
};

export const SPLASH_PRELOAD_OVERALL_MS = 12_000;

type AvatarApiRow = {
  id: string;
  name: string;
  role?: string;
  avatar_url?: string;
  pinned?: boolean;
  created_by?: string;
  system_prompt?: string;
  tools_enabled?: Record<string, boolean>;
  skills_enabled?: Record<string, boolean> | null;
  brains_enabled?: "*" | string[] | null;
  default_provider?: string;
  default_model?: string;
};

/** Map `/api/avatars` rows into store `Avatar` shape. */
export function mapAvatarsFromApi(rows: unknown[]): Avatar[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is AvatarApiRow => !!row && typeof row === "object" && "id" in row)
    .map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role ?? "",
      avatarUrl: a.avatar_url ?? "",
      pinned: Boolean(a.pinned),
      createdBy: a.created_by ?? "manual",
      systemPrompt: a.system_prompt ?? "",
      toolsEnabled: a.tools_enabled ?? {},
      skillsEnabled:
        a.skills_enabled && typeof a.skills_enabled === "object"
          ? { ...a.skills_enabled }
          : undefined,
      brainsEnabled:
        a.brains_enabled === "*"
          ? "*"
          : Array.isArray(a.brains_enabled)
            ? a.brains_enabled.map(String)
            : undefined,
      defaultProvider: a.default_provider ?? "",
      defaultModel: a.default_model ?? "",
    }));
}

export function mapTaskspacesFromApi(rows: unknown[]): Taskspace[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const id = String(item.id ?? "").trim();
      if (!id) return null;
      return {
        id,
        label: String(item.label ?? "").trim() || id,
        path: String(item.path ?? "").trim(),
      };
    })
    .filter((item): item is Taskspace => !!item);
}

/** Apply splash `preload-core-data` IPC result into Zustand store. */
export function applySplashPreloadToStore(
  result: CorePreloadApiResult,
  targets: SplashPreloadTargets
): void {
  const store = useAppStore.getState();
  const sessionsKey = avatarPreloadKey(targets.avatarId ?? null);

  if (result.avatars.ok && Array.isArray(result.avatars.avatars)) {
    store.setAvatars(mapAvatarsFromApi(result.avatars.avatars));
  }

  const bundle: {
    sessionsKey: string;
    sessions: unknown[];
    taskspacesKey?: string;
    taskspaces?: Taskspace[];
  } = {
    sessionsKey,
    sessions: result.sessions.ok && Array.isArray(result.sessions.sessions)
      ? result.sessions.sessions
      : [],
  };

  const sid = String(targets.sessionId ?? "").trim();
  if (sid && result.taskspaces.ok && Array.isArray(result.taskspaces.workspaces)) {
    bundle.taskspacesKey = sid;
    bundle.taskspaces = mapTaskspacesFromApi(result.taskspaces.workspaces);
  }

  store.applyCorePreloadBundle(bundle);

  if (sid && result.messages.ok && Array.isArray(result.messages.messages)) {
    const mapped: Message[] = result.messages.messages.map((item, index) =>
      mapLoadedSessionMessage(item as LoadedSessionMessage, sid, index)
    );
    store.cacheSessionMessages(sid, mapped);
  }
}

/** Run splash preload with overall timeout; safe to call when preload is disabled. */
export async function runSplashCorePreload(): Promise<void> {
  let enabled = true;
  try {
    const flag = await window.agenticxDesktop.getSplashPreloadEnabled();
    enabled = Boolean(flag?.enabled);
  } catch {
    enabled = true;
  }
  if (!enabled) return;

  const targets = resolveSplashPreloadTargets();
  try {
    await window.agenticxDesktop.updateSplashStage("preloading-core");
  } catch {
    // splash may already be closing
  }

  const preloadPromise = window.agenticxDesktop.preloadCoreData(targets);
  const result = await Promise.race([
    preloadPromise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), SPLASH_PRELOAD_OVERALL_MS);
    }),
  ]);

  if (result) {
    applySplashPreloadToStore(result as CorePreloadApiResult, targets);
  } else {
    console.warn("[App init] splash core preload overall timeout");
    useAppStore.getState().applyCorePreloadBundle({
      sessionsKey: avatarPreloadKey(targets.avatarId ?? null),
      sessions: [],
    });
  }
}
