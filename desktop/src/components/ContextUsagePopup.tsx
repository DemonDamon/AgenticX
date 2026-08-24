import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAppStore } from "../store";
import { formatHitPercent } from "../utils/cache-hit";
import { HoverTip } from "./ds/HoverTip";

interface SessionCacheUsage {
  session_input_tokens: number;
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
    session_cached_tokens: Number(row.session_cached_tokens ?? 0),
    last_input_tokens: Number(row.last_input_tokens ?? 0),
    last_cached_tokens: Number(row.last_cached_tokens ?? 0),
  };
}

const CATEGORY_ORDER = [
  "system_prompt",
  "tools_and_subagents",
  "messages",
  "connectors_and_mcp",
  "skills",
];

const CATEGORY_LABELS: Record<string, string> = {
  system_prompt: "系统提示词",
  tools_and_subagents: "工具及子智能体",
  messages: "对话消息",
  connectors_and_mcp: "连接器及MCP",
  skills: "技能",
};

const CATEGORY_COLORS: Record<string, string> = {
  system_prompt: "bg-emerald-500",
  tools_and_subagents: "bg-amber-500",
  messages: "bg-indigo-500",
  connectors_and_mcp: "bg-cyan-500",
  skills: "bg-violet-500",
};

const CONTEXT_PANEL_WIDTH = 300;
const CONTEXT_PANEL_GUTTER = 12;

