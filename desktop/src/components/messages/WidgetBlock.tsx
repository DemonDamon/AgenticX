import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Code, Copy, Download, Image, Maximize2, MoreHorizontal, X } from "lucide-react";
import { collectThemeCssVars, exportSurfaceColor } from "../../utils/widget-theme";
import { Modal } from "../ds/Modal";
import { ZoomableViewport } from "../ds/ZoomableViewport";
import { StockChartWidgetBlock } from "./StockChartWidget";
import type { HtmlWidgetPayload, WidgetPayload } from "./widget-preview";

type Props = {
  payload: WidgetPayload;
  streaming?: boolean;
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

function readSvgLogicalSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    return { w: vb.width, h: vb.height };
  }
  const w = parseSvgLength(svg.getAttribute("width"), 680);
  const h = parseSvgLength(svg.getAttribute("height"), Math.round(w * 0.65));
  return { w, h };
}

/** Expand viewBox when authored bounds clip content (common with undersized LLM SVG). */
function fitSvgViewBoxToContent(svg: SVGSVGElement, padding = 16): { w: number; h: number } {
  const declared = readSvgLogicalSize(svg);
  try {
    const bbox = svg.getBBox();
    if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
      return declared;
    }
    const x = Math.min(0, bbox.x - padding);
    const y = Math.min(0, bbox.y - padding);
    const right = Math.max(declared.w, bbox.x + bbox.width + padding);
    const bottom = Math.max(declared.h, bbox.y + bbox.height + padding);
    const w = Math.ceil(right - x);
    const h = Math.ceil(bottom - y);
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    return { w, h };
  } catch {
    return declared;
  }
}

/**
 * Renders the SVG via dangerouslySetInnerHTML so the element lives in the
 * current document from the very first paint – avoids cross-document node
 * adoption timing issues that caused the "empty white box" artefact.
 *
 * preview=true（默认）:
 *   - 按 viewBox / 实际内容 bbox 自适应宽高（1 逻辑单位 ≈ 1 CSS px），不同图尺寸不同
 *   - 容器 mx-auto + max-w-full：在气泡内居中，过宽时等比缩小而非硬压 viewBox
 * preview=false: 在放大弹窗的 ZoomableViewport 内使用，撑满舞台宽度。
 */
function SvgWidget({ code, preview = true }: { code: string; preview?: boolean }) {
  const html = useMemo(() => buildSanitizedSvgHtml(code), [code]);
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => parseSvgAspect(code));

  useEffect(() => {
    setSize(parseSvgAspect(code));
  }, [code]);

  useLayoutEffect(() => {
    const svg = hostRef.current?.querySelector("svg");
    if (!svg) return;
    setSize(fitSvgViewBoxToContent(svg));
  }, [html]);

  if (!html) return null;

  if (preview) {
    return (
      <div
        ref={hostRef}
        className="mx-auto w-fit max-w-full"
        style={{
          width: size.w,
          aspectRatio: `${size.w} / ${size.h}`,
        }}
      >
        <div
          className="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  // 弹窗舞台内：撑满舞台宽度，高度 auto
  return (
    <div
      ref={hostRef}
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
  return Math.min(4, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 2)));
}

const MAX_CANVAS_PX = 8192;

/** Normalize SVG with logical pixel size + theme vars + opaque backdrop for PNG export. */
function buildRasterizableSvg(
  svgCode: string,
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
  svg.setAttribute("viewBox", `0 0 ${logical.w} ${logical.h}`);
  svg.setAttribute("width", String(logical.w));
  svg.setAttribute("height", String(logical.h));

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

function loadSvgMarkupAsImage(svgMarkup: string): Promise<HTMLImageElement> {
  const trySrc = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("SVG raster load failed"));
      img.src = src;
    });

  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
  return trySrc(dataUrl).catch(() => {
    const blob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    return trySrc(blobUrl).finally(() => URL.revokeObjectURL(blobUrl));
  });
}

