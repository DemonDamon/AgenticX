import { useEffect, useMemo, useRef, useState } from "react";
import { Code, Copy, Download, Image, Maximize2, MoreHorizontal, X } from "lucide-react";
import { collectThemeCssVars, exportSurfaceColor } from "../../utils/widget-theme";
import { Modal } from "../ds/Modal";
import { ZoomableViewport } from "../ds/ZoomableViewport";
import { StockChartWidgetBlock } from "./StockChartWidget";
import type { HtmlWidgetPayload, WidgetPayload } from "./widget-preview";

type Props = {
  payload: WidgetPayload;
};

const CDN_ALLOW =
  "https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com";

/**
 * Sanitize and normalise an SVG string for inline display:
 *  - strip <script> and on* event attrs (XSS)
 *  - ensure viewBox exists (so width:100% preserves aspect ratio)
 *  - remove explicit width/height attrs (CSS controls sizing)
 * Returns the resulting SVG markup string, or null on parse error.
 */
function buildSanitizedSvgHtml(code: string): string | null {
  const doc = new DOMParser().parseFromString(code, "image/svg+xml");
  const root = doc.documentElement;
  if (root.querySelector("parsererror")) return null;

  doc.querySelectorAll("script").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    });
  });

  // Ensure a valid viewBox so `width:100%; height:auto` preserves aspect ratio.
  if (!root.getAttribute("viewBox")) {
    const w = parseSvgLength(root.getAttribute("width"), 680);
    const h = parseSvgLength(root.getAttribute("height"), Math.round(w * 0.65));
    root.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }

  // Remove fixed pixel dimensions – CSS will take over.
  root.removeAttribute("width");
  root.removeAttribute("height");

  return new XMLSerializer().serializeToString(root);
}

/**
 * 从 SVG code 解析 viewBox 宽高，返回逻辑尺寸 { w, h }。
 */
