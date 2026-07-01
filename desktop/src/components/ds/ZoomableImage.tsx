import { useState, useRef, useCallback, type WheelEvent, type MouseEvent } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { HoverTip } from "./HoverTip";

type Props = {
  src: string;
  alt?: string;
  /** 图片容器最大高度，默认 68vh */
  maxHeight?: string;
};

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const STEP = 0.25;

/**
 * 支持鼠标滚轮缩放（以光标为中心）+ 拖拽平移的图片查看器。
 * 双击还原至适应模式。
 */
export function ZoomableImage({ src, alt, maxHeight = "68vh" }: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // 用 ref 存储拖拽起点，避免触发 re-render
  const dragOrigin = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  /** 以鼠标在容器内的位置为缩放中心 */
  const handleWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      // 鼠标相对于容器中心的偏移
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;

      setScale((prev) => {
        const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = clampScale(prev * delta);
        // 以鼠标位置为缩放中心修正平移量
        const ratio = next / prev;
        setOffset((o) => ({ x: mx - (mx - o.x) * ratio, y: my - (my - o.y) * ratio }));
        return next;
      });
    },
    [],
  );

  const handleMouseDown = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragOrigin.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };
  }, [offset]);

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!isDragging || !dragOrigin.current) return;
      setOffset({
        x: dragOrigin.current.ox + e.clientX - dragOrigin.current.mx,
        y: dragOrigin.current.oy + e.clientY - dragOrigin.current.my,
      });
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragOrigin.current = null;
  }, []);

  const handleDoubleClick = useCallback(() => reset(), [reset]);

  const zoomIn  = () => setScale((s) => clampScale(+(s + STEP).toFixed(2)));
  const zoomOut = () => setScale((s) => clampScale(+(s - STEP).toFixed(2)));

  const pct = Math.round(scale * 100);

  return (
    <div className="flex flex-col gap-2">
      {/* 工具栏 */}
      <div className="flex items-center justify-center gap-1">
        <HoverTip label="缩小">
          <button
            type="button"
            onClick={zoomOut}
            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-surface-hover text-text-muted hover:text-text-strong"
          >
            <ZoomOut size={12} />
          </button>
        </HoverTip>

        <span className="min-w-[44px] rounded border border-border bg-surface-hover px-1.5 text-center text-[11px] text-text-muted">
          {pct}%
        </span>

        <HoverTip label="放大">
          <button
            type="button"
            onClick={zoomIn}
            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-surface-hover text-text-muted hover:text-text-strong"
          >
            <ZoomIn size={12} />
          </button>
        </HoverTip>

        <HoverTip label="还原（双击图片也可还原）">
          <button
            type="button"
            onClick={reset}
            className="ml-1 flex h-6 w-6 items-center justify-center rounded border border-border bg-surface-hover text-text-muted hover:text-text-strong"
          >
            <Maximize2 size={12} />
          </button>
        </HoverTip>

        <span className="ml-2 text-[11px] text-text-faint">滚轮缩放 · 拖拽平移 · 双击还原</span>
      </div>

      {/* 图片容器 */}
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border border-border bg-black/10"
        style={{ maxHeight, minHeight: 200, cursor: isDragging ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        {/* 撑开容器高度用的透明占位，防止 0 高度 */}
        <div style={{ height: maxHeight === "68vh" ? "60vh" : maxHeight, minHeight: 200 }} />

        <img
          src={src}
          alt={alt ?? "image"}
          draggable={false}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
            transformOrigin: "center center",
            maxWidth: "none",
            maxHeight: "none",
            userSelect: "none",
            pointerEvents: "none",
            transition: isDragging ? "none" : "transform 0.05s ease-out",
          }}
        />
      </div>
    </div>
  );
}