function formatK(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
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

function UsageDualRingIcon({
  occupancy,
  hit,
}: {
  occupancy: number;
  hit: number | null;
}) {
  const outerR = 9;
  const innerR = 5.35;
  const showOuter = occupancy > 0.05;
  const showInner = hit !== null && hit > 0.05;
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r={outerR}
        stroke="currentColor"
        strokeWidth="1.45"
        opacity={0.22}
      />
      {showOuter ? (
        <circle
          cx="12"
          cy="12"
          r={outerR}
          stroke="currentColor"
          strokeWidth="1.65"
          strokeLinecap="round"
          strokeDasharray={ringDash(outerR, occupancy)}
          transform="rotate(-90 12 12)"
        />
      ) : null}
      <circle
        cx="12"
        cy="12"
        r={innerR}
        className="stroke-emerald-400 [html[data-theme=light]_&]:stroke-emerald-500"
        strokeWidth="2.35"
        opacity={0.22}
      />
      {showInner ? (
        <circle
          cx="12"
          cy="12"
          r={innerR}
          className="stroke-emerald-400 [html[data-theme=light]_&]:stroke-emerald-500"
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeDasharray={ringDash(innerR, hit ?? 0)}
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
}: {
  paneId: string;
  sessionId: string;
  apiBase: string;
  apiToken: string;
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
      setUsage({
        used_tokens: Number(data.used_tokens ?? 0),
        max_tokens: Number(data.max_tokens ?? 0),
        percent: Number(data.percent ?? 0),
        categories: data.categories ?? {},
        cache: parseCache(data.cache),
        fetchedForSessionId: returnedSessionId,
        fetchedForModel: requestedModel,
      });
    } catch {
      if (requestSeq !== requestSeqRef.current) return;
      setUsage(null);
      setLoadFailed(true);
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

  // Drop residual occupancy/cache the moment the pane binds a different
  // session or model. Otherwise the previous payload stays on screen until
  // the next fetch lands — two panes then look identical.
  useEffect(() => {
    setUsage(null);
    setLoadFailed(false);
    requestSeqRef.current += 1;
    if (!sessionId) return;
    void fetchUsage();
  }, [fetchUsage, paneModel, sessionId]);

  useEffect(() => {
    if (open && sessionId) {
      refreshPanelPosition();
      void fetchUsage();
    }
  }, [fetchUsage, open, refreshPanelPosition, sessionId]);

  const sessionTokens = useAppStore((s) => s.panes.find((p) => p.id === paneId)?.sessionTokens);
  const visibleUsage =
    usage &&
    usage.fetchedForSessionId === sessionId &&
    usage.fetchedForModel === paneModel
      ? usage
      : null;
  const liveHit = formatHitPercent(sessionTokens?.lastCached ?? 0, sessionTokens?.lastInput ?? 0);
  const apiHit = formatHitPercent(
    visibleUsage?.cache?.last_cached_tokens ?? 0,
    visibleUsage?.cache?.last_input_tokens ?? 0
  );
  const lastHit = liveHit !== null ? liveHit : apiHit;
  const sessionInput =
    (visibleUsage?.cache?.session_input_tokens ?? 0) > 0
      ? visibleUsage?.cache?.session_input_tokens ?? 0
      : sessionTokens?.input ?? 0;
  const sessionCached =
    (visibleUsage?.cache?.session_input_tokens ?? 0) > 0
      ? visibleUsage?.cache?.session_cached_tokens ?? 0
      : sessionTokens?.cached ?? 0;
  const sessionHit = formatHitPercent(sessionCached, sessionInput);
  const cardHit = sessionHit !== null ? sessionHit : lastHit;
  const cardCached =
    sessionHit !== null
      ? sessionCached
      : (sessionTokens?.lastCached ?? visibleUsage?.cache?.last_cached_tokens ?? 0);
  const cardInput =
    sessionHit !== null
      ? sessionInput
      : (sessionTokens?.lastInput ?? visibleUsage?.cache?.last_input_tokens ?? 0);

  const percent = visibleUsage?.percent ?? 0;
  const hoverLabel = useMemo(() => {
    if (open) return "";
    if (!sessionId) return "上下文用量（会话未就绪）";
    if (!visibleUsage) return "上下文用量";
    const occupancy = `${visibleUsage.percent}% · ${formatK(visibleUsage.used_tokens)} / ${formatK(visibleUsage.max_tokens)} 上下文已使用`;
    return lastHit !== null ? `${occupancy} · 本轮命中 ${lastHit}%` : occupancy;
  }, [lastHit, open, sessionId, visibleUsage]);

  const ariaLabel = useMemo(() => {
    if (!sessionId) return "上下文用量（会话未就绪）";
    if (!visibleUsage) return "上下文用量";
    const occupancy = `上下文用量 ${visibleUsage.percent}% · ${formatK(visibleUsage.used_tokens)} / ${formatK(visibleUsage.max_tokens)}`;
    return lastHit !== null ? `${occupancy} · 本轮命中 ${lastHit}%` : occupancy;
  }, [lastHit, sessionId, visibleUsage]);

  const hitColor =
    cardHit === null
      ? "text-text-faint"
      : cardHit > 0
        ? "text-emerald-400 [html[data-theme=light]_&]:text-emerald-600"
        : "text-text-muted";

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
      <UsageDualRingIcon occupancy={percent} hit={cardHit} />
    </button>
  );

  return (
    <>
      <HoverTip label={hoverLabel}>{trigger}</HoverTip>
      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[100] max-h-[calc(100vh-24px)] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-border bg-surface-panel p-4 text-text-primary shadow-lg backdrop-blur-xl"
              style={{ left: panelPos.left, bottom: panelPos.bottom, width: panelPos.width }}
            >
              <div className="mb-2 flex items-center justify-between">
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
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    <div className="min-w-0 rounded-xl bg-[var(--surface-card-strong)] px-2.5 py-2 [html[data-theme=light]_&]:bg-zinc-100">
                      <div className="text-[11px] text-text-faint">上下文占用</div>
                      <div className="mt-0.5 text-2xl font-semibold tabular-nums leading-none text-text-strong">
                        {visibleUsage.percent}%
                      </div>
                      <div className="mt-1.5 text-[11px] leading-snug text-text-faint">
                        {formatK(visibleUsage.used_tokens)} / {formatK(visibleUsage.max_tokens)}
                      </div>
                    </div>
                    <div className="min-w-0 rounded-xl bg-emerald-500/15 px-2.5 py-2 [html[data-theme=light]_&]:bg-emerald-50">
                      <div className="text-[11px] text-emerald-400 [html[data-theme=light]_&]:text-emerald-600">
                        缓存命中率
                      </div>
                      <div className={`mt-0.5 text-2xl font-semibold tabular-nums leading-none ${hitColor}`}>
                        {cardHit === null ? "—" : `${cardHit}%`}
                      </div>
                      {cardHit === null ? (
                        <div className="mt-1.5 text-[11px] leading-snug text-text-faint">本轮尚未返回用量</div>
                      ) : (
                        <div className="mt-1.5 text-[11px] leading-snug text-emerald-400/75 [html[data-theme=light]_&]:text-emerald-700/70">
                          {formatK(cardCached)} cached
                          <br />
                          / {formatK(cardInput)} input
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mb-3 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                    {visibleUsage.max_tokens > 0
                      ? CATEGORY_ORDER.map((key) => {
                          const value = visibleUsage.categories[key] ?? 0;
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
                  <div className="flex flex-col gap-1.5">
                    {CATEGORY_ORDER.map((key) => (
                      <div key={key} className="flex items-center justify-between text-[12px]">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_COLORS[key]}`} />
                          <span className="text-text-muted">{CATEGORY_LABELS[key]}</span>
                        </div>
                        <span className="text-text-faint">~{formatK(visibleUsage.categories[key] ?? 0)}</span>
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
