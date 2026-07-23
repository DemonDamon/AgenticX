import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type WheelEvent,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { HoverTip } from "./HoverTip";

type Props = {
  src: string;
  alt?: string;
  /** 图片容器最大高度，默认 68vh */
  maxHeight?: string;
};

const MIN_USER_SCALE = 0.1;
const MAX_USER_SCALE = 10;
const STEP = 0.25;

function clampUserScale(scale: number): number {
  return Math.min(MAX_USER_SCALE, Math.max(MIN_USER_SCALE, scale));
}

/**
 * 支持鼠标滚轮缩放（以光标为中心）+ 拖拽平移的图片查看器。
 * 默认 100% = 适应容器完整显示；双击还原至适应模式。
 */
export function ZoomableImage({ src, alt, maxHeight = "68vh" }: Props) {
  const [fitScale, setFitScale] = useState(1);
  const [userScale, setUserScale] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragOrigin = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const computeFitScale = useCallback((resetView = false) => {
    const container = containerRef.current;
    const img = imgRef.current;
    if (!container || !img || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;

    const scale = Math.min(
      container.clientWidth / img.naturalWidth,
      container.clientHeight / img.naturalHeight,
      1,
    );
    setFitScale(scale);
    if (resetView) {
      setUserScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, []);

  useEffect(() => {
    setNaturalSize(null);
    setFitScale(1);
    setUserScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => computeFitScale(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, [computeFitScale]);

  const reset = useCallback(() => {
    setUserScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const img = event.currentTarget;
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      computeFitScale(true);
    },
    [computeFitScale],
  );

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;

    setUserScale((prev) => {
      const delta = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = clampUserScale(prev * delta);
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

  const zoomIn = () => setUserScale((s) => clampUserScale(+(s + STEP).toFixed(2)));
  const zoomOut = () => setUserScale((s) => clampUserScale(+(s - STEP).toFixed(2)));

  const effectiveScale = fitScale * userScale;
  const pct = Math.round(userScale * 100);

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
        <div style={{ height: maxHeight === "68vh" ? "60vh" : maxHeight, minHeight: 200 }} />

        <img
          ref={imgRef}
          src={src}
          alt={alt ?? "image"}
          draggable={false}
          onLoad={handleImageLoad}
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: naturalSize?.w,
            height: naturalSize?.h,
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${effectiveScale})`,
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
