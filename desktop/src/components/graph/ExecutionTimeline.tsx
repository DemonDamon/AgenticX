import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Avatar } from "../../store";
import { avatarDotColorForIdentity } from "../../utils/avatar-color";
import { formatToolDisplayName } from "../messages/tool-display-name";
import { META_AGENT_DISPLAY_NAME } from "../../constants/branding";
import { EMPTY_PANE_GRAPH_STATE } from "./graph-types";
import {
  agentIdFromNode,
  deriveTimelineWindow,
  deriveToolSpans,
  nodeIdForAgent,
  type ToolSpan,
} from "./span-derive";
import { useGraphRunStore } from "./useGraphRun";

type Props = {
  paneId: string;
  /** 成员顺序：["__meta__", ...group.avatarIds]，与成员 tab 一致 */
  agentIds: string[];
  avatarById: Map<string, Avatar>;
  metaLeaderLabel?: string;
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
};

type MemberGroup = {
  agentId: string;
  label: string;
  color?: string | null;
  spans: ToolSpan[];
};

const LABEL_W = "5.5rem";
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 24;
const MIN_WIN = 1 / ZOOM_MAX;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function useNowMs(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

export function ExecutionTimeline({
  paneId,
  agentIds,
  avatarById,
  metaLeaderLabel = META_AGENT_DISPLAY_NAME,
  selectedAgentId = null,
  onSelectAgent,
}: Props) {
  const toolStepsByNode = useGraphRunStore(
    (s) => s.byPane[paneId]?.toolStepsByNode ?? EMPTY_PANE_GRAPH_STATE.toolStepsByNode,
  );

  const groups = useMemo((): MemberGroup[] => {
    const seen = new Set<string>();
    const out: MemberGroup[] = [];
    for (const rawId of agentIds) {
      const agentId = String(rawId || "").trim();
      if (!agentId || seen.has(agentId)) continue;
      seen.add(agentId);
      const nodeId = nodeIdForAgent(agentId);
      const avatar = avatarById.get(agentId);
      const isMeta = agentId === "__meta__" || agentId === "meta";
      out.push({
        agentId,
        label: isMeta ? metaLeaderLabel : avatar?.name || agentId.slice(0, 8),
        color: avatar?.color,
        spans: deriveToolSpans(toolStepsByNode[nodeId] ?? []),
      });
    }
    for (const nodeId of Object.keys(toolStepsByNode)) {
      const agentId = agentIdFromNode(nodeId);
      if (!agentId || seen.has(agentId)) continue;
      seen.add(agentId);
      const avatar = avatarById.get(agentId);
      out.push({
        agentId,
        label: avatar?.name || agentId.slice(0, 8),
        color: avatar?.color,
        spans: deriveToolSpans(toolStepsByNode[nodeId] ?? []),
      });
    }
    return out;
  }, [agentIds, avatarById, metaLeaderLabel, toolStepsByNode]);

  const allSpans = useMemo(() => groups.flatMap((g) => g.spans), [groups]);
  const hasRunning = useMemo(() => allSpans.some((s) => s.running), [allSpans]);
  const nowMs = useNowMs(hasRunning);
  const timelineWindow = useMemo(
    () => deriveTimelineWindow(allSpans, nowMs),
    [allSpans, nowMs],
  );

  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  // Visible window on the content axis as fractions of [0,1] content.
  const [view, setView] = useState({ left: 0, width: 1 });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanup.current?.(), []);

  const updateViewFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sw = el.scrollWidth || 1;
    setView({
      left: el.scrollLeft / sw,
      width: Math.min(1, el.clientWidth / sw),
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateViewFromScroll();
    el.addEventListener("scroll", updateViewFromScroll, { passive: true });
    const ro = new ResizeObserver(updateViewFromScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateViewFromScroll);
      ro.disconnect();
    };
  }, [updateViewFromScroll, zoom, allSpans.length]);

  const applyZoom = useCallback((nextZoom: number, anchorFrac = 0.5) => {
    const z = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    setZoom(z);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      const contentFrac = view.left + view.width * anchorFrac;
      el.scrollLeft = clamp(contentFrac * el.scrollWidth - el.clientWidth * anchorFrac, 0, max);
      updateViewFromScroll();
    });
  }, [updateViewFromScroll, view.left, view.width]);

  const resetView = useCallback(() => {
    setZoom(1);
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollLeft = 0;
      setView({ left: 0, width: 1 });
    });
  }, []);

  const startSliderDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    mode: "pan" | "left" | "right",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const track = e.currentTarget.parentElement;
    if (!track) return;
    const trackRect = track.getBoundingClientRect();
    const startX = e.clientX;
    const start = { ...view };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / Math.max(1, trackRect.width);
      if (mode === "pan") {
        const width = start.width;
        const left = clamp(start.left + dx, 0, 1 - width);
        const el = scrollRef.current;
        if (el) {
          el.scrollLeft = left * el.scrollWidth;
          setView({ left, width });
        }
        return;
      }
      if (mode === "left") {
        const right = start.left + start.width;
        const left = clamp(start.left + dx, 0, right - MIN_WIN);
        const width = right - left;
        const nextZoom = clamp(1 / width, ZOOM_MIN, ZOOM_MAX);
        setZoom(nextZoom);
        requestAnimationFrame(() => {
          const el = scrollRef.current;
          if (!el) return;
          el.scrollLeft = left * el.scrollWidth;
          setView({ left, width: Math.min(1, el.clientWidth / (el.scrollWidth || 1)) });
        });
        return;
      }
      const left = start.left;
      const width = clamp(start.width + dx, MIN_WIN, 1 - left);
      const nextZoom = clamp(1 / width, ZOOM_MIN, ZOOM_MAX);
      setZoom(nextZoom);
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollLeft = left * el.scrollWidth;
        setView({ left, width: Math.min(1, el.clientWidth / (el.scrollWidth || 1)) });
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dragCleanup.current = null;
    };
    dragCleanup.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!timelineWindow || allSpans.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-1 px-4 text-center">
        <p className="text-[13px] text-text-subtle">本轮尚无工具调用</p>
        <p className="max-w-[240px] text-[11px] leading-relaxed text-text-faint">
          群成员开始调用工具后，将在此按时间轴展示各成员的执行过程
        </p>
      </div>
    );
  }

  const totalMs = Math.max(1, timelineWindow.endMs - timelineWindow.startMs);
  const fracs = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel">
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <div
          ref={scrollRef}
          className="overflow-x-auto overflow-y-visible"
          // Wheel zoom intentionally unsupported (plan invariant).
        >
          <div style={{ width: `${zoom * 100}%`, minWidth: "100%" }} className="space-y-3">
            <div className="flex items-center">
              <span
                className="sticky left-0 z-10 shrink-0 bg-surface-panel pr-2"
                style={{ width: LABEL_W }}
              />
              <div className="relative h-4 min-w-0 flex-1">
                {fracs.map((f, i) => (
                  <span
                    key={f}
                    className={`absolute top-0 font-mono text-[11px] text-text-faint ${
                      i === 0 ? "" : i === fracs.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
                    }`}
                    style={{ left: `${f * 100}%` }}
                  >
                    {formatDuration(f * totalMs)}
                  </span>
                ))}
              </div>
            </div>

            {groups.map((group) => {
              if (group.spans.length === 0) return null;
              const selected =
                selectedAgentId === group.agentId ||
                selectedAgentId === nodeIdForAgent(group.agentId);
              return (
                <div key={group.agentId} className="space-y-1">
                  <div className="flex items-center gap-2 px-0.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: avatarDotColorForIdentity(group.agentId, group.color),
                      }}
                      aria-hidden
                    />
                    <span
                      className={`truncate text-[12px] ${
                        selected ? "text-text-strong" : "text-text-muted"
                      }`}
                    >
                      {group.label}
                    </span>
                    <span className="text-[11px] text-text-faint">{group.spans.length}</span>
                  </div>
                  {group.spans.map((span) => {
                    const key = `${group.agentId}:${span.callId}`;
                    const endMs = span.running
                      ? Math.max(span.startMs, nowMs)
                      : (span.endMs ?? span.startMs);
                    const left = ((span.startMs - timelineWindow.startMs) / totalMs) * 100;
                    const width = Math.max(0.4, ((endMs - span.startMs) / totalMs) * 100);
                    const dimmed = hoverKey !== null && hoverKey !== key;
                    return (
                      <div key={key} className="flex items-center">
                        <span
                          className="sticky left-0 z-10 flex h-4 shrink-0 items-center justify-end bg-surface-panel pr-2"
                          style={{ width: LABEL_W }}
                          title={formatToolDisplayName(span.toolName)}
                        >
                          <span className="truncate font-mono text-[11px] text-text-faint">
                            {formatToolDisplayName(span.toolName)}
                          </span>
                        </span>
                        <div className="relative h-4 min-w-0 flex-1 overflow-hidden bg-surface-hover/60">
                          <button
                            type="button"
                            className={`absolute top-0.5 h-3 rounded-sm transition-opacity ${
                              span.running
                                ? "animate-pulse bg-emerald-500/80 dark:bg-emerald-400/80"
                                : "bg-emerald-600 dark:bg-emerald-500"
                            } ${dimmed ? "opacity-25" : "opacity-100"}`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${formatToolDisplayName(span.toolName)} · ${formatDuration(endMs - span.startMs)}`}
                            onMouseEnter={() => setHoverKey(key)}
                            onMouseLeave={() => setHoverKey(null)}
                            onClick={() => {
                              onSelectAgent?.(group.agentId);
                              useGraphRunStore
                                .getState()
                                .setSelected(paneId, [nodeIdForAgent(group.agentId)]);
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-[11px] text-text-faint">
          <span>缩放 {zoom.toFixed(2)}x</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 hover:bg-surface-hover hover:text-text-strong"
              onClick={() => applyZoom(zoom / 1.25)}
            >
              −
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 hover:bg-surface-hover hover:text-text-strong"
              onClick={() => applyZoom(zoom * 1.25)}
            >
              +
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 hover:bg-surface-hover hover:text-text-strong"
              onClick={resetView}
            >
              复位
            </button>
          </div>
        </div>
        <div
          className="relative h-3 rounded-full bg-surface-hover"
          onDoubleClick={resetView}
        >
          <div
            className="absolute top-0 h-full cursor-grab rounded-full bg-surface-card-strong active:cursor-grabbing"
            style={{
              left: `${view.left * 100}%`,
              width: `${Math.max(MIN_WIN, view.width) * 100}%`,
            }}
            onPointerDown={(e) => startSliderDrag(e, "pan")}
          >
            <div
              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
              onPointerDown={(e) => startSliderDrag(e, "left")}
            />
            <div
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
              onPointerDown={(e) => startSliderDrag(e, "right")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
