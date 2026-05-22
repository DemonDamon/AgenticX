import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, FolderGit2, RefreshCw, FileText, ListChecks } from "lucide-react";

/**
 * Read-only panel for the Project State Harness.
 *
 * Renders status.json / feature_list.json / progress.md via the Studio API:
 *   - GET /api/projects?session_id=...
 *   - GET /api/projects/status?workspace_root=...
 *   - GET /api/projects/progress?workspace_root=...&tail=N
 *
 * No editing controls — the agent tool chain (project_init / feature_select /
 * feature_complete) is the single writer. This panel exists so the user can
 * see the on-disk state at a glance without leaving Machi.
 */

interface FeatureRow {
  id: string;
  title: string;
  status: string;
  priority: number;
  depends_on?: string[];
  acceptance_criteria?: string[];
}

interface ProjectStatusPayload {
  ok: boolean;
  project_root: string;
  status: {
    project_id?: string | null;
    phase: string;
    active_feature_id?: string | null;
    last_commit_sha?: string | null;
    verify_pass_count: number;
    verify_fail_count: number;
  };
  feature_list: { features: FeatureRow[] };
  counts: {
    total: number;
    pending: number;
    in_progress: number;
    verified: number;
    committed: number;
    skipped: number;
  };
}

interface ProjectListItem {
  workspace_root: string;
  project_root?: string;
  project_id?: string | null;
  phase?: string;
  feature_count?: number;
  error?: string;
}

interface Props {
  apiBaseUrl: string;
  apiToken: string;
  sessionId?: string;
  defaultWorkspaceRoot?: string;
  refreshIntervalMs?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-text-muted",
  in_progress: "text-amber-500",
  verified: "text-sky-500",
  committed: "text-emerald-500",
  skipped: "text-text-muted line-through",
};

