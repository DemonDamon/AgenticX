/**
 * Sync agent artifact paths into the session default workspace via symlinks
 * (no separate「任务产物」taskspace root / no copies into task_artifacts).
 *
 * Author: Damon Li
 */

import type { Taskspace } from "../store";
import { useAppStore } from "../store";
import {
  collectArtifactPathsFromPersistedSessionFiles,
  collectSessionArtifactPaths,
  collectWorkspaceListingArtifactPaths,
  isWalkableWorkspaceArtifactDir,
  parseSessionMessageFilePayload,
} from "./session-artifacts";
import { NEAR_ARTIFACT_TASKSPACES_SYNCED } from "./workspace-sidebar-events";

export const SESSION_TASK_ARTIFACTS_DIRNAME = "task_artifacts";
export const SESSION_TASK_ARTIFACTS_LABEL = "任务产物";

/** Same cadence as WorkspacePanel's default-root listing poll. */
export const WORKSPACE_ARTIFACT_RESYNC_MS = 3000;

export type PersistedArtifactPathResyncOpts = {
  sessionId: string;
  enabled: boolean;
  onPaths: (paths: string[]) => void;
  onError?: (err: unknown) => void;
  load?: (sessionId: string) => Promise<string[]>;
  intervalMs?: number;
};

/**
 * Immediate scan + interval rescan so「任务产物」picks up files written after
 * the first mount (group chat often has no file_write rows).
 */
export function startPersistedArtifactPathResync(
  opts: PersistedArtifactPathResyncOpts,
): () => void {
  const sid = String(opts.sessionId || "").trim();
  if (!sid || !opts.enabled) return () => {};

  let cancelled = false;
  const load = opts.load ?? loadPersistedSessionArtifactPaths;
  const intervalMs = Number.isFinite(opts.intervalMs)
    ? Math.max(0, Number(opts.intervalMs))
    : WORKSPACE_ARTIFACT_RESYNC_MS;

  const run = (): void => {
    void (async () => {
      try {
        const paths = await load(sid);
        if (!cancelled) opts.onPaths(paths);
      } catch (err) {
        if (cancelled) return;
        if (opts.onError) opts.onError(err);
        else opts.onPaths([]);
      }
    })();
  };

  run();
  const timer = globalThis.setInterval(run, intervalMs);
  return () => {
    cancelled = true;
    globalThis.clearInterval(timer);
  };
}

