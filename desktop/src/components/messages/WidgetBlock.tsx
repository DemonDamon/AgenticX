import { useEffect, useMemo, useRef, useState } from "react";
import { Code, Copy, Download, Image, MoreHorizontal, X } from "lucide-react";
import { collectThemeCssVars, exportSurfaceColor } from "../../utils/widget-theme";
import type { WidgetPayload } from "./widget-preview";

type Props = {
  payload: WidgetPayload;
};

const CDN_ALLOW =
  "https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com";

function sanitizeSvgCode(code: string): Element | null {
  const doc = new DOMParser().parseFromString(code, "image/svg+xml");
  const root = doc.documentElement;
  if (root.querySelector("parsererror")) return null;
  doc.querySelectorAll("script").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (attr.name.toLowerCase().startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return root;
}

function SvgWidget({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const svg = sanitizeSvgCode(code);
    ref.current.replaceChildren();
    if (svg) {
      ref.current.appendChild(svg);
    }
  }, [code]);

  return <div ref={ref} className="w-full overflow-x-auto" />;
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
  payload: WidgetPayload;
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

export function WidgetBlock({ payload }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  const getSvgDisplayWidth = () => {
    const svg = hostRef.current?.querySelector("svg");
    const w = svg?.getBoundingClientRect().width;
    return w && w > 0 ? w : 680;
  };

  const getLiveSvg = () => hostRef.current?.querySelector("svg") ?? null;

  if (payload.kind === "svg") {
    return (
      <div
        ref={hostRef}
        className="relative w-full overflow-hidden rounded-md border border-border bg-[var(--surface-popover)] p-2"
      >
        <SvgWidget code={payload.widgetCode} />
        <WidgetMenu
          payload={payload}
          getSvgDisplayWidth={getSvgDisplayWidth}
          getLiveSvg={getLiveSvg}
        />
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-md border border-border bg-[var(--surface-popover)] p-1">
      <HtmlWidget code={payload.widgetCode} loadingMessages={payload.loadingMessages} />
      <WidgetMenu payload={payload} />
    </div>
  );
}
