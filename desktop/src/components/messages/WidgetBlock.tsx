import { useEffect, useMemo, useRef, useState } from "react";
import { collectThemeCssVars } from "../../utils/widget-theme";
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
        <div className="absolute inset-0 z-[1] flex items-center justify-center rounded-md bg-surface-card/80 text-[13px] text-text-muted">
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

export function WidgetBlock({ payload }: Props) {
  if (payload.kind === "svg") {
    return (
      <div className="w-full overflow-hidden rounded-md border border-border bg-surface-card/40 p-2">
        <SvgWidget code={payload.widgetCode} />
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-md border border-border bg-surface-card/40 p-1">
      <HtmlWidget code={payload.widgetCode} loadingMessages={payload.loadingMessages} />
    </div>
  );
}
