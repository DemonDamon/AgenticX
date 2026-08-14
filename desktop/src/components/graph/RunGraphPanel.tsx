import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Share2, X, RefreshCw } from "lucide-react";
import type { ChatPane } from "../../store";
import { useAppStore } from "../../store";
import { GraphInterveneDock } from "./GraphInterveneDock";
import {
  buildInterveneBody,
  EMPTY_PANE_GRAPH_STATE,
  graphHasTaskNodes,
  type GraphNodeSnapshot,
  type InterveneRequest,
} from "./graph-types";
import {
  fetchGraphRun,
  listGraphRunsForSession,
  postGraphIntervene,
  useGraphRunStore,
} from "./useGraphRun";

const RunGraphCanvas = lazy(() =>
  import("./RunGraphCanvas").then((m) => ({ default: m.RunGraphCanvas })),
);

type Props = {
  pane: ChatPane;
  onClose: () => void;
  tintColor?: string | null;
  /** WorkPanel tab: hide duplicate title/close; tab bar owns chrome. */
  embedded?: boolean;
};

export function RunGraphPanel({ pane, onClose, tintColor, embedded = false }: Props) {
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  // Must use a stable empty object — `?? emptyPaneGraphState()` allocates every
  // snapshot and trips React useSyncExternalStore into an infinite update loop.
  const graphState = useGraphRunStore((s) => s.byPane[pane.id] ?? EMPTY_PANE_GRAPH_STATE);
  const applySnapshot = useGraphRunStore((s) => s.applySnapshot);
  const setSelected = useGraphRunStore((s) => s.setSelected);
  const [busy, setBusy] = useState(false);
  const [preferAgentView, setPreferAgentView] = useState(true);
  const [forceBody, setForceBody] = useState<InterveneRequest | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const runId = pane.activeGraphRunId || graphState.runId;

  const setActiveGraphRunId = useCallback(
    (rid: string | null) => {
      useAppStore.setState((s) => ({
        panes: s.panes.map((row) =>
          row.id === pane.id ? { ...row, activeGraphRunId: rid } : row,
        ),
      }));
    },
    [pane.id],
  );

  const refresh = useCallback(async () => {
    if (!apiBase || !apiToken) return;
    try {
      let rid = runId;
      if (!rid && pane.sessionId) {
        const runs = await listGraphRunsForSession(apiBase, apiToken, pane.sessionId);
        rid = runs[0]?.run_id || null;
        if (rid) setActiveGraphRunId(rid);
      }
      if (!rid) return;
      const { run, projection } = await fetchGraphRun(apiBase, apiToken, rid);
      applySnapshot(pane.id, run, projection);
      setBanner(null);
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "加载运行图失败");
    }
  }, [apiBase, apiToken, applySnapshot, pane.id, pane.sessionId, runId, setActiveGraphRunId]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const selectedNodes: GraphNodeSnapshot[] = useMemo(() => {
    const ids = graphState.selectedNodeIds;
    const fromTasks = ids.map((id) => graphState.nodes[id]).filter(Boolean) as GraphNodeSnapshot[];
    const fromAgents = (graphState.projection?.agent_nodes || []).filter((n) => ids.includes(n.id));
    const map = new Map<string, GraphNodeSnapshot>();
    for (const n of [...fromTasks, ...fromAgents]) map.set(n.id, n);
    return [...map.values()];
  }, [graphState.nodes, graphState.projection, graphState.selectedNodeIds]);

  const intervene = useCallback(
    async (body: InterveneRequest): Promise<{ ok: boolean; warnings: string[] }> => {
      if (!apiBase || !apiToken || !runId) return { ok: false, warnings: [] };
      setBusy(true);
      try {
        const res = await postGraphIntervene(apiBase, apiToken, runId, body);
        if (res.status === 409) {
          await refresh();
          setBanner("版本冲突，已刷新图状态，请重试");
          return { ok: false, warnings: ["version_conflict"] };
        }
        if (!res.ok) {
          setBanner(res.error || "干预失败");
          return { ok: false, warnings: [] };
        }
        if (!res.warnings.includes("target_running")) {
          await refresh();
        }
        return { ok: res.ok, warnings: res.warnings };
      } finally {
        setBusy(false);
      }
    },
    [apiBase, apiToken, refresh, runId],
  );

  const hasRun = Boolean(runId && (Object.keys(graphState.nodes).length > 0 || graphState.projection));
  // Presence / H2A·A2A social graphs are already expert nodes — hide the
  // 专家/任务 toggle until a real Workforce task DAG exists.
  const hasTaskNodes = useMemo(
    () => graphHasTaskNodes(graphState.nodes),
    [graphState.nodes],
  );
  // No tasks → show raw presence nodes (includes「你」); with tasks → honor toggle.
  const effectivePreferAgentView = hasTaskNodes ? preferAgentView : false;

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col bg-surface-base"
      style={tintColor ? { backgroundColor: tintColor } : undefined}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2">
        {!embedded ? (
          <>
            <Share2 className="h-4 w-4 shrink-0 text-text-subtle" strokeWidth={1.8} />
            <span className="text-[14px] font-medium text-text-strong">运行图</span>
          </>
        ) : null}
        {hasTaskNodes ? (
          <div
            className={`inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-base p-0.5 ${
              embedded ? "" : "ml-1"
            }`}
          >
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
                preferAgentView
                  ? "bg-[var(--ui-btn-primary-bg)] text-white shadow-sm"
                  : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
              }`}
              onClick={() => setPreferAgentView(true)}
              aria-pressed={preferAgentView}
            >
              专家
            </button>
            <button
              type="button"
              className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition ${
                !preferAgentView
                  ? "bg-[var(--ui-btn-primary-bg)] text-white shadow-sm"
                  : "text-text-subtle hover:bg-surface-hover hover:text-text-strong"
              }`}
              onClick={() => setPreferAgentView(false)}
              aria-pressed={!preferAgentView}
            >
              任务
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className={`rounded-md p-1.5 text-text-subtle hover:bg-surface-hover hover:text-text-strong ${
            !hasTaskNodes && !embedded ? "ml-1" : ""
          }`}
          onClick={() => void refresh()}
          title="刷新"
          aria-label="刷新运行图"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={2} />
        </button>
        {!embedded ? (
          <button
            type="button"
            className="ml-auto rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
            title="关闭运行图"
            aria-label="关闭运行图"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <div className="ml-auto" />
        )}
      </div>

      {banner ? (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-200">
          {banner}
        </div>
      ) : null}

      {hasRun && !hasTaskNodes ? (
        <div className="shrink-0 border-b border-border px-2.5 py-1 text-[10px] leading-snug text-text-faint">
          本轮只有「谁在答」的协作关系；出现可拆解的任务时，这里会显示任务分工与依赖，并支持注入 / 改派。
        </div>
      ) : null}

      {!hasRun ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Share2 className="h-8 w-8 text-text-faint" strokeWidth={1.4} />
          <p className="text-[13px] text-text-subtle">暂无运行图</p>
          <p className="text-[11px] leading-relaxed text-text-faint">
            发送复杂任务或群聊协作后会自动生成。可在此观察专家思考、执行与协同，并做注入 / 改派 / 收敛干预。
          </p>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-[12px] text-text-faint">
                  加载画布…
                </div>
              }
            >
              <RunGraphCanvas
                state={graphState}
                preferAgentView={effectivePreferAgentView}
                onSelectIds={(ids) => setSelected(pane.id, ids)}
                onIntervene={intervene}
                onRequestForceReassign={(body) => setForceBody(body)}
              />
            </Suspense>
          </div>
          <GraphInterveneDock
            version={graphState.version}
            selectedNodes={selectedNodes}
            runStatus={graphState.status}
            busy={busy}
            onIntervene={async (body) => {
              await intervene(body);
            }}
            onPauseRun={async () => {
              await intervene(buildInterveneBody("pause", graphState.version, { payload: { scope: "run" } }));
            }}
            onResumeRun={async () => {
              await intervene(buildInterveneBody("resume", graphState.version, { payload: { scope: "run" } }));
            }}
          />
        </>
      )}

      {forceBody ? (
        <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface-card p-4 shadow-xl">
            <p className="text-[13px] font-medium text-text-strong">中断并改派？</p>
            <p className="mt-1 text-[12px] text-text-subtle">
              目标节点正在运行。确认后将中断当前执行并改派给新专家。
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-[12px] text-text-subtle hover:bg-surface-hover"
                onClick={() => setForceBody(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded px-3 py-1.5 text-[12px] text-white"
                style={{ background: "var(--ui-btn-primary-bg)" }}
                onClick={() => {
                  const body = forceBody;
                  setForceBody(null);
                  void intervene(body);
                }}
              >
                确认改派
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