function normalizeRoot(path: string): string {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/** @deprecated Legacy staging dir — kept for prune detection only. */
export function sessionTaskArtifactsDir(sessionId: string): string {
  const sid = String(sessionId || "").trim();
  return `~/.agenticx/sessions/${sid}/${SESSION_TASK_ARTIFACTS_DIRNAME}`;
}

/**
 * Roots previously auto-attached by the naive parent-dir sync /「任务产物」staging
 * that should be removed from the visible taskspace list.
 */
export function shouldPruneAutoArtifactRoot(
  taskspacePath: string,
  opts: {
    sessionId: string;
    stagingDir?: string;
    homeDir?: string;
    label?: string;
  },
): boolean {
  const p = normalizeRoot(taskspacePath);
  if (!p) return false;

  const label = normalizeRoot(opts.label || "");
  if (label === SESSION_TASK_ARTIFACTS_LABEL) return true;

  if (p.endsWith(`/${SESSION_TASK_ARTIFACTS_DIRNAME}`)) return true;

  const staging = normalizeRoot(opts.stagingDir || "");
  if (staging && p === staging) return true;

  if (p === "/tmp" || p === "/private/tmp") return true;

  const home = normalizeRoot(opts.homeDir || "");
  if (home && p === home) return true;

  const sid = String(opts.sessionId || "").trim();
  if (sid) {
    const subResults = normalizeRoot(
      `~/.agenticx/sessions/${sid}/subagent_results`,
    );
    if (p.endsWith(`/.agenticx/sessions/${sid}/subagent_results`)) return true;
    if (p === subResults) return true;
    if (p.endsWith(`/.agenticx/sessions/${sid}/${SESSION_TASK_ARTIFACTS_DIRNAME}`)) {
      return true;
    }
  }
  return false;
}

/**
 * Full chat history + model-context tail, for artifact collection.
 *
 * Do NOT use `readLocalTextFile` for `messages.json`: that IPC caps at 512KB
 * and long sessions (file_write bodies) fail closed →「任务产物」collapses
 * to the tail-only PDF. `loadSessionMessages` reads the same file without
 * that cap.
 */
export async function loadPersistedSessionArtifactPaths(sessionId: string): Promise<string[]> {
  const sid = String(sessionId || "").trim();
  const desktop = window.agenticxDesktop;
  if (!sid || !desktop) return [];

  let chatHistoryRows: unknown[] = [];
  try {
    const full = await desktop.loadSessionMessages?.(sid);
    if (full?.ok && Array.isArray(full.messages)) {
      chatHistoryRows = full.messages;
    }
  } catch {
    chatHistoryRows = [];
  }

  let agentMessageRows: unknown[] = [];
  try {
    const read = desktop.readLocalTextFile;
    if (read) {
      const res = await read(`~/.agenticx/sessions/${sid}/agent_messages.json`);
      if (res?.ok && typeof res.content === "string") {
        agentMessageRows = parseSessionMessageFilePayload(JSON.parse(res.content) as unknown);
      }
    }
  } catch {
    agentMessageRows = [];
  }

  const fromMessages = collectArtifactPathsFromPersistedSessionFiles({
    chatHistoryRows,
    agentMessageRows,
  });
  const fromWorkspace = await loadDefaultWorkspaceArtifactPaths(sid);
  return collectSessionArtifactPaths([], [], [...fromMessages, ...fromWorkspace]);
}

const WORKSPACE_ARTIFACT_MAX_DEPTH = 2;
const WORKSPACE_ARTIFACT_MAX_FILES = 80;

/**
 * Group chat (and some 1:1 turns) write into the session default workspace
 * without persisting file_write rows. Scan that tree so「任务产物」matches
 * what the 工作区 tab already shows.
 */
async function loadDefaultWorkspaceArtifactPaths(sessionId: string): Promise<string[]> {
  const sid = String(sessionId || "").trim();
  const desktop = window.agenticxDesktop;
  if (!sid || !desktop?.listTaskspaces || !desktop.listTaskspaceFiles) return [];

  let root = "";
  try {
    const listed = await desktop.listTaskspaces(sid);
    const defaultTs = (listed?.ok ? listed.workspaces : []).find(
      (item) => String(item?.id || "").trim() === "default",
    );
    root = String(defaultTs?.path || "").trim();
  } catch {
    return [];
  }
  if (!root) return [];

  const paths: string[] = [];
  const seen = new Set<string>();
  const queue: Array<{ rel: string; depth: number }> = [{ rel: ".", depth: 0 }];

  while (queue.length > 0 && paths.length < WORKSPACE_ARTIFACT_MAX_FILES) {
    const item = queue.shift();
    if (!item) break;
    let files: Array<{
      name: string;
      type: string;
      path?: string;
      mount_mode?: string;
    }> = [];
    try {
      const res = await desktop.listTaskspaceFiles({
        sessionId: sid,
        taskspaceId: "default",
        path: item.rel,
      });
      if (!res?.ok || !Array.isArray(res.files)) continue;
      files = res.files;
    } catch {
      continue;
    }

    for (const found of collectWorkspaceListingArtifactPaths({
      workspaceRoot: root,
      entries: files,
    })) {
      if (seen.has(found)) continue;
      seen.add(found);
      paths.push(found);
      if (paths.length >= WORKSPACE_ARTIFACT_MAX_FILES) break;
    }

    if (item.depth >= WORKSPACE_ARTIFACT_MAX_DEPTH) continue;
    for (const entry of files) {
      if (!isWalkableWorkspaceArtifactDir(entry)) continue;
      const nextRel = String(entry.path || entry.name || "").trim();
      if (!nextRel || nextRel === ".") continue;
      queue.push({ rel: nextRel, depth: item.depth + 1 });
    }
  }

  return paths;
}

export type EnsureArtifactTaskspacesResult = {
  ok: boolean;
  added: number;
  pruned: number;
  skipped: number;
  linked?: number;
  defaultDir?: string;
  stagingDir?: string;
  error?: string;
};

/**
 * Symlink artifact files/dirs into the session default workspace and prune
 * leaky / legacy「任务产物」taskspace roots. Notify WorkspacePanel to reload.
 */
export async function ensureArtifactTaskspacesForSession(
  sessionId: string,
  artifactPaths: string[],
  _opts?: { maxTaskspaces?: number },
): Promise<EnsureArtifactTaskspacesResult> {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: false, added: 0, pruned: 0, skipped: 0, error: "missing sessionId" };

  const desktop = window.agenticxDesktop;
  if (!desktop?.listTaskspaces) {
    return { ok: false, added: 0, pruned: 0, skipped: 0, error: "taskspace IPC unavailable" };
  }

  const listed = await desktop.listTaskspaces(sid);
  if (!listed.ok || !Array.isArray(listed.workspaces)) {
    return {
      ok: false,
      added: 0,
      pruned: 0,
      skipped: 0,
      error: listed.error || "listTaskspaces failed",
    };
  }

  let workspaces = listed.workspaces as Taskspace[];
  let pruned = 0;
  const homeDir =
    typeof (window as unknown as { __AGX_HOME__?: string }).__AGX_HOME__ === "string"
      ? String((window as unknown as { __AGX_HOME__?: string }).__AGX_HOME__)
      : "";
  const stagingDir = sessionTaskArtifactsDir(sid);

  if (typeof desktop.removeTaskspace === "function") {
    for (const ts of [...workspaces]) {
      if (ts.id === "default") continue;
      if (
        !shouldPruneAutoArtifactRoot(ts.path, {
          sessionId: sid,
          stagingDir,
          homeDir,
          label: ts.label,
        })
      ) {
        continue;
      }
      const removed = await desktop.removeTaskspace({
        sessionId: sid,
        taskspaceId: ts.id,
      });
      if (removed.ok) {
        pruned += 1;
        workspaces = workspaces.filter((w) => w.id !== ts.id);
      }
    }
  }

  let linked = 0;
  let defaultDir: string | undefined;
  const paths = artifactPaths.map((p) => String(p || "").trim()).filter(Boolean);

  if (paths.length > 0) {
    const linker =
      typeof desktop.linkIntoSessionWorkspace === "function"
        ? desktop.linkIntoSessionWorkspace.bind(desktop)
        : null;
    if (linker) {
      // Auto-sync is visibility-only: never grant write via default mode=link.
      const result = await linker({ sessionId: sid, sources: paths, mode: "reference" });
      if (!result.ok) {
        return {
          ok: false,
          added: 0,
          pruned,
          skipped: 0,
          error: result.error || "linkIntoSessionWorkspace failed",
        };
      }
      linked = Number(result.linked || 0);
      defaultDir = result.defaultDir;
    } else if (typeof desktop.stageSessionArtifacts === "function") {
      const staged = await desktop.stageSessionArtifacts({
        sessionId: sid,
        paths,
      });
      if (!staged.ok) {
        return {
          ok: false,
          added: 0,
          pruned,
          skipped: 0,
          error: staged.error || "stageSessionArtifacts failed",
        };
      }
      linked = Number(staged.linked || 0);
      defaultDir = staged.stagingDir;
    } else {
      return {
        ok: false,
        added: 0,
        pruned,
        skipped: 0,
        error: "linkIntoSessionWorkspace IPC unavailable — 请完全重启桌面端",
      };
    }
  }

  if (linked > 0 || pruned > 0) {
    window.dispatchEvent(
      new CustomEvent(NEAR_ARTIFACT_TASKSPACES_SYNCED, {
        detail: { sessionId: sid, added: linked + pruned },
      }),
    );
  }

  return {
    ok: true,
    added: 0,
    pruned,
    skipped: 0,
    linked,
    defaultDir,
    stagingDir: defaultDir,
  };
}

/**
 * Eager sync for left-sidebar「文件管理」: gather artifact paths and symlink
 * into the session default workspace.
 */
export async function ensureSessionArtifactsFromAvailableSources(
  sessionId: string,
  opts?: { maxTaskspaces?: number },
): Promise<EnsureArtifactTaskspacesResult> {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: false, added: 0, pruned: 0, skipped: 0, error: "missing sessionId" };

  // Always attempt prune of legacy「任务产物」roots even when there are no new paths.
  const store = useAppStore.getState();
  const pane = store.panes.find((p) => String(p.sessionId || "").trim() === sid);
  const messages = pane?.messages ?? [];
  const subAgents = store.subAgents.filter(
    (item) => String(item.sessionId || "").trim() === sid,
  );

  const diskPaths = await loadPersistedSessionArtifactPaths(sid);
  const paths = collectSessionArtifactPaths(messages, subAgents, diskPaths, sid);
  return ensureArtifactTaskspacesForSession(sid, paths, opts);
}
