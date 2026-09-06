import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAppStore } from "../store";
import {
  buildContextUsageRefreshKey,
  contextUsageMessageSignature,
  formatCategoryTokens,
  formatOccupancyFullLabel,
  formatOccupancyTokenPair,
  shouldDropCachedOccupancy,
  shouldFetchContextUsage,
} from "../utils/context-usage-refresh";
import { HoverTip } from "./ds/HoverTip";

interface SessionCacheUsage {
  session_input_tokens: number;
  session_output_tokens: number;
  session_total_tokens: number;
  session_cached_tokens: number;
  last_input_tokens: number;
  last_cached_tokens: number;
}

interface ContextUsage {
  used_tokens: number;
  max_tokens: number;
  percent: number;
  categories: Record<string, number>;
  cache?: SessionCacheUsage;
  fetchedForSessionId: string;
  fetchedForModel: string;
}

function parseCache(raw: unknown): SessionCacheUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  return {
    session_input_tokens: Number(row.session_input_tokens ?? 0),
    session_output_tokens: Number(row.session_output_tokens ?? 0),
    session_total_tokens: Number(row.session_total_tokens ?? 0),
    session_cached_tokens: Number(row.session_cached_tokens ?? 0),
    last_input_tokens: Number(row.last_input_tokens ?? 0),
    last_cached_tokens: Number(row.last_cached_tokens ?? 0),
  };
}

const CATEGORY_ORDER = [
  "system_prompt",
  "tool_definitions",
  "skills",
  "connectors_and_mcp",
  "subagents",
  "summarized_conversation",
  "messages",
];

const CATEGORY_LABELS: Record<string, string> = {
  system_prompt: "系统提示词",
  tool_definitions: "工具定义",
  skills: "技能",
  connectors_and_mcp: "连接器及 MCP",
  subagents: "子智能体",
  summarized_conversation: "会话摘要",
  messages: "对话消息",
};

const CATEGORY_COLORS: Record<string, string> = {
  system_prompt: "bg-neutral-400",
  tool_definitions: "bg-violet-500",
  skills: "bg-amber-400",
  connectors_and_mcp: "bg-purple-400",
  subagents: "bg-sky-500",
  summarized_conversation: "bg-rose-400",
  messages: "bg-indigo-700",
};

function categoryTokens(categories: Record<string, number>, key: string): number {
  if (key === "tool_definitions" && !Object.hasOwn(categories, "tool_definitions")) {
    return Number(categories.tools_and_subagents ?? 0);
  }
  return Number(categories[key] ?? 0);
}

const CONTEXT_PANEL_WIDTH = 248;
const CONTEXT_PANEL_GUTTER = 12;
const USAGE_CACHE_MAX = 24;
const usageBySession = new Map<string, ContextUsage>();

function usageCacheKey(sessionId: string, model: string): string {
  return `${sessionId}\0${model}`;
}

function readUsageCache(sessionId: string, model: string): ContextUsage | null {
  const exact = usageBySession.get(usageCacheKey(sessionId, model));
  if (exact) return exact;
  for (const row of usageBySession.values()) {
    if (row.fetchedForSessionId === sessionId) return row;
  }
  return null;
}

