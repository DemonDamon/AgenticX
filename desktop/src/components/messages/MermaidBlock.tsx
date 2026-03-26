import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import mermaid from "mermaid";
import { Copy, Download, Minimize2, Move, ZoomIn, ZoomOut } from "lucide-react";

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_FACTOR = 1.2;
const VIEWPORT_MIN_H = 280;
const VIEWPORT_MAX_H = 560;

function useDocumentDataTheme(): string {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute("data-theme") || "dark",
  );
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => {
      setTheme(el.getAttribute("data-theme") || "dark");
    });
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

function mermaidThemeFromApp(appTheme: string): "dark" | "default" {
  return appTheme === "light" ? "default" : "dark";
}

/**
 * Mermaid 常输出 width/height 为 100%；父级为 inline-block 且无明确高度时，
 * 百分比高度会变成 0，表现为「空白画布」。用 viewBox 写成像素宽高即可稳定布局。
 */
function normalizeMermaidSvgInContainer(host: HTMLElement): SVGSVGElement | null {
  const svg = host.querySelector("svg");
  if (!svg) return null;
  const vb = svg.viewBox?.baseVal;
  let w = vb && vb.width > 0 ? vb.width : 0;
  let h = vb && vb.height > 0 ? vb.height : 0;
  if (!w || !h) {
    try {
      const b = svg.getBBox();
      if (b.width > 0 && b.height > 0) {
        w = b.width;
        h = b.height;
      }
    } catch {
      /* SVG 未参与布局时 getBBox 可能抛错 */
    }
  }
  if (w > 0 && h > 0) {
    const cw = Math.ceil(w);
    const ch = Math.ceil(h);
    svg.setAttribute("width", String(cw));
    svg.setAttribute("height", String(ch));
    svg.style.width = `${cw}px`;
    svg.style.height = `${ch}px`;
    svg.style.maxWidth = "none";
    svg.style.maxHeight = "none";
  }
  return svg;
}

function readSvgNaturalSize(svg: SVGSVGElement): { w: number; h: number } {
  try {
    const box = svg.getBBox();
    if (
      Number.isFinite(box.width) &&
      Number.isFinite(box.height) &&
      box.width >= 1 &&
      box.height >= 1
    ) {
      return { w: box.width, h: box.height };
    }
  } catch {
    /* 同上 */
  }
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { w: vb.width, h: vb.height };
  }
  const aw = svg.width?.baseVal?.value;
  const ah = svg.height?.baseVal?.value;
  if (aw && ah) return { w: aw, h: ah };
  const w = parseFloat(svg.getAttribute("width") || "0");
  const h = parseFloat(svg.getAttribute("height") || "0");
  if (w > 0 && h > 0) return { w, h };
  const r = svg.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
  return { w: 480, h: 320 };
}

