/**
 * Sync WorkPanel「任务产物」into a session-scoped staging folder (file copies,
 * originals untouched) and attach ONLY that folder as a visible taskspace —
 * never whole `/tmp` or `$HOME`.
 *
 * Author: Damon Li
 */

import type { Taskspace } from "../store";
import { useAppStore } from "../store";
import {
  collectArtifactPathsFromAgentMessages,
  collectSessionArtifactPaths,
} from "./session-artifacts";
import { isTaskspaceAtLimit } from "./taskspace-errors";
import { NEAR_ARTIFACT_TASKSPACES_SYNCED } from "./workspace-sidebar-events";

export const SESSION_TASK_ARTIFACTS_DIRNAME = "task_artifacts";
export const SESSION_TASK_ARTIFACTS_LABEL = "任务产物";

function normalizeRoot(path: string): string {
  return String(path || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/** Session-local staging dir: ~/.agenticx/sessions/<sid>/task_artifacts */
export function sessionTaskArtifactsDir(sessionId: string): string {
  const sid = String(sessionId || "").trim();
  return `~/.agenticx/sessions/${sid}/${SESSION_TASK_ARTIFACTS_DIRNAME}`;
}

/**
 * Roots previously auto-attached by the naive parent-dir sync that leak unrelated
 * files (entire /tmp, home, or the raw subagent_results tree).
 */
export function shouldPruneAutoArtifactRoot(
  taskspacePath: string,
  opts: { sessionId: string; stagingDir: string; homeDir?: string },
): boolean {
  const p = normalizeRoot(taskspacePath);
  if (!p) return false;
  const staging = normalizeRoot(opts.stagingDir);
  if (staging && p === staging) return false;

  if (p === "/tmp" || p === "/private/tmp") return true;

  const home = normalizeRoot(opts.homeDir || "");
  if (home && p === home) return true;

  const sid = String(opts.sessionId || "").trim();
  if (sid) {
    const subResults = normalizeRoot(
      `~/.agenticx/sessions/${sid}/subagent_results`,
    );
    // Compare expanded-style and tilde-style endings.
    if (p.endsWith(`/.agenticx/sessions/${sid}/subagent_results`)) return true;
    if (p === subResults) return true;
  }
  return false;
}

export type EnsureArtifactTaskspacesResult = {
  ok: boolean;
  added: number;
  pruned: number;
  skipped: number;
  stagingDir?: string;
  error?: string;
};

/**
 * Stage artifact files into the session dir, attach that single folder, prune
 * leaky auto-roots (/tmp, $HOME, …), then notify WorkspacePanel to reload.
 */
export async function ensureArtifactTaskspacesForSession(
  sessionId: string,
  artifactPaths: string[],
  opts?: { maxTaskspaces?: number },
): Promise<EnsureArtifactTaskspacesResult> {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: false, added: 0, pruned: 0, skipped: 0, error: "missing sessionId" };
  if (!artifactPaths.length) return { ok: true, added: 0, pruned: 0, skipped: 0 };

  const desktop = window.agenticxDesktop;
  if (!desktop?.listTaskspaces || !desktop?.addTaskspace) {
    return { ok: false, added: 0, pruned: 0, skipped: 0, error: "taskspace IPC unavailable" };
  }
  if (typeof desktop.stageSessionArtifacts !== "function") {
    return {
      ok: false,
      added: 0,
      pruned: 0,
      skipped: 0,
      error: "stageSessionArtifacts IPC unavailable — 请完全重启桌面端",
    };
  }

  const staged = await desktop.stageSessionArtifacts({
    sessionId: sid,
    paths: artifactPaths,
  });
  if (!staged.ok || !staged.stagingDir) {
    return {
      ok: false,
      added: 0,
      pruned: 0,
      skipped: 0,
      error: staged.error || "stageSessionArtifacts failed",
    };
  }

  const stagingDir = staged.stagingDir;
  const stagingNorm = normalizeRoot(stagingDir);
  const homeDir = normalizeRoot(staged.homeDir || "");

  const listed = await desktop.listTaskspaces(sid);
  if (!listed.ok || !Array.isArray(listed.workspaces)) {
    return {
      ok: false,
      added: 0,
      pruned: 0,
      skipped: 0,
      stagingDir,
      error: listed.error || "listTaskspaces failed",
    };
  }

  let workspaces = listed.workspaces as Taskspace[];
  let pruned = 0;

  // Drop leaky auto-roots from the previous parent-dir sync.
  if (typeof desktop.removeTaskspace === "function") {
    for (const ts of [...workspaces]) {
      if (ts.id === "default") continue;
      if (!shouldPruneAutoArtifactRoot(ts.path, { sessionId: sid, stagingDir, homeDir })) {
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

  const maxTaskspaces = Math.max(1, opts?.maxTaskspaces ?? 20);
  const alreadyAttached = workspaces.some(
    (t) => t.id !== "default" && normalizeRoot(t.path) === stagingNorm,
  );

  let added = 0;
  let skipped = 0;

  if (!alreadyAttached) {
    if (isTaskspaceAtLimit(workspaces, maxTaskspaces)) {
      skipped = 1;
    } else {
      const result = await desktop.addTaskspace({
        sessionId: sid,
        path: stagingDir,
        label: SESSION_TASK_ARTIFACTS_LABEL,
      });
      if (result.ok && result.workspace?.id && result.workspace.id !== "default") {
        added = 1;
        workspaces = [...workspaces, result.workspace as Taskspace];
      } else {
        skipped = 1;
      }
    }
  }

  // Only notify UI when the taskspace list actually changed. Re-staging copies
  // (linked > 0) every debounce must NOT refresh — that re-entered setActiveTaskspace
  // via a stale closure and blew the React update depth limit.
  if (added > 0 || pruned > 0) {
    window.dispatchEvent(
      new CustomEvent(NEAR_ARTIFACT_TASKSPACES_SYNCED, {
        detail: { sessionId: sid, added: added + pruned },
      }),
    );
  }

  return { ok: true, added, pruned, skipped, stagingDir };
}

/**
 * Eager sync for left-sidebar「文件管理」: gather artifact paths from the pane
 * store + agent_messages.json, then stage/attach. Prefer this over waiting for
 * WorkPanel's debounced effect so the tree is not empty on first open.
 */
export async function ensureSessionArtifactsFromAvailableSources(
  sessionId: string,
  opts?: { maxTaskspaces?: number },
): Promise<EnsureArtifactTaskspacesResult> {
  const sid = String(sessionId || "").trim();
  if (!sid) return { ok: false, added: 0, pruned: 0, skipped: 0, error: "missing sessionId" };

  const desktop = window.agenticxDesktop;
  if (desktop?.listTaskspaces) {
    const listed = await desktop.listTaskspaces(sid);
    if (listed.ok && Array.isArray(listed.workspaces)) {
      const stagingSuffix = `/.agenticx/sessions/${sid}/${SESSION_TASK_ARTIFACTS_DIRNAME}`;
      const already = listed.workspaces.some((ts) => {
        if (ts.id === "default") return false;
        const p = normalizeRoot(ts.path);
        return (
          p.endsWith(stagingSuffix) ||
          p.endsWith(`/${SESSION_TASK_ARTIFACTS_DIRNAME}`) ||
          normalizeRoot(ts.label) === SESSION_TASK_ARTIFACTS_LABEL
        );
      });
      if (already) {
        return { ok: true, added: 0, pruned: 0, skipped: 0 };
      }
    }
  }

  const store = useAppStore.getState();
  const pane = store.panes.find((p) => String(p.sessionId || "").trim() === sid);
  const messages = pane?.messages ?? [];
  const subAgents = store.subAgents.filter(
    (item) => String(item.sessionId || "").trim() === sid,
  );

  let agentPaths: string[] = [];
  try {
    const read = desktop?.readLocalTextFile;
    if (read) {
      const res = await read(`~/.agenticx/sessions/${sid}/agent_messages.json`);
      if (res?.ok && typeof res.content === "string") {
        const parsed = JSON.parse(res.content) as unknown;
        agentPaths = collectArtifactPathsFromAgentMessages(
          Array.isArray(parsed) ? parsed : [],
        );
      }
    }
  } catch {
    agentPaths = [];
  }

  const paths = collectSessionArtifactPaths(messages, subAgents, agentPaths, sid);
  if (paths.length === 0) {
    return { ok: true, added: 0, pruned: 0, skipped: 0 };
  }
  return ensureArtifactTaskspacesForSession(sid, paths, opts);
}