function parseSvgAspect(code: string): { w: number; h: number } {
  const vbMatch = code.match(/viewBox=["']\s*([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)\s*["']/i);
  if (vbMatch) {
    const w = parseFloat(vbMatch[3]!);
    const h = parseFloat(vbMatch[4]!);
    if (w > 0 && h > 0) return { w, h };
  }
  const wMatch = code.match(/\bwidth=["']([\d.]+)/i);
  const hMatch = code.match(/\bheight=["']([\d.]+)/i);
  const w = wMatch ? parseFloat(wMatch[1]!) : 680;
  const h = hMatch ? parseFloat(hMatch[1]!) : Math.round(w * 0.65);
  return { w: w > 0 ? w : 680, h: h > 0 ? h : 442 };
}

/**
 * Renders the SVG via dangerouslySetInnerHTML so the element lives in the
 * current document from the very first paint – avoids cross-document node
 * adoption timing issues that caused the "empty white box" artefact.
 *
 * preview=true（默认）:
 *   - 按 SVG viewBox 的自然宽度展示，最小 640px、最大 900px
 *   - 宽高比精确还原，无硬截断、无多余空白
 *   - 若气泡比 SVG 窄则水平滚动，字迹/细节保持清晰
 * preview=false: 在放大弹窗的 ZoomableViewport 内使用，撑满舞台宽度。
 */
function SvgWidget({ code, preview = true }: { code: string; preview?: boolean }) {
  const html = useMemo(() => buildSanitizedSvgHtml(code), [code]);
  const aspect = useMemo(() => parseSvgAspect(code), [code]);

  if (!html) return null;

  if (preview) {
    // 渲染宽度 = clamp(svgNaturalWidth, 640, 900)
    // height 用 padding-top trick 精确还原宽高比，不截断也不留白
    const displayW = Math.min(900, Math.max(640, aspect.w));
    const displayH = Math.round((displayW * aspect.h) / aspect.w);
    return (
      <div style={{ width: displayW, height: displayH }}>
        <div
          style={{ width: "100%", height: "100%" }}
          className="[&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  // 弹窗舞台内：撑满舞台宽度，高度 auto
  return (
    <div
      className="w-full [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function HtmlWidget({ code, loadingMessages }: { code: string; loadingMessages: string[] }) {
  const [height, setHeight] = useState(200);
  const [loaded, setLoaded] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const cssVars = useMemo(() => collectThemeCssVars(), []);

  const srcDoc = useMemo(
    () => `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; script-src 'unsafe-inline' ${CDN_ALLOW}; connect-src ${CDN_ALLOW};">
<style>:root{${cssVars}} body{margin:0;background:transparent;font-family:var(--font-sans,system-ui);color:var(--text-primary,#222)}</style>
</head><body>${code}
<script>(function(){function r(){var h=document.body.scrollHeight;parent.postMessage({__agxWidget:1,height:h},'*');}if(typeof ResizeObserver!=='undefined'){new ResizeObserver(r).observe(document.body);}window.addEventListener('load',r);r();})();</script>
</body></html>`,
    [code, cssVars],
  );

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const data = e.data as { __agxWidget?: number; height?: number } | null;
      if (data && data.__agxWidget === 1 && typeof data.height === "number") {
        setHeight(Math.min(Math.max(data.height, 80), 1200));
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    if (loaded || loadingMessages.length === 0) return undefined;
    const timer = window.setInterval(() => {
      setLoadingIndex((idx) => (idx + 1) % loadingMessages.length);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [loaded, loadingMessages]);

  const loadingLabel =
    loadingMessages.length > 0
      ? loadingMessages[loadingIndex] ?? "渲染中…"
      : "渲染中…";

  return (
    <div className="relative w-full">
      {!loaded ? (
        <div className="absolute inset-0 z-[1] flex items-center justify-center rounded-md bg-[var(--surface-popover)] text-[13px] text-text-muted">
          {loadingLabel}
        </div>
      ) : null}
      <iframe
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        title="widget"
        className="block w-full"
        style={{ border: "none", height }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}

function parseSvgLength(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = parseFloat(raw.replace(/%/g, ""));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseViewBoxSize(svg: Element): { w: number; h: number } {
  const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2]! > 0 && vb[3]! > 0) {
    return { w: vb[2]!, h: vb[3]! };
  }
  const w = parseSvgLength(svg.getAttribute("width"), 680);
  const h = parseSvgLength(svg.getAttribute("height"), Math.round(w * 0.65));
  return { w, h };
}

function rasterExportScale(): number {
  return Math.max(4, Math.ceil((window.devicePixelRatio || 1) * 3));
}

/** Normalize SVG with explicit pixel size + theme vars + opaque backdrop for PNG export. */
function buildRasterizableSvg(
  svgCode: string,
  cssWidthPx: number,
  liveSvg?: SVGSVGElement | null,
): string | null {
  const serializedLive = liveSvg
    ? new XMLSerializer().serializeToString(liveSvg)
    : null;
  const doc = new DOMParser().parseFromString(serializedLive ?? svgCode, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.querySelector("parsererror")) return null;

  doc.querySelectorAll("script").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    });
  });

  if (!svg.getAttribute("xmlns")) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }

  const logical = parseViewBoxSize(svg);
  const cssW = Math.max(1, Math.round(cssWidthPx));
  const scale = rasterExportScale();
  const exportW = Math.round(cssW * scale);
  const exportH = Math.max(1, Math.round((exportW * logical.h) / logical.w));

  svg.setAttribute("viewBox", `0 0 ${logical.w} ${logical.h}`);
  svg.setAttribute("width", String(exportW));
  svg.setAttribute("height", String(exportH));

  const themeCss = collectThemeCssVars();
  if (themeCss) {
    const styleEl = doc.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = `:root, svg { ${themeCss} }`;
    svg.insertBefore(styleEl, svg.firstChild);
  }

  const bgColor = exportSurfaceColor();
  const bgRect = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("x", "0");
  bgRect.setAttribute("y", "0");
  bgRect.setAttribute("width", String(logical.w));
  bgRect.setAttribute("height", String(logical.h));
  bgRect.setAttribute("fill", bgColor);
  const insertBefore = svg.querySelector("style")?.nextSibling ?? svg.firstChild;
  if (insertBefore) {
    svg.insertBefore(bgRect, insertBefore);
  } else {
    svg.appendChild(bgRect);
  }

  return new XMLSerializer().serializeToString(svg);
}

function svgToPngBlob(
  svgCode: string,
  cssWidthPx?: number,
  liveSvg?: SVGSVGElement | null,
): Promise<Blob | null> {
  const widthPx = cssWidthPx && cssWidthPx > 0 ? cssWidthPx : 680;
  const exportSvg = buildRasterizableSvg(svgCode, widthPx, liveSvg);
  if (!exportSvg) return Promise.resolve(null);
  const bgColor = exportSurfaceColor();

  return new Promise((resolve) => {
    const blob = new Blob([exportSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
      }
      canvas.toBlob((pngBlob) => {
        URL.revokeObjectURL(url);
        resolve(pngBlob);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function WidgetMenu({
  payload,
  getSvgDisplayWidth,
  getLiveSvg,
}: {
  payload: HtmlWidgetPayload;
  getSvgDisplayWidth?: () => number;
  getLiveSvg?: () => SVGSVGElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [viewCode, setViewCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function downloadFile() {
    const ext = payload.kind === "svg" ? "svg" : "html";
    const mime = payload.kind === "svg" ? "image/svg+xml" : "text/html";
    const blob = new Blob([payload.widgetCode], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.title || "widget"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  async function downloadImage() {
    if (payload.kind !== "svg") return;
    const pngBlob = await svgToPngBlob(payload.widgetCode, getSvgDisplayWidth?.(), getLiveSvg?.());
    if (!pngBlob) return;
    const url = URL.createObjectURL(pngBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payload.title || "widget"}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  async function copyImage() {
    if (payload.kind !== "svg") return;
    try {
      const pngBlob = await svgToPngBlob(payload.widgetCode, getSvgDisplayWidth?.(), getLiveSvg?.());
      if (!pngBlob) return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  async function copyCodeToClipboard() {
    try {
      await navigator.clipboard.writeText(payload.widgetCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div ref={menuRef} className="absolute right-2 top-2 z-10">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded border border-border bg-[var(--surface-popover)] text-text-faint shadow-sm transition hover:bg-[var(--surface-card-strong)] hover:text-text-subtle"
          title="更多操作"
        >
          {copied ? (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 8.5L6 11.5L13 4.5" />
            </svg>
          ) : (
            <MoreHorizontal size={14} />
          )}
        </button>
        {open && (
          <div className="absolute right-0 top-7 min-w-[148px] rounded-lg border border-border bg-[var(--surface-popover)] py-1 shadow-lg">
            <button
              type="button"
              onClick={downloadFile}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-text-subtle hover:bg-[var(--surface-hover)]"
            >
              <Download size={13} className="shrink-0" />
              下载到本地
            </button>
            {payload.kind === "svg" && (
              <button
                type="button"
                onClick={downloadImage}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-text-subtle hover:bg-[var(--surface-hover)]"
              >
                <Image size={13} className="shrink-0" />
                下载为图片
              </button>
            )}
            {payload.kind === "svg" && (
              <button
                type="button"
                onClick={copyImage}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-text-subtle hover:bg-[var(--surface-hover)]"
              >
                <Copy size={13} className="shrink-0" />
                复制图片
              </button>
            )}
            <button
              type="button"
              onClick={() => { setViewCode(true); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-text-subtle hover:bg-[var(--surface-hover)]"
            >
              <Code size={13} className="shrink-0" />
              查看代码
            </button>
          </div>
        )}
      </div>

      {viewCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black p-4"
          onClick={() => setViewCode(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-[var(--surface-popover)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-[13px] font-medium text-text-primary">
                {payload.title ? `${payload.title} — 源代码` : "源代码"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void copyCodeToClipboard()}
                  className="flex h-7 w-7 items-center justify-center rounded text-text-faint transition hover:bg-[var(--surface-hover)] hover:text-text-subtle"
                  title="复制代码"
                >
                  {codeCopied ? (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 8.5L6 11.5L13 4.5" />
                    </svg>
                  ) : (
                    <Copy size={15} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setViewCode(false)}
                  className="flex h-7 w-7 items-center justify-center rounded text-text-faint transition hover:bg-[var(--surface-hover)] hover:text-text-subtle"
                  title="关闭"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-[12px] leading-relaxed text-text-primary">
              {payload.widgetCode}
            </pre>
          </div>
        </div>
      )}
    </>
  );
}

function ZoomButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-9 top-2 z-10 flex h-6 w-6 items-center justify-center rounded border border-border bg-[var(--surface-popover)] text-text-faint shadow-sm transition hover:bg-[var(--surface-card-strong)] hover:text-text-subtle"
      title="放大查看"
    >
      <Maximize2 size={13} />
    </button>
  );
}

export function WidgetBlock({ payload }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [zoomOpen, setZoomOpen] = useState(false);

  if (payload.kind === "stock_chart") {
    return <StockChartWidgetBlock payload={payload} />;
  }

  const getSvgDisplayWidth = () => {
    const svg = hostRef.current?.querySelector("svg");
    const w = svg?.getBoundingClientRect().width;
    return w && w > 0 ? w : 680;
  };

  const getLiveSvg = () => hostRef.current?.querySelector("svg") ?? null;

  if (payload.kind === "svg") {
    return (
      <>
        {/*
          外框不再强制 w-full：用 inline-block + max-w-full 让容器收缩至 SVG 实际宽度，
          同时 mx-auto 保持居中。这样边框贴合内容，不会在窄 SVG 两侧留大片空白。
        */}
        {/*
          overflow-x-auto: 若气泡列比 SVG 自然宽度窄，水平滚动而非压缩。
          inline-block + max-w-full: 外框随 SVG 内容宽度收缩，不留多余空白。
        */}
        <div
          ref={hostRef}
          className="relative inline-block max-w-full overflow-x-auto rounded-md border border-border"
        >
          <SvgWidget code={payload.widgetCode} preview />
          <ZoomButton onClick={() => setZoomOpen(true)} />
          <WidgetMenu
            payload={payload}
            getSvgDisplayWidth={getSvgDisplayWidth}
            getLiveSvg={getLiveSvg}
          />
        </div>
        <Modal
          open={zoomOpen}
          title={payload.title || "查看图表"}
          onClose={() => setZoomOpen(false)}
          panelClassName="w-[92vw] max-w-5xl bg-surface-popover"
        >
          <ZoomableViewport stageWidth={900} viewportHeight="75vh">
            <SvgWidget code={payload.widgetCode} preview={false} />
          </ZoomableViewport>
        </Modal>
      </>
    );
  }

  return (
    <>
      <div className="relative w-full overflow-hidden rounded-md border border-border bg-[var(--surface-popover)] p-1">
        <HtmlWidget code={payload.widgetCode} loadingMessages={payload.loadingMessages} />
        <ZoomButton onClick={() => setZoomOpen(true)} />
        <WidgetMenu payload={payload} />
      </div>
      <Modal
        open={zoomOpen}
        title={payload.title || "查看图表"}
        onClose={() => setZoomOpen(false)}
        panelClassName="w-[92vw] max-w-5xl bg-surface-popover"
      >
        <ZoomableViewport stageWidth={900} viewportHeight="75vh">
          <HtmlWidget code={payload.widgetCode} loadingMessages={payload.loadingMessages} />
        </ZoomableViewport>
      </Modal>
    </>
  );
}