function svgToPngBlob(
  svgCode: string,
  _cssWidthPx?: number,
  liveSvg?: SVGSVGElement | null,
): Promise<Blob | null> {
  const exportSvg = buildRasterizableSvg(svgCode, liveSvg);
  if (!exportSvg) return Promise.resolve(null);

  const doc = new DOMParser().parseFromString(exportSvg, "image/svg+xml");
  const logical = parseViewBoxSize(doc.documentElement);
  const bgColor = exportSurfaceColor();
  const pixelRatio = rasterExportScale();

  return loadSvgMarkupAsImage(exportSvg)
    .then((img) => {
      let cw = Math.max(1, Math.ceil(logical.w * pixelRatio));
      let ch = Math.max(1, Math.ceil(logical.h * pixelRatio));
      const longest = Math.max(cw, ch);
      if (longest > MAX_CANVAS_PX) {
        const shrink = MAX_CANVAS_PX / longest;
        cw = Math.max(1, Math.floor(cw * shrink));
        ch = Math.max(1, Math.floor(ch * shrink));
      }

      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const scaleX = cw / logical.w;
      const scaleY = ch / logical.h;
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(img, 0, 0, logical.w, logical.h);

      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((pngBlob) => resolve(pngBlob), "image/png", 1);
      });
    })
    .catch(() => null);
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    triggerBlobDownload(blob, `${payload.title || "widget"}.${ext}`);
    setOpen(false);
  }

  async function downloadImage() {
    if (payload.kind !== "svg") return;
    setOpen(false);

    const pngBlob = await svgToPngBlob(payload.widgetCode, getSvgDisplayWidth?.(), getLiveSvg?.());
    if (!pngBlob) return;

    const filename = `${payload.title || "widget"}.png`;
    const desktop = window.agenticxDesktop;
    if (desktop?.downloadPngToDownloads) {
      const res = await desktop.downloadPngToDownloads({
        buffer: await pngBlob.arrayBuffer(),
        defaultFileName: filename,
      });
      if (res.ok) return;
    }

    triggerBlobDownload(pngBlob, filename);
  }

  async function copyImage() {
    if (payload.kind !== "svg") return;
    setOpen(false);

    const displayWidth = getSvgDisplayWidth?.();
    const liveSvg = getLiveSvg?.();
    const pngPromise = svgToPngBlob(payload.widgetCode, displayWidth, liveSvg).then((blob) => {
      if (!blob) throw new Error("PNG export failed");
      return blob;
    });

    try {
      if (
        typeof window.ClipboardItem !== "undefined" &&
        typeof navigator.clipboard?.write === "function"
      ) {
        // Pass a Promise so rasterization can finish without losing the user-gesture window.
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngPromise })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        return;
      }
    } catch {
      /* fall through to Electron IPC */
    }

    try {
      const blob = await pngPromise;
      const desktop = window.agenticxDesktop;
      if (desktop?.copyPngToClipboard) {
        const res = await desktop.copyPngToClipboard(await blob.arrayBuffer());
        if (res.ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }
    } catch {
      /* ignore */
    }
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

export function WidgetBlock({ payload, streaming = false }: Props) {
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
        <div className="flex w-full justify-center">
          <div
            ref={hostRef}
            className="relative w-fit max-w-full overflow-x-auto rounded-md border border-border"
          >
            <SvgWidget code={payload.widgetCode} preview />
            {streaming ? (
              <div className="absolute right-2 top-2 rounded bg-[var(--surface-popover)]/85 px-1.5 py-0.5 text-[11px] text-text-muted">
                绘制中…
              </div>
            ) : (
              <>
                <ZoomButton onClick={() => setZoomOpen(true)} />
                <WidgetMenu
                  payload={payload}
                  getSvgDisplayWidth={getSvgDisplayWidth}
                  getLiveSvg={getLiveSvg}
                />
              </>
            )}
          </div>
        </div>
        {!streaming ? (
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
        ) : null}
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
