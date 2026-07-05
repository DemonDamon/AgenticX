/**
 * 像素/粒子矩阵进度条（Sub-Plan C FR-3）—— `variant="bar"` 逐格点亮表达精确进度，对齐图4 的方格质感
 * （工牌详情 / drawer 场景）；`variant="dots"` 走两行圆点粒子矩阵质感（对齐 Kimi Work 风格，蜂群卡片行内
 * 场景）—— 按状态整体着色 + 运行中呼吸闪烁，而非逐格填充比例（对齐参照图里「整体点亮」的活动指示语义）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PIXEL_PROGRESS_CELLS, TONE_COLOR_VAR, isTerminalStatus, statusMeta } from "./badge-theme";

type Props = {
  /** 0..1；undefined 且运行中 → 呼吸推进。 */
  progress?: number;
  status: string;
  cells?: number;
  variant?: "bar" | "dots";
  className?: string;
};

/** 已完成格用主题色，未完成格用极低透明度的主题色底。 */
const FILLED_BG = "rgb(var(--theme-color-rgb))";
const EMPTY_BG = "color-mix(in srgb, rgb(var(--theme-color-rgb)) 14%, transparent)";
const ERROR_BG = "var(--status-error)";
const PAUSED_BG = "var(--status-warning)";

/** 粒子矩阵：两行 × N 列的方点网格，整体按状态语义色点亮，运行中整体呼吸闪烁。 */
function DotMatrix({ status, cells, className }: { status: string; cells: number; className?: string }) {
  const isRunning = status === "running" || status === "pending" || status === "awaiting_confirm" || status === "awaiting_input";
  const meta = statusMeta(status);
  const color = TONE_COLOR_VAR[meta.tone];
  const cols = Math.max(1, Math.ceil(cells / 2));
  return (
    <div
      className={`grid shrink-0 grid-rows-2 gap-[2.5px] ${isRunning ? "animate-pulse" : ""} ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${cols}, 4px)` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={status === "completed" ? 100 : undefined}
      aria-label={meta.label}
    >
      {Array.from({ length: cols * 2 }).map((_, i) => (
        <span key={i} className="h-[4px] w-[4px] rounded-[1px]" style={{ background: color }} />
      ))}
    </div>
  );
}

export function PixelProgress({ progress, status, cells = PIXEL_PROGRESS_CELLS, variant = "bar", className }: Props) {
  if (variant === "dots") {
    return <DotMatrix status={status} cells={cells} className={className} />;
  }

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
