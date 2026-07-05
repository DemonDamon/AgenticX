/**
 * Sub-Plan D FR-3 —— 子智能体活动日志时间线：分页拉取落盘 `run/activity`，
 * 运行中的 run 额外合并内存 `liveEvents`（去重后追加在尾部），随执行实时增长。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Wrench, AlertTriangle, MessageSquare } from "lucide-react";
import type { SubAgentEvent } from "../../store";
import { ACTIVITY_PAGE_SIZE, fetchRunActivityPage, type ActivityEntry } from "./run-drawer-api";

type Props = {
  apiBase: string;
  apiToken: string;
  sessionId: string;
  runId: string;
  /** Polling + live merge only apply while the owning run is still active. */
  isRunning: boolean;
  liveEvents?: SubAgentEvent[];
};

type TimelineItem = ActivityEntry & { source: "persisted" | "live" };

const POLL_INTERVAL_MS = 3000;

/** Readable one-line title for a raw live event (persisted entries already carry a clean title). */
function liveEventTitle(evt: SubAgentEvent): string {
  const oneLine = evt.content.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine || evt.type;
}

/** FR-5: merge persisted (source of truth) with live events, deduping by type/title/second-bucket. */
function mergeTimeline(persisted: ActivityEntry[], liveEvents: SubAgentEvent[]): TimelineItem[] {
  const bucketKey = (type: string, title: string, ts: number) => `${type}|${title}|${Math.floor(ts)}`;
  const persistedKeys = new Set(persisted.map((p) => bucketKey(p.type, p.title, p.ts)));
  const maxSeq = persisted.reduce((m, p) => Math.max(m, p.seq), 0);
  let liveSeq = maxSeq + 1;
  const liveItems: TimelineItem[] = [];
  for (const evt of liveEvents) {
    const title = liveEventTitle(evt);
    if (persistedKeys.has(bucketKey(evt.type, title, evt.ts))) continue;
    liveItems.push({ seq: liveSeq++, ts: evt.ts, type: evt.type, title, detail: evt.content, source: "live" });
  }
  const persistedItems: TimelineItem[] = persisted.map((p) => ({ ...p, source: "persisted" }));
  return [...persistedItems, ...liveItems].sort((a, b) => a.seq - b.seq);
}

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

function TimelineRow({ item }: { item: TimelineItem }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = Boolean(item.detail?.trim());
  return (
    <div className="flex gap-2.5 py-1.5">
      <div className="flex w-4 shrink-0 flex-col items-center pt-0.5">
        {entryIcon(item.type)}
        <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 pb-1">
        <button
          type="button"
          className={`flex w-full items-start gap-1.5 text-left ${hasDetail ? "cursor-pointer" : "cursor-default"}`}
          onClick={() => hasDetail && setExpanded((v) => !v)}
          disabled={!hasDetail}
        >
          <span className="min-w-0 flex-1 text-[12px] leading-relaxed text-text-primary">{item.title}</span>
          <span className="shrink-0 font-mono text-[10px] text-text-faint">{formatTime(item.ts)}</span>
          {hasDetail ? (
            <ChevronDown
              className={`mt-0.5 h-3 w-3 shrink-0 text-text-faint transition-transform ${expanded ? "rotate-180" : ""}`}
              strokeWidth={1.8}
            />
          ) : null}
        </button>
        {expanded && hasDetail ? (
          <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-card-strong px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text-muted">
            {item.detail}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export function RunActivityTimeline({ apiBase, apiToken, sessionId, runId, isRunning, liveEvents }: Props) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextLimit: number, opts: { silent?: boolean } = {}) => {
      if (!apiBase || !apiToken || !sessionId || !runId) return;
      if (!opts.silent) setLoading(true);
      try {
        const res = await fetchRunActivityPage(apiBase, apiToken, sessionId, runId, 0, nextLimit);
        if (!res.ok) {
          if (!opts.silent) setError(res.error || res.detail || "活动日志加载失败");
          return;
        }
        setEntries(res.entries ?? []);
        setTotal(res.total ?? 0);
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
    setLimit(ACTIVITY_PAGE_SIZE);
    void load(ACTIVITY_PAGE_SIZE);
  }, [load]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void load(limit, { silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isRunning, limit, load]);

  const loadOlder = useCallback(() => {
    const next = limit + ACTIVITY_PAGE_SIZE;
    setLimit(next);
    void load(next);
  }, [limit, load]);

  const items = useMemo(
    () => (isRunning ? mergeTimeline(entries, liveEvents ?? []) : entries.map((e) => ({ ...e, source: "persisted" as const }))),
    [entries, liveEvents, isRunning],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-1.5 px-0.5 py-3 text-[11px] text-text-faint">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          加载活动日志…
        </div>
      ) : error && entries.length === 0 ? (
        <div className="px-0.5 py-3 text-[11px] text-[var(--status-error)]">{error}</div>
      ) : items.length === 0 ? (
        <div className="px-0.5 py-3 text-[11px] text-text-faint">暂无活动记录</div>
      ) : (
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
          {items.map((item) => (
            <TimelineRow key={`${item.source}-${item.seq}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
