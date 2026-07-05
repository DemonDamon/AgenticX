/**
 * 像素方格进度条（Sub-Plan C FR-3）—— 逐格点亮表达进度，对齐图4 的方格质感，
 * 但用主题色而非硬编码绿色。运行中无精确进度时走「呼吸推进」（当前活跃格闪烁）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PIXEL_PROGRESS_CELLS, isTerminalStatus } from "./badge-theme";

type Props = {
  /** 0..1；undefined 且运行中 → 呼吸推进。 */
  progress?: number;
  status: string;
  cells?: number;
  className?: string;
};

/** 已完成格用主题色，未完成格用极低透明度的主题色底。 */
const FILLED_BG = "rgb(var(--theme-color-rgb))";
const EMPTY_BG = "color-mix(in srgb, rgb(var(--theme-color-rgb)) 14%, transparent)";
const ERROR_BG = "var(--status-error)";
const PAUSED_BG = "var(--status-warning)";

export function PixelProgress({ progress, status, cells = PIXEL_PROGRESS_CELLS, className }: Props) {
  const isRunning = status === "running" || status === "pending" || status === "awaiting_confirm" || status === "awaiting_input";
  const isFailed = status === "failed";
  const isPaused = status === "paused";
  const isCompleted = status === "completed";

  // 呼吸推进：运行中且无精确进度时，让一个「活跃格」缓慢向前扫动。
  const [pulseCell, setPulseCell] = useState(0);
  const rafRef = useRef<number | null>(null);
  const breathing = isRunning && typeof progress !== "number";

  useEffect(() => {
    if (!breathing) return;
    let last = 0;
    const step = (t: number) => {
      // 约每 140ms 前进一格，节流避免高频重渲染（NFR-4）。
      if (t - last >= 140) {
        last = t;
        setPulseCell((c) => (c + 1) % cells);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [breathing, cells]);

  const filledCount = useMemo(() => {
    if (isCompleted) return cells;
    if (typeof progress === "number") return Math.round(Math.max(0, Math.min(1, progress)) * cells);
    if (isTerminalStatus(status)) return 0; // failed/cancelled 无 progress → 不点亮
    return 0;
  }, [progress, status, cells, isCompleted]);

  return (
    <div
      className={`flex items-center gap-[2px] ${className ?? ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={cells}
      aria-valuenow={filledCount}
    >
      {Array.from({ length: cells }).map((_, i) => {
        let bg = EMPTY_BG;
        let opacity = 1;
        if (isFailed && i === cells - 1) {
          bg = ERROR_BG;
        } else if (isPaused && i < Math.max(filledCount, Math.round(cells * 0.6))) {
          bg = PAUSED_BG;
          opacity = 0.85;
        } else if (i < filledCount) {
          bg = FILLED_BG;
        } else if (breathing && i === pulseCell) {
          bg = FILLED_BG;
          opacity = 0.55;
        }
        return (
          <span
            key={i}
            className="h-2 flex-1 rounded-[1px] transition-colors duration-200"
            style={{ background: bg, opacity, minWidth: 3 }}
          />
        );
      })}
    </div>
  );
}