async function svgStringToPngBlob(svgMarkup: string, pixelRatio = 2): Promise<Blob> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgMarkup, "image/svg+xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) throw new Error("SVG parse error");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("No SVG root");

  const { w, h } = readSvgNaturalSize(svg as SVGSVGElement);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(w * pixelRatio));
        canvas.height = Math.max(1, Math.ceil(h * pixelRatio));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas unsupported"));
          return;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(pixelRatio, pixelRatio);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (out) => {
            URL.revokeObjectURL(url);
            if (out) resolve(out);
            else reject(new Error("PNG encode failed"));
          },
          "image/png",
          1,
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG raster failed"));
    };
    img.src = url;
  });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ToolbarBtnProps = {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function ToolbarButton({ title, active, onClick, children }: ToolbarBtnProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={`no-drag flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
        active
          ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/35"
          : "text-[var(--text-primary)] hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

type Props = {
  code: string;
};

export function MermaidBlock({ code }: Props) {
  const reactId = useId().replace(/:/g, "");
  const renderId = `mmd-${reactId}`;
  const appTheme = useDocumentDataTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dimsRef = useRef<{ w: number; h: number } | null>(null);

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panMode, setPanMode] = useState(true);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [draggingUi, setDraggingUi] = useState(false);
  const draggingRef = useRef(false);
  const lastPtr = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const trimmed = code.trim();
    if (!trimmed) {
      setSvg(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    setSvg(null);
    (async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: mermaidThemeFromApp(appTheme),
        });
        const { svg: out } = await mermaid.render(renderId, trimmed);
        if (!cancelled) setSvg(out);
      } catch {
        if (!cancelled) {
          setSvg(null);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, renderId, appTheme]);

  const fitToView = useCallback(() => {
    const vp = viewportRef.current;
    const dims = dimsRef.current;
    if (!vp || !dims) return;
    const pad = 20;
    const pw = vp.clientWidth;
    const ph = vp.clientHeight;
    if (pw <= 0 || ph <= 0) return;
    const s = Math.min((pw - pad) / dims.w, (ph - pad) / dims.h, MAX_SCALE);
    const scaleFit = Math.max(s, 0.05);
    setScale(scaleFit);
    setTx((pw - dims.w * scaleFit) / 2);
    setTy((ph - dims.h * scaleFit) / 2);
  }, []);

  useLayoutEffect(() => {
    if (!svg) return;
    const host = contentRef.current;
    const vp = viewportRef.current;
    if (!host || !vp) return;

    const measureAndFit = () => {
      normalizeMermaidSvgInContainer(host);
      const svgEl = host.querySelector("svg");
      if (!svgEl) return;
      dimsRef.current = readSvgNaturalSize(svgEl);
      fitToView();
    };

    measureAndFit();
    const raf = requestAnimationFrame(measureAndFit);

    const ro = new ResizeObserver(() => {
      measureAndFit();
    });
    ro.observe(vp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [svg, fitToView]);

  const zoomAtCenter = useCallback((factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const pw = vp.clientWidth;
    const ph = vp.clientHeight;
    const cx = pw / 2;
    const cy = ph / 2;
    setScale((prev) => {
      const safePrev = Math.max(prev, 1e-6);
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
      setTx((txPrev) => {
        const wx = (cx - txPrev) / safePrev;
        return cx - wx * next;
      });
      setTy((tyPrev) => {
        const wy = (cy - tyPrev) / safePrev;
        return cy - wy * next;
      });
      return next;
    });
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR;
      zoomAtCenter(factor);
    },
    [zoomAtCenter],
  );

  const onPointerDownPan = useCallback(
    (e: React.PointerEvent) => {
      if (!panMode) return;
      if (e.button !== 0) return;
      draggingRef.current = true;
      setDraggingUi(true);
      lastPtr.current = { x: e.clientX, y: e.clientY };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [panMode],
  );

  const onPointerMovePan = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPtr.current.x;
    const dy = e.clientY - lastPtr.current.y;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    setTx((t) => t + dx);
    setTy((t) => t + dy);
  }, []);

  const onPointerUpPan = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    setDraggingUi(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback */
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        /* silent */
      }
    }
  }, [code]);

  const downloadPng = useCallback(async () => {
    if (!svg || exporting) return;
    setExporting(true);
    try {
      const blob = await svgStringToPngBlob(svg, 2);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      triggerDownload(blob, `mermaid-${stamp}.png`);
    } catch {
      /* optional: could surface toast */
    } finally {
      setExporting(false);
    }
  }, [svg, exporting]);

  if (failed) {
    return (
      <div className="my-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          <span>Mermaid 渲染失败，以下为源码。</span>
          <button
            type="button"
            className="no-drag rounded border border-amber-500/50 px-2 py-0.5 text-[11px] hover:bg-amber-500/20"
            onClick={() => void copyCode()}
          >
            {copied ? "已复制" : "复制源码"}
          </button>
        </div>
        <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-surface-panel/80 p-3 text-xs">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-2 rounded-md border border-border bg-surface-panel/50 px-3 py-6 text-center text-xs text-text-faint">
        正在渲染图表…
      </div>
    );
  }

  return (
    <div className="group/mmd relative my-2 overflow-hidden rounded-md border border-border bg-surface-panel/50">
      <div
        className="no-drag pointer-events-auto absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border px-1 py-0.5 opacity-60 shadow-md transition-opacity duration-150 group-hover/mmd:opacity-100"
        style={{
          background: "color-mix(in srgb, var(--surface-card) 92%, transparent)",
          borderColor: "var(--border-subtle)",
        }}
        title="Ctrl/⌘ + 滚轮缩放"
      >
        <ToolbarButton
          title="平移（拖动画布）"
          active={panMode}
          onClick={() => setPanMode((v) => !v)}
        >
          <Move className="h-4 w-4" strokeWidth={2} />
        </ToolbarButton>
        <ToolbarButton title="缩小" onClick={() => zoomAtCenter(1 / ZOOM_FACTOR)}>
          <ZoomOut className="h-4 w-4" strokeWidth={2} />
        </ToolbarButton>
        <ToolbarButton title="放大" onClick={() => zoomAtCenter(ZOOM_FACTOR)}>
          <ZoomIn className="h-4 w-4" strokeWidth={2} />
        </ToolbarButton>
        <ToolbarButton title="适应窗口" onClick={fitToView}>
          <Minimize2 className="h-4 w-4" strokeWidth={2} />
        </ToolbarButton>
        <div
          className="mx-0.5 h-5 w-px shrink-0"
          style={{ background: "var(--border-subtle)" }}
          aria-hidden
        />
        <ToolbarButton title="复制 Mermaid 源码" onClick={() => void copyCode()}>
          <Copy className="h-4 w-4" strokeWidth={2} />
        </ToolbarButton>
        <ToolbarButton
          title={exporting ? "导出中…" : "下载 PNG"}
          onClick={() => void downloadPng()}
        >
          <Download className={`h-4 w-4 ${exporting ? "opacity-50" : ""}`} strokeWidth={2} />
        </ToolbarButton>
      </div>

      {copied ? (
        <div className="pointer-events-none absolute right-2 top-2 z-10 rounded border border-border bg-surface-panel/95 px-2 py-0.5 text-[11px] text-text-faint">
          已复制源码
        </div>
      ) : null}

      <div
        ref={viewportRef}
        title="悬停顶部工具栏高亮；Ctrl/⌘ + 滚轮缩放"
        className={`relative w-full touch-none overflow-hidden ${panMode ? (draggingUi ? "cursor-grabbing" : "cursor-grab") : "cursor-default"}`}
        style={{
          minHeight: VIEWPORT_MIN_H,
          maxHeight: VIEWPORT_MAX_H,
          height: VIEWPORT_MIN_H,
        }}
        onWheel={onWheel}
      >
        <div
          ref={contentRef}
          role="presentation"
          className="inline-block origin-top-left will-change-transform [&_svg]:block [&_svg]:max-h-none [&_svg]:max-w-none"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          }}
          onPointerDown={onPointerDownPan}
          onPointerMove={onPointerMovePan}
          onPointerUp={onPointerUpPan}
          onPointerCancel={onPointerUpPan}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

    </div>
  );
}
