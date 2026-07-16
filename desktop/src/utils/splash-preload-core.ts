/** Splash-time core data preload helpers (avatars / sessions / taskspaces). */

import type { Avatar, GroupChat, Message, Taskspace } from "../store";
import { useAppStore } from "../store";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "./session-message-map";
import { prefetchSessionTailsBatch } from "./session-tail-cache";

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
  groups: { ok: boolean; groups: unknown[] };
  taskspaces: { ok: boolean; workspaces: unknown[]; error?: string };
  messages: { ok: boolean; messages: unknown[]; error?: string };
};

/** Keep in sync with `desktop/electron/main.ts` preload budgets. */
export const SPLASH_PRELOAD_READY_BUDGET_MS = 40_000;
export const SPLASH_PRELOAD_FETCH_BUDGET_MS = 10_000;
export const SPLASH_PRELOAD_OVERALL_MS =
  SPLASH_PRELOAD_READY_BUDGET_MS + SPLASH_PRELOAD_FETCH_BUDGET_MS;

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
  color?: string;
  workspace_dir?: string;
  description?: string;
  tags?: string[];
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
      color: typeof a.color === "string" ? a.color : "",
      workspaceDir: a.workspace_dir ?? "",
      description: a.description ?? "",
      tags: Array.isArray(a.tags) ? a.tags.map(String) : [],
    }));
}

/** Map `/api/groups` rows into store `GroupChat` shape. */
export function mapGroupsFromApi(rows: unknown[]): GroupChat[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((g) => ({
      id: String(g.id ?? "").trim(),
      name: String(g.name ?? "").trim() || "群聊",
      avatarIds: Array.isArray(g.avatar_ids)
        ? g.avatar_ids.map((id) => String(id).trim()).filter(Boolean)
        : [],
      routing: String(g.routing ?? "intelligent").trim() || "intelligent",
    }))
    .filter((g) => g.id.length > 0);
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

  if (result.groups.ok && Array.isArray(result.groups.groups)) {
    store.setGroups(mapGroupsFromApi(result.groups.groups));
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

  const preloadedSessions = bundle.sessions;
  if (Array.isArray(preloadedSessions) && preloadedSessions.length > 0) {
    const sessionIds = preloadedSessions
      .map((row) => {
        if (!row || typeof row !== "object") return "";
        return String((row as Record<string, unknown>).session_id ?? "").trim();
      })
      .filter(Boolean)
      .slice(0, 12);
    prefetchSessionTailsBatch(sessionIds, 12);
  }

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
    // Do not mark corePreloadAttempted with empty sessions — that would block
    // App.tsx fallback from refetching after a slow cold start.
    console.warn("[App init] splash core preload overall timeout");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded backoff retry for startup avatar fetch when splash preload missed. */
export async function fetchAvatarsWithStartupRetry(
  listAvatars: () => Promise<{ ok?: boolean; avatars?: unknown[] } | null | undefined>
): Promise<Avatar[]> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await listAvatars();
      if (resp?.ok && Array.isArray(resp.avatars)) {
        return mapAvatarsFromApi(resp.avatars);
      }
    } catch (err) {
      console.warn(`[App init] listAvatars attempt ${attempt + 1} failed:`, err);
    }
    if (attempt < maxAttempts - 1) {
      await sleep(400 * (attempt + 1));
    }
  }
  return [];
}

/** Bounded backoff retry for startup group-chat fetch when splash preload missed.
 *
 * Mirrors ``fetchAvatarsWithStartupRetry``: splash preload's overall race
 * (``SPLASH_PRELOAD_OVERALL_MS``) can time out before a slow backend cold start
 * finishes (e.g. very large ``~/.agenticx/sessions`` / ``taskspaces`` trees), in
 * which case ``applySplashPreloadToStore`` never runs and ``store.groups`` stays
 * empty. Unlike avatars/sessions, groups previously had no App.tsx fallback at
 * all, so a slow cold start left the 群聊 sidebar permanently empty even after
 * the backend became healthy.
 */
export async function fetchGroupsWithStartupRetry(
  listGroups: () => Promise<{ ok?: boolean; groups?: unknown[] } | null | undefined>
): Promise<GroupChat[]> {
  const maxAttempts = 5;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await listGroups();
      if (resp?.ok && Array.isArray(resp.groups)) {
        return mapGroupsFromApi(resp.groups);
      }
    } catch (err) {
      console.warn(`[App init] listGroups attempt ${attempt + 1} failed:`, err);
    }
    if (attempt < maxAttempts - 1) {
      await sleep(400 * (attempt + 1));
    }
  }
  return [];
}

/** Bounded backoff retry for session list fetch at startup. */
export async function fetchSessionsWithStartupRetry(
  listSessions: (avatarId?: string) => Promise<{ ok?: boolean; sessions?: unknown[] } | null | undefined>,
  avatarId?: string
): Promise<unknown[]> {
  const maxAttempts = 4;
  const key = avatarId?.trim() || undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const listed = await listSessions(key);
      if (listed?.ok && Array.isArray(listed.sessions)) {
        return listed.sessions;
      }
    } catch (err) {
      console.warn(`[App init] listSessions attempt ${attempt + 1} failed:`, err);
    }
    if (attempt < maxAttempts - 1) {
      await sleep(400 * (attempt + 1));
    }
  }
  return [];
}
