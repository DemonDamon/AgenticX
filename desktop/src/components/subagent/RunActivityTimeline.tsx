/**
 * Sub-Plan D FR-3 —— 子智能体活动日志时间线：分页拉取 `run/activity`，工具类
 * 条目可展开看 detail；对运行中的 run 定期轮询增量刷新（NFR-2 分页截断）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Wrench, AlertTriangle, MessageSquare } from "lucide-react";
import { fetchSubAgentRunActivity, type RunActivityEntry } from "../../utils/subagent-run-api";

type Props = {
  sessionId: string;
  runId: string;
  /** Polling continues while the owning run is still active. */
  isRunning: boolean;
  apiBase: string;
  apiToken: string;
};

const PAGE_SIZE = 100;
const POLL_INTERVAL_MS = 3000;

function entryIcon(type: string) {
  const t = type.toLowerCase();
  if (t.includes("error") || t.includes("fail")) {
    return <AlertTriangle className="h-3.5 w-3.5 text-[var(--status-error)]" strokeWidth={1.8} />;
  }
  if (t.includes("tool")) {
    return <Wrench className="h-3.5 w-3.5 text-[var(--kb-citation-fg)]" strokeWidth={1.8} />;
  }
  return <MessageSquare className="h-3.5 w-3.5 text-text-faint" strokeWidth={1.8} />;
}

function formatTime(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts * 1000).toLocaleTimeString(undefined, { hour12: false });
  } catch {
    return "";
  }
}

function TimelineRow({ entry }: { entry: RunActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(entry.detail?.trim());
  return (
    <div className="flex gap-2.5 py-1.5">
      <div className="flex w-4 shrink-0 flex-col items-center pt-0.5">
        {entryIcon(entry.type)}
        <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <button
          type="button"
          className={`flex w-full items-start gap-1.5 text-left ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
          onClick={() => hasDetail && setExpanded((v) => !v)}
          disabled={!hasDetail}
        >
          <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-text-primary">{entry.title}</span>
          <span className="shrink-0 font-mono text-[10px] text-text-faint">{formatTime(entry.ts)}</span>
          {hasDetail ? (
            <ChevronDown
              className={`mt-0.5 h-3 w-3 shrink-0 text-text-faint transition-transform ${expanded ? "rotate-180" : ""}`}
              strokeWidth={1.8}
            />
          ) : null}
        </button>
        {expanded && hasDetail ? (
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-card-strong px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-muted">
            {entry.detail}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export function RunActivityTimeline({ sessionId, runId, isRunning, apiBase, apiToken }: Props) {
  const [entries, setEntries] = useState<RunActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const load = useCallback(
    async (nextLimit: number, opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        const res = await fetchSubAgentRunActivity(
          { apiBase, apiToken },
          sessionId,
          runId,
          { offset: 0, limit: nextLimit, order: "asc" },
        );
        setEntries(res.entries);
        setTotal(res.total);
        setError(null);
      } catch (err) {
        if (!opts.silent) setError(String(err));
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [apiBase, apiToken, sessionId, runId],
  );

  useEffect(() => {
    setLimit(PAGE_SIZE);
    void load(PAGE_SIZE);
  }, [load]);

  useEffect(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (!isRunning) return;
    pollTimer.current = window.setInterval(() => {
      void load(limit, { silent: true });
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
    };
  }, [isRunning, limit, load]);

  const loadOlder = useCallback(() => {
    const next = limit + PAGE_SIZE;
    setLimit(next);
    void load(next);
  }, [limit, load]);

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-0.5 py-3 text-[11px] text-text-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        加载活动日志…
      </div>
    );
  }

  if (error && entries.length === 0) {
    return <div className="px-0.5 py-3 text-[11px] text-[var(--status-error)]">{error}</div>;
  }

  if (entries.length === 0) {
    return <div className="px-0.5 py-3 text-[11px] text-text-faint">暂无活动记录</div>;
  }

  return (
    <div className="flex flex-col">
      {entries.length < total ? (
        <button
          type="button"
          className="mb-1 self-start rounded px-1.5 py-0.5 text-[10.5px] text-[var(--kb-citation-fg)] hover:bg-surface-hover"
          onClick={loadOlder}
        >
          加载更早的活动（还有 {total - entries.length} 条）
        </button>
      ) : null}
      {entries.map((entry) => (
        <TimelineRow key={entry.seq} entry={entry} />
      ))}
    </div>
  );
}