function writeUsageCache(row: ContextUsage): void {
  usageBySession.set(usageCacheKey(row.fetchedForSessionId, row.fetchedForModel), row);
  while (usageBySession.size > USAGE_CACHE_MAX) {
    const first = usageBySession.keys().next().value;
    if (!first) break;
    usageBySession.delete(first);
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Stroke-dasharray for a ring that starts at 12 o'clock. */
function ringDash(radius: number, percent: number): string {
  const c = 2 * Math.PI * radius;
  const filled = (clampPercent(percent) / 100) * c;
  return `${filled} ${Math.max(0, c - filled)}`;
}

function UsageOccupancyIcon({ occupancy }: { occupancy: number }) {
  const radius = 7.25;
  const show = occupancy > 0.05;
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r={radius}
        stroke="currentColor"
        strokeWidth="1.7"
        opacity={0.22}
      />
      {show ? (
        <circle
          cx="12"
          cy="12"
          r={radius}
          stroke="currentColor"
          strokeWidth="1.85"
          strokeLinecap="round"
          strokeDasharray={ringDash(radius, occupancy)}
          transform="rotate(-90 12 12)"
        />
      ) : null}
    </svg>
  );
}

export function ContextUsageButton({
  paneId,
  sessionId,
  apiBase,
  apiToken,
  isStreaming = false,
}: {
  paneId: string;
  sessionId: string;
  apiBase: string;
  apiToken: string;
  isStreaming?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [panelPos, setPanelPos] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);
  const paneModel = useAppStore((s) => {
    const pane = s.panes.find((item) => item.id === paneId);
    return String(pane?.modelName ?? "").trim();
  });
  const messageCount = useAppStore((s) => {
    const pane = s.panes.find((item) => item.id === paneId);
    return contextUsageMessageSignature(pane?.messages ?? []).messageCount;
  });
  const lastMessageId = useAppStore((s) => {
    const pane = s.panes.find((item) => item.id === paneId);
    return contextUsageMessageSignature(pane?.messages ?? []).lastMessageId;
  });
  const sessionInputTokens = useAppStore((s) => {
    const tokens = s.panes.find((item) => item.id === paneId)?.sessionTokens;
    return tokens?.input ?? 0;
  });
  const sessionOutputTokens = useAppStore((s) => {
    const tokens = s.panes.find((item) => item.id === paneId)?.sessionTokens;
    return tokens?.output ?? 0;
  });
  const refreshKey = buildContextUsageRefreshKey({
    sessionId,
    model: paneModel,
    isStreaming,
    messageCount,
    lastMessageId,
    sessionInputTokens,
    sessionOutputTokens,
  });

  const refreshPanelPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(
      CONTEXT_PANEL_WIDTH,
      Math.max(0, window.innerWidth - CONTEXT_PANEL_GUTTER * 2)
    );
    const maxLeft = Math.max(
      CONTEXT_PANEL_GUTTER,
      window.innerWidth - width - CONTEXT_PANEL_GUTTER
    );
    setPanelPos({
      left: Math.min(Math.max(CONTEXT_PANEL_GUTTER, rect.left), maxLeft),
      bottom: window.innerHeight - rect.top + 8,
      width,
    });
  }, []);

  const fetchUsage = useCallback(async () => {
    if (!sessionId) return;
    const requestSeq = ++requestSeqRef.current;
    const requestedSessionId = sessionId;
    const requestedModel = paneModel;
    setLoadFailed(false);
    try {
      const params = new URLSearchParams({ session_id: requestedSessionId });
      if (requestedModel) params.set("model", requestedModel);
      const res = await fetch(`${apiBase}/api/session/context_usage?${params.toString()}`, {
        headers: { "X-Agx-Desktop-Token": apiToken },
      });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = await res.json();
      if (requestSeq !== requestSeqRef.current) return;
      const returnedSessionId = String(data.session_id ?? requestedSessionId).trim();
      if (returnedSessionId !== requestedSessionId) return;
      const next: ContextUsage = {
        used_tokens: Number(data.used_tokens ?? 0),
        max_tokens: Number(data.max_tokens ?? 0),
        percent: Number(data.percent ?? 0),
        categories: data.categories ?? {},
        cache: parseCache(data.cache),
        fetchedForSessionId: returnedSessionId,
        fetchedForModel: requestedModel,
      };
      writeUsageCache(next);
      setUsage(next);
    } catch {
      if (requestSeq !== requestSeqRef.current) return;
      if (!readUsageCache(requestedSessionId, requestedModel)) {
        setUsage(null);
        setLoadFailed(true);
      }
    }
  }, [apiBase, apiToken, paneModel, sessionId]);

  const toggleOpen = useCallback(() => {
    if (!sessionId) return;
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        refreshPanelPosition();
        void fetchUsage();
      } else {
        requestSeqRef.current += 1;
      }
      return next;
    });
  }, [fetchUsage, refreshPanelPosition, sessionId]);

  useEffect(() => {
    if (!open) return;
    refreshPanelPosition();
    const onResizeOrScroll = () => refreshPanelPosition();
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("resize", onResizeOrScroll);
    window.addEventListener("scroll", onResizeOrScroll, true);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("resize", onResizeOrScroll);
      window.removeEventListener("scroll", onResizeOrScroll, true);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open, refreshPanelPosition]);

  // Restore this session's last payload instantly on switch. Never keep
  // another session's numbers on screen; never blank to "加载中" when we
  // already have a row for the new session. Same-session retry trim and
  // turn settle change refreshKey so occupancy / ledger are fetched again.
  useEffect(() => {
    setLoadFailed(false);
    if (!sessionId) {
      setUsage(null);
      return;
    }
    const cached = readUsageCache(sessionId, paneModel);
    if (
      cached &&
      shouldDropCachedOccupancy({
        sessionInputTokens,
        cachedLedgerInput: cached.cache?.session_input_tokens ?? 0,
      })
    ) {
      setUsage(null);
    } else {
      setUsage(cached);
    }
    if (!shouldFetchContextUsage(isStreaming)) return;
    void fetchUsage();
  }, [fetchUsage, isStreaming, paneModel, refreshKey, sessionId, sessionInputTokens]);

  useEffect(() => {
    if (open && sessionId) refreshPanelPosition();
  }, [open, refreshPanelPosition, sessionId]);

  const visibleUsage = usage && usage.fetchedForSessionId === sessionId ? usage : null;
  const percent = visibleUsage?.percent ?? 0;
  const occupancyLine = visibleUsage
    ? `${formatOccupancyFullLabel(visibleUsage.percent)} · ${formatOccupancyTokenPair(visibleUsage.used_tokens, visibleUsage.max_tokens)}`
    : "上下文用量";
  const hoverLabel = useMemo(() => {
    if (open) return "";
    if (!sessionId) return "上下文用量（会话未就绪）";
    return occupancyLine;
  }, [occupancyLine, open, sessionId]);

  const ariaLabel = useMemo(() => {
    if (!sessionId) return "上下文用量（会话未就绪）";
    return occupancyLine;
  }, [occupancyLine, sessionId]);

  const trigger = (
    <button
      ref={buttonRef}
      type="button"
      data-pane-id={paneId}
      disabled={!sessionId}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-strong transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 ${
        open ? "bg-surface-hover" : ""
      }`}
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={toggleOpen}
    >
      <UsageOccupancyIcon occupancy={percent} />
    </button>
  );

  return (
    <>
      <HoverTip label={hoverLabel}>{trigger}</HoverTip>
      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[100] max-h-[calc(100vh-24px)] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-surface-panel px-3.5 py-3 text-text-primary shadow-lg backdrop-blur-xl"
              style={{ left: panelPos.left, bottom: panelPos.bottom, width: panelPos.width }}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-[13px] font-medium text-text-strong">上下文用量</span>
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center rounded text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
                  onClick={() => setOpen(false)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {loadFailed ? (
                <div className="py-2 text-[12px] text-text-faint">加载失败，请稍后重试</div>
              ) : !visibleUsage ? (
                <div className="py-2 text-[12px] text-text-faint">加载中…</div>
              ) : (
                <>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="text-[13px] font-medium tabular-nums text-text-strong">
                      {formatOccupancyFullLabel(visibleUsage.percent)}
                    </span>
                    <span className="text-[13px] tabular-nums text-text-muted">
                      {formatOccupancyTokenPair(visibleUsage.used_tokens, visibleUsage.max_tokens)}
                    </span>
                  </div>
                  <div className="mb-3 flex h-1 w-full overflow-hidden rounded-full bg-surface-hover">
                    {visibleUsage.max_tokens > 0
                      ? CATEGORY_ORDER.map((key) => {
                          const value = categoryTokens(visibleUsage.categories, key);
                          if (value <= 0) return null;
                          const widthPct = (value / visibleUsage.max_tokens) * 100;
                          return (
                            <div
                              key={key}
                              className={CATEGORY_COLORS[key]}
                              style={{ width: `${widthPct}%` }}
                            />
                          );
                        })
                      : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    {CATEGORY_ORDER.map((key) => (
                      <div key={key} className="flex items-center justify-between text-[13px]">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${CATEGORY_COLORS[key]}`}
                          />
                          <span className="truncate text-text-muted">{CATEGORY_LABELS[key]}</span>
                        </div>
                        <span className="ml-3 tabular-nums text-text-faint">
                          {formatCategoryTokens(categoryTokens(visibleUsage.categories, key))}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
