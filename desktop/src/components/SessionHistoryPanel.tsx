import { MessageSquareMore } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { useAppStore, type ChatPane, type Message } from "../store";
import { mapLoadedSessionMessage, type LoadedSessionMessage } from "../utils/session-message-map";
import { FitText } from "./ui/FitText";

type Props = {
  pane: ChatPane;
  tintColor?: string;
};

type QueryNavItem = {
  id: string;
  index: number;
  text: string;
  preview: string;
  timestamp?: number;
};

function sanitizeQueryText(input: string): string {
  const raw = String(input || "");
  if (!raw) return "";
  return raw
    .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, "")
    .replace(/<\s*think\s*>/gi, "")
    .replace(/<\s*\/\s*think\s*>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toQueryPreview(text: string, maxLen = 72): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(1, maxLen - 1))}…`;
}

function extractUserQueries(messages: Message[]): QueryNavItem[] {
  const items: QueryNavItem[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = sanitizeQueryText(msg.content || "");
    if (!text) continue;
    const id = String(msg.id || "").trim();
    if (!id || id.startsWith("__")) continue;
    items.push({
      id,
      index: items.length + 1,
      text,
      preview: toQueryPreview(text),
      timestamp: msg.timestamp,
    });
  }
  return items;
}

function queryMatchesSearch(item: QueryNavItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.text.toLowerCase().includes(q) || String(item.index).includes(q);
}

export const SessionHistoryPanel = memo(function SessionHistoryPanel({ pane, tintColor }: Props) {
  const setPaneHistoryJumpMessageId = useAppStore((s) => s.setPaneHistoryJumpMessageId);
  const togglePaneHistory = useAppStore((s) => s.togglePaneHistory);

  const [searchQuery, setSearchQuery] = useState("");
  const [fetchedQueries, setFetchedQueries] = useState<QueryNavItem[] | null>(null);
  const [fetchAttempted, setFetchAttempted] = useState(false);

  const liveQueries = useMemo(
    () => extractUserQueries(pane.messages ?? []),
    [pane.messages]
  );

  // Prefer a full-session snapshot when available (covers paged-out older turns),
  // but fall back to live pane messages so newly sent queries appear instantly.
  const queries = useMemo(() => {
    if (!fetchedQueries || fetchedQueries.length === 0) return liveQueries;
    if (liveQueries.length === 0) return fetchedQueries;
    const byId = new Map<string, QueryNavItem>();
    for (const item of fetchedQueries) byId.set(item.id, item);
    for (const item of liveQueries) byId.set(item.id, item);
    // Keep chronological order: prefer live order when it is a superset/extension,
    // otherwise rebuild from merged map using live-first then fetched-only.
    const liveIds = new Set(liveQueries.map((q) => q.id));
    const onlyFetched = fetchedQueries.filter((q) => !liveIds.has(q.id));
    const merged = [...onlyFetched, ...liveQueries];
    return merged.map((item, idx) => ({ ...item, index: idx + 1 }));
  }, [fetchedQueries, liveQueries]);

  const filteredQueries = useMemo(
    () => queries.filter((item) => queryMatchesSearch(item, searchQuery)),
    [queries, searchQuery]
  );

  useEffect(() => {
    if (!pane.historyOpen) {
      setSearchQuery("");
      setFetchedQueries(null);
      setFetchAttempted(false);
      return;
    }
    const sid = String(pane.sessionId || "").trim();
    if (!sid) {
      setFetchedQueries([]);
      setFetchAttempted(true);
      return;
    }
    let cancelled = false;
    setFetchAttempted(false);
    void (async () => {
      try {
        const result = await window.agenticxDesktop.loadSessionMessages(sid);
        if (cancelled) return;
        if (result.ok && Array.isArray(result.messages)) {
          const mapped = result.messages.map((item, index) =>
            mapLoadedSessionMessage(item as LoadedSessionMessage, sid, index, sid)
          );
          setFetchedQueries(extractUserQueries(mapped));
        } else {
          setFetchedQueries(null);
        }
      } catch {
        if (!cancelled) setFetchedQueries(null);
      } finally {
        if (!cancelled) setFetchAttempted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pane.historyOpen, pane.sessionId]);

  const jumpToQuery = (messageId: string) => {
    const id = String(messageId || "").trim();
    if (!id) return;
    setPaneHistoryJumpMessageId(pane.id, id);
    if (pane.historyOpen) togglePaneHistory(pane.id);
  };

  const showLoading = !fetchAttempted && queries.length === 0;
  const emptyLabel = !pane.sessionId
    ? "当前无会话"
    : searchQuery.trim()
      ? "未找到匹配提问"
      : "本会话还没有提问";

  return (
    <div
      className="agx-session-history-panel flex min-h-0 flex-1 w-full flex-col bg-surface-card"
      style={tintColor ? { backgroundColor: tintColor } : undefined}
    >
      <div className="flex shrink-0 flex-col">
        <div className="flex min-w-0 items-center gap-1 px-3 py-2">
          <div className="min-w-0 flex-1 font-medium text-text-strong">
            <FitText maxSize={13} minSize={10} title="本会话提问">
              本会话提问
            </FitText>
          </div>
          {queries.length > 0 ? (
            <span className="shrink-0 text-[11px] text-text-faint">{queries.length} 轮</span>
          ) : null}
        </div>
        <div className="px-2 pb-1.5">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索提问…"
            autoComplete="off"
            spellCheck={false}
            aria-label="搜索本会话提问"
            className="w-full rounded-md border border-border bg-surface-hover px-2 py-2 text-[13px] text-text-primary placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--ui-btn-primary-border,#3b82f6)]"
          />
        </div>
      </div>
      <div className="agx-session-history-scroll min-h-0 flex-1 overflow-y-auto pl-2 pr-[2px] pb-6 pt-0.5">
        {showLoading ? (
          <div className="space-y-2 px-2 py-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-md bg-surface-hover" />
            ))}
          </div>
        ) : filteredQueries.length === 0 ? (
          <div className="rounded border border-dashed border-border p-3 text-center text-[13px] text-text-faint">
            {emptyLabel}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {filteredQueries.map((item) => {
              const active = pane.historyJumpMessageId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => jumpToQuery(item.id)}
                  title={item.text}
                  className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface-hover ${
                    active ? "bg-surface-card-strong text-text-strong" : "text-text-primary"
                  }`}
                >
                  <MessageSquareMore
                    className="h-3.5 w-3.5 shrink-0 text-text-faint"
                    strokeWidth={1.8}
                  />
                  <span className="shrink-0 tabular-nums text-[11px] text-text-faint">
                    {item.index}.
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-snug">
                    {item.preview}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
