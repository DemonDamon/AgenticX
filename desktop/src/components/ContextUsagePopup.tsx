import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ContextUsage {
  used_tokens: number;
  max_tokens: number;
  percent: number;
  categories: Record<string, number>;
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

function formatK(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
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
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const requestSeqRef = useRef(0);

  const refreshPanelPosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPanelPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 });
  }, []);

  const fetchUsage = useCallback(async () => {
    if (!sessionId) return;
    const requestSeq = ++requestSeqRef.current;
    setLoadFailed(false);
    try {
      const res = await fetch(
        `${apiBase}/api/session/context_usage?session_id=${encodeURIComponent(sessionId)}`,
        { headers: { "X-Agx-Desktop-Token": apiToken } }
      );
      if (!res.ok) throw new Error(`http ${res.status}`);
      const data = await res.json();
      if (requestSeq !== requestSeqRef.current) return;
      setUsage({
        used_tokens: Number(data.used_tokens ?? 0),
        max_tokens: Number(data.max_tokens ?? 0),
        percent: Number(data.percent ?? 0),
        categories: data.categories ?? {},
      });
    } catch {
      if (requestSeq !== requestSeqRef.current) return;
      setUsage(null);
      setLoadFailed(true);
    }
  }, [apiBase, apiToken, sessionId]);

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

  useEffect(() => {
    setUsage(null);
    setLoadFailed(false);
    requestSeqRef.current += 1;
    if (open && sessionId) {
      refreshPanelPosition();
      void fetchUsage();
    }
  }, [fetchUsage, open, refreshPanelPosition, sessionId]);

  const usedTokens = usage?.used_tokens ?? 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-pane-id={paneId}
        disabled={!sessionId}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-40"
        title="上下文用量"
        onClick={toggleOpen}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0" aria-hidden>
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 12 L12 3.5 A8.5 8.5 0 0 1 19.8 16.5 Z"
            fill="currentColor"
            opacity="0.55"
          />
        </svg>
      </button>
      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[100] w-[300px] rounded-xl border border-border bg-surface-panel p-4 text-text-primary shadow-lg backdrop-blur-xl"
              style={{ left: panelPos.left, bottom: panelPos.bottom }}
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
              ) : !usage ? (
                <div className="py-2 text-[12px] text-text-faint">加载中…</div>
              ) : (
                <>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold text-text-strong">{usage.percent}%</span>
                    <span className="text-[11px] text-text-faint">
                      已使用 {formatK(usage.used_tokens)} / {formatK(usage.max_tokens)}
                    </span>
                  </div>
                  <div className="mb-3 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                    {usage.max_tokens > 0
                      ? CATEGORY_ORDER.map((key) => {
                          const value = usage.categories[key] ?? 0;
                          if (value <= 0) return null;
                          const widthPct = (value / usage.max_tokens) * 100;
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
                        <span className="text-text-faint">~{formatK(usage.categories[key] ?? 0)}</span>
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
