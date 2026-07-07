/**
 * 像素/粒子矩阵进度条（Sub-Plan C FR-3）—— `variant="bar"` 逐格点亮表达精确进度，对齐图4 的方格质感
 * （工牌详情 / drawer 场景）；`variant="dots"` 走 3行×12列圆点矩阵，逐列从左到右点亮，
 * 像进度条一样推进（运行中无精确进度时活跃列呼吸闪烁）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PIXEL_PROGRESS_CELLS, isTerminalStatus, statusMeta } from "./badge-theme";

/** 粒子矩阵固定参数：3 行 × 12 列 */
const DOT_ROWS = 3;
const DOT_COLS = 12;

type Props = {
  /** 0..1；undefined 且运行中 → 呼吸推进。 */
  progress?: number;
  status: string;
  cells?: number;
  variant?: "bar" | "dots";
  className?: string;
};

/** 运行中格用主题色（蓝），已完成格用 success 绿，失败格用 error 红；未完成格极低透明度主题底。 */
const RUNNING_BG = "rgb(var(--theme-color-rgb))";
const COMPLETED_BG = "var(--status-success)";
const EMPTY_BG = "color-mix(in srgb, rgb(var(--theme-color-rgb)) 14%, transparent)";
const ERROR_BG = "var(--status-error)";
const PAUSED_BG = "var(--status-warning)";

/**
 * 粒子矩阵：3行 × 12列，逐列从左向右点亮（进度条语义）。
 * 运行中无精确进度时，活跃列（下一个待点亮列）缓慢呼吸前进。
 */
function DotMatrix({ progress, status, className }: { progress?: number; status: string; className?: string }) {
  const isRunning = status === "running" || status === "pending" || status === "awaiting_confirm" || status === "awaiting_input";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";
  const isPaused = status === "paused";
  const meta = statusMeta(status);

  // 无精确进度时按列呼吸推进
  const breathing = isRunning && typeof progress !== "number";
  const [pulseCol, setPulseCol] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!breathing) return;
    let last = 0;
    const step = (t: number) => {
      // 约每 400ms 前进一列（12列 × 400ms ≈ 5s 跑一圈，节奏舒缓）
      if (t - last >= 400) {
        last = t;
        setPulseCol((c) => (c + 1) % DOT_COLS);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [breathing]);

  // 计算已填充列数（0..DOT_COLS）
  let filledCols: number;
  if (isCompleted) {
    filledCols = DOT_COLS;
  } else if (isFailed) {
    filledCols = 0;
  } else if (typeof progress === "number") {
    filledCols = Math.round(Math.max(0, Math.min(1, progress)) * DOT_COLS);
  } else {
    filledCols = 0;
  }

  // 每列颜色：完成=绿、运行=蓝、失败=红；活跃列呼吸时仍走运行色。
  const colColors: string[] = Array.from({ length: DOT_COLS }, (_, col) => {
    if (isFailed) return ERROR_BG;
    if (isCompleted) return COMPLETED_BG;
    if (isPaused) return col < Math.max(filledCols, Math.round(DOT_COLS * 0.6)) ? PAUSED_BG : EMPTY_BG;
    if (col < filledCols) return RUNNING_BG;
    return EMPTY_BG;
  });

  return (
    <div
      className={`grid shrink-0 gap-[2.5px] ${className ?? ""}`}
      style={{
        gridTemplateColumns: `repeat(${DOT_COLS}, 4px)`,
        gridTemplateRows: `repeat(${DOT_ROWS}, 4px)`,
        gridAutoFlow: "column",
      }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={isCompleted ? 100 : Math.round((filledCols / DOT_COLS) * 100)}
      aria-label={meta.label}
    >
      {Array.from({ length: DOT_ROWS * DOT_COLS }).map((_, i) => {
        // grid-auto-flow:column 时，i = col * DOT_ROWS + row
        const col = Math.floor(i / DOT_ROWS);
        const isActive = breathing && col === pulseCol;
        const bg = isActive ? RUNNING_BG : colColors[col];
        return (
          <span
            key={i}
            className={`h-[4px] w-[4px] rounded-[1px] transition-colors duration-200 ${isActive ? "animate-pulse" : ""}`}
            style={{ background: bg, opacity: isActive ? 0.55 : 1 }}
          />
        );
      })}
    </div>
  );
}

export function PixelProgress({ progress, status, cells = PIXEL_PROGRESS_CELLS, variant = "bar", className }: Props) {
  if (variant === "dots") {
    return <DotMatrix progress={progress} status={status} className={className} />;
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
        } else if (isCompleted && i < filledCount) {
          bg = COMPLETED_BG;
        } else if (i < filledCount) {
          bg = RUNNING_BG;
        } else if (breathing && i === pulseCell) {
          bg = RUNNING_BG;
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