export function ProjectStatePanel(props: Props): JSX.Element {
  const { apiBaseUrl, apiToken, sessionId, defaultWorkspaceRoot, refreshIntervalMs = 0 } = props;
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeRoot, setActiveRoot] = useState<string | undefined>(defaultWorkspaceRoot);
  const [status, setStatus] = useState<ProjectStatusPayload | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo(
    () => ({ "x-agx-desktop-token": apiToken }),
    [apiToken]
  );

  const loadProjects = useCallback(async () => {
    setError(null);
    const url = new URL(`${apiBaseUrl}/api/projects`);
    if (sessionId) url.searchParams.set("session_id", sessionId);
    const resp = await fetch(url.toString(), { headers });
    if (!resp.ok) throw new Error(`list projects failed: ${resp.status}`);
    const data = (await resp.json()) as { projects: ProjectListItem[] };
    setProjects(data.projects ?? []);
    if (!activeRoot && data.projects?.length) {
      const first = data.projects.find((p) => !p.error);
      if (first) setActiveRoot(first.workspace_root);
    }
  }, [apiBaseUrl, headers, sessionId, activeRoot]);

  const loadStatus = useCallback(
    async (root: string) => {
      setError(null);
      const statusUrl = new URL(`${apiBaseUrl}/api/projects/status`);
      statusUrl.searchParams.set("workspace_root", root);
      const progressUrl = new URL(`${apiBaseUrl}/api/projects/progress`);
      progressUrl.searchParams.set("workspace_root", root);
      progressUrl.searchParams.set("tail", "100");
      const [s, p] = await Promise.all([
        fetch(statusUrl.toString(), { headers }),
        fetch(progressUrl.toString(), { headers }),
      ]);
      if (!s.ok) throw new Error(`status failed: ${s.status}`);
      if (!p.ok) throw new Error(`progress failed: ${p.status}`);
      setStatus((await s.json()) as ProjectStatusPayload);
      const pj = (await p.json()) as { progress_tail: string[] };
      setProgress(pj.progress_tail ?? []);
    },
    [apiBaseUrl, headers]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadProjects();
      if (activeRoot) await loadStatus(activeRoot);
    } catch (exc) {
      setError(String(exc instanceof Error ? exc.message : exc));
    } finally {
      setLoading(false);
    }
  }, [loadProjects, loadStatus, activeRoot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!refreshIntervalMs) return undefined;
    const handle = window.setInterval(() => void refresh(), refreshIntervalMs);
    return () => window.clearInterval(handle);
  }, [refreshIntervalMs, refresh]);

  const features = status?.feature_list.features ?? [];
  const sortedFeatures = useMemo(
    () => [...features].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100)),
    [features]
  );

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-hidden bg-surface-base p-3 text-sm">
      <div className="flex items-center gap-2">
        <FolderGit2 className="h-4 w-4 text-text-muted" />
        <span className="text-text-strong">项目级 Harness</span>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-card-strong"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          <span>刷新</span>
        </button>
      </div>

      {projects.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <button
              key={p.workspace_root}
              type="button"
              onClick={() => setActiveRoot(p.workspace_root)}
              className={`rounded-md border px-2 py-1 text-xs ${
                p.workspace_root === activeRoot
                  ? "border-accent text-text-strong"
                  : "border-surface-card-strong text-text-muted"
              }`}
              title={p.workspace_root}
            >
              <span className="font-medium">{p.project_id ?? "(unknown)"}</span>
              <span className="ml-2 opacity-70">{p.phase ?? "?"}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-text-muted">未发现 .agx/project；在 feature_loop 模式下让 agent 调用 project_init 奠基。</div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-rose-400">
          {error}
        </div>
      )}

      {status && (
        <div className="grid gap-3 lg:grid-cols-2">
          <section className="flex flex-col gap-2 rounded-md border border-surface-card-strong bg-surface-card p-3">
            <div className="flex items-center gap-2 text-text-strong">
              <ListChecks className="h-4 w-4" />
              <span>功能清单</span>
              <span className="ml-auto text-xs text-text-muted">
                已交付 {status.counts.committed}/{status.counts.total} · 已验证 {status.counts.verified} · 待办 {status.counts.pending}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {sortedFeatures.map((feat) => (
                <li
                  key={feat.id}
                  className={`flex items-baseline gap-2 rounded px-2 py-1 text-xs ${
                    feat.id === status.status.active_feature_id
                      ? "bg-surface-card-strong"
                      : ""
                  }`}
                >
                  <span className={`min-w-[5.5rem] font-mono ${STATUS_COLORS[feat.status] ?? ""}`}>
                    {feat.status}
                  </span>
                  <span className="font-mono text-text-muted">{feat.id}</span>
                  <span className="flex-1 truncate text-text-strong">{feat.title}</span>
                  <span className="text-text-muted">P{feat.priority ?? 100}</span>
                </li>
              ))}
              {!sortedFeatures.length && (
                <li className="text-text-muted">feature_list.json 为空 — 等待 Initializer 阶段。</li>
              )}
            </ul>
            <div className="mt-1 text-xs text-text-muted">
              phase: <span className="font-mono">{status.status.phase}</span>
              {status.status.active_feature_id && (
                <>
                  {"  "}· active: <span className="font-mono">{status.status.active_feature_id}</span>
                </>
              )}
              {status.status.last_commit_sha && (
                <>
                  {"  "}· last commit: <span className="font-mono">{status.status.last_commit_sha.slice(0, 12)}</span>
                </>
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2 rounded-md border border-surface-card-strong bg-surface-card p-3">
            <div className="flex items-center gap-2 text-text-strong">
              <FileText className="h-4 w-4" />
              <span>progress.md</span>
              <span className="ml-auto text-xs text-text-muted">
                pass {status.status.verify_pass_count} / fail {status.status.verify_fail_count}
              </span>
            </div>
            <pre className="min-h-[12rem] flex-1 overflow-auto whitespace-pre-wrap rounded bg-surface-base p-2 font-mono text-xs text-text-muted">
              {progress.length ? progress.join("\n") : "(empty)"}
            </pre>
          </section>
        </div>
      )}
    </div>
  );
}

export default ProjectStatePanel;
