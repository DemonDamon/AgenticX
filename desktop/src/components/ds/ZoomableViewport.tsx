import { useState, useRef, useCallback, type ReactNode, type WheelEvent, type MouseEvent } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { HoverTip } from "./HoverTip";

type Props = {
  children: ReactNode;
  /** 内容渲染舞台的逻辑宽度（px），SVG/HTML 会以此宽度为基准铺开再整体缩放。默认 900。 */
  stageWidth?: number;
  /** 可视区域高度，默认 75vh */
  viewportHeight?: string;
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const STEP = 0.25;

/**
 * 通用缩放/平移容器 —— 支持鼠标滚轮缩放（以光标为中心）+ 拖拽平移 + 双击还原。
 * 与 ZoomableImage 的交互一致，但承载任意 children（SVG、iframe 等），
 * 通过固定宽度舞台承载内容后整体做 CSS transform 缩放。
 */
export function ZoomableViewport({ children, stageWidth = 900, viewportHeight = "75vh" }: Props) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragOrigin = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

  const reset = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;

    setScale((prev) => {
      const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = clampScale(prev * delta);
      const ratio = next / prev;
      setOffset((o) => ({ x: mx - (mx - o.x) * ratio, y: my - (my - o.y) * ratio }));
      return next;
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setIsDragging(true);
      dragOrigin.current = { mx: e.clientX, my: e.clientY, ox: offset.x, oy: offset.y };
    },
    [offset],
  );

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

  const zoomIn = () => setScale((s) => clampScale(+(s + STEP).toFixed(2)));
  const zoomOut = () => setScale((s) => clampScale(+(s - STEP).toFixed(2)));

  const pct = Math.round(scale * 100);

  return (
    <div className="flex flex-col gap-2">
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

        <HoverTip label="还原（双击也可还原）">
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

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-lg border border-border bg-black/10"
        style={{ height: viewportHeight, cursor: isDragging ? "grabbing" : "grab" }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: stageWidth,
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`,
            transformOrigin: "center center",
            pointerEvents: "none",
            userSelect: "none",
            transition: isDragging ? "none" : "transform 0.05s ease-out",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
