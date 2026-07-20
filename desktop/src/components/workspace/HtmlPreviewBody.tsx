import { useEffect, useMemo, useRef, useState } from "react";
import { prepareLocalHtmlSrcDoc } from "../../utils/html-preview-assets";
import {
  HTML_INSPECT_BRIDGE_VERSION,
  HTML_INSPECT_MSG,
  injectHtmlInspectBridge,
  isHtmlInspectChildMessage,
  type HtmlElementSelection,
  type HtmlInspectParentMessage,
} from "../../utils/html-preview-inspect";
import {
  DEFAULT_HTML_PREVIEW_VIEWPORT,
  isFixedViewport,
  type HtmlPreviewViewport,
} from "./html-preview-device";
import {
  computePopupAnchorFromRect,
  type SelectionPopupAnchor,
} from "./selection-quote-popover";

export type HtmlPreviewElementHit = HtmlElementSelection & {
  anchor: SelectionPopupAnchor;
};

type HtmlPreviewBodyProps = {
  content: string;
  title?: string;
  /** Absolute path of the HTML file — used to inline relative local assets for srcDoc. */
  documentPath?: string;
  inspectEnabled?: boolean;
  onInspectEnabledChange?: (enabled: boolean) => void;
  viewport?: HtmlPreviewViewport;
  /** Fired when user clicks an element in inspect mode (or null on clear/escape). */
  onElementHitChange?: (hit: HtmlPreviewElementHit | null) => void;
  /** Bump to clear iframe selection overlay after add-to-chat. */
  clearSelectionKey?: number;
};

/**
 * Render HTML via a sandboxed iframe (srcDoc).
 * Scripts may run inside the frame, but cannot touch the parent document
 * (no allow-same-origin). When `documentPath` is set, relative local assets
 * (e.g. sibling `.svg`) are rewritten to data URLs before render.
 * Select-element inspect is injected into srcDoc and uses postMessage.
 */
export function HtmlPreviewBody({
  content,
  title,
  documentPath,
  inspectEnabled = false,
  onInspectEnabledChange,
  viewport = DEFAULT_HTML_PREVIEW_VIEWPORT,
  onElementHitChange,
  clearSelectionKey = 0,
}: HtmlPreviewBodyProps) {
  const [baseSrcDoc, setBaseSrcDoc] = useState(content);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onHitRef = useRef(onElementHitChange);
  onHitRef.current = onElementHitChange;
  const lastHitRef = useRef<HtmlPreviewElementHit | null>(null);

  useEffect(() => {
    let cancelled = false;
    const path = String(documentPath || "").trim();
    if (!path) {
      setBaseSrcDoc(content);
      return;
    }
    void prepareLocalHtmlSrcDoc(path, content).then((next) => {
      if (!cancelled) setBaseSrcDoc(next);
    });
    return () => {
      cancelled = true;
    };
  }, [content, documentPath]);

  const srcDoc = useMemo(
    () => injectHtmlInspectBridge(baseSrcDoc),
    [baseSrcDoc, HTML_INSPECT_BRIDGE_VERSION]
  );

  const postToFrame = (msg: HtmlInspectParentMessage) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  };

  useEffect(() => {
    postToFrame({
      type: HTML_INSPECT_MSG,
      action: "set-enabled",
      enabled: inspectEnabled,
    });
    if (!inspectEnabled) {
      lastHitRef.current = null;
      onHitRef.current?.(null);
    }
  }, [inspectEnabled, srcDoc]);

  useEffect(() => {
    if (!clearSelectionKey) return;
    postToFrame({ type: HTML_INSPECT_MSG, action: "clear-selection" });
    lastHitRef.current = null;
    onHitRef.current?.(null);
  }, [clearSelectionKey]);

  useEffect(() => {
    const mapRectToAnchor = (rect: {
      top: number;
      left: number;
      width: number;
      height: number;
    }): SelectionPopupAnchor | null => {
      const iframe = iframeRef.current;
      if (!iframe) return null;
      const frameBox = iframe.getBoundingClientRect();
      const scaleX = frameBox.width / Math.max(1, iframe.clientWidth || frameBox.width);
      const scaleY = frameBox.height / Math.max(1, iframe.clientHeight || frameBox.height);
      const mapped = new DOMRect(
        frameBox.left + rect.left * scaleX,
        frameBox.top + rect.top * scaleY,
        Math.max(1, rect.width * scaleX),
        Math.max(1, rect.height * scaleY)
      );
      return computePopupAnchorFromRect(mapped);
    };

    const onMessage = (ev: MessageEvent) => {
      if (!isHtmlInspectChildMessage(ev.data)) return;
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || ev.source !== iframe.contentWindow) return;
      const data = ev.data;
      if (data.action === "escape") {
        lastHitRef.current = null;
        onHitRef.current?.(null);
        onInspectEnabledChange?.(false);
        return;
      }
      if (data.action === "leave") {
        return;
      }
      if (data.action === "hover") {
        return;
      }
      if (data.action === "rect-update") {
        const prev = lastHitRef.current;
        if (!prev) return;
        const anchor = mapRectToAnchor(data.rect);
        if (!anchor) return;
        const next: HtmlPreviewElementHit = { ...prev, rect: data.rect, anchor };
        lastHitRef.current = next;
        onHitRef.current?.(next);
        return;
      }
      if (data.action === "select") {
        const anchor = mapRectToAnchor(data.rect);
        if (!anchor) return;
        const hit: HtmlPreviewElementHit = {
          tagName: data.tagName,
          selectorHint: data.selectorHint,
          outerHTML: data.outerHTML,
          innerText: data.innerText,
          rect: data.rect,
          anchor,
        };
        lastHitRef.current = hit;
        onHitRef.current?.(hit);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onInspectEnabledChange]);

  // When the preview chrome scrolls (iframe moves on screen), rematerialize the
  // parent popover from the last iframe-local rect — green overlay lives inside
  // the iframe and moves with it; the Trae toolbar is position:fixed on the host.
  useEffect(() => {
    const remapHostAnchor = () => {
      const prev = lastHitRef.current;
      if (!prev) return;
      const iframe = iframeRef.current;
      if (!iframe) return;
      const frameBox = iframe.getBoundingClientRect();
      const scaleX = frameBox.width / Math.max(1, iframe.clientWidth || frameBox.width);
      const scaleY = frameBox.height / Math.max(1, iframe.clientHeight || frameBox.height);
      const rect = prev.rect;
      const mapped = new DOMRect(
        frameBox.left + rect.left * scaleX,
        frameBox.top + rect.top * scaleY,
        Math.max(1, rect.width * scaleX),
        Math.max(1, rect.height * scaleY)
      );
      const anchor = computePopupAnchorFromRect(mapped);
      if (!anchor) return;
      const next: HtmlPreviewElementHit = { ...prev, anchor };
      lastHitRef.current = next;
      onHitRef.current?.(next);
    };
    window.addEventListener("scroll", remapHostAnchor, true);
    window.addEventListener("resize", remapHostAnchor);
    return () => {
      window.removeEventListener("scroll", remapHostAnchor, true);
      window.removeEventListener("resize", remapHostAnchor);
    };
  }, []);

  const fixed = isFixedViewport(viewport);
  const zoom = Math.max(25, Math.min(300, viewport.zoomPercent || 100)) / 100;

  const frame = (
    <iframe
      ref={iframeRef}
      title={title ?? "HTML 预览"}
      className="block border-0 bg-white"
      style={
        fixed
          ? {
              width: viewport.width!,
              height: viewport.height!,
              transform: zoom !== 1 ? `scale(${zoom})` : undefined,
              transformOrigin: "top left",
            }
          : {
              width: zoom !== 1 ? `${100 / zoom}%` : "100%",
              height: zoom !== 1 ? `${100 / zoom}%` : "100%",
              minHeight: 220,
              transform: zoom !== 1 ? `scale(${zoom})` : undefined,
              transformOrigin: "top left",
            }
      }
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      onLoad={() => {
        postToFrame({
          type: HTML_INSPECT_MSG,
          action: "set-enabled",
          enabled: inspectEnabled,
        });
      }}
    />
  );

  if (!fixed && zoom === 1) {
    return <div className="h-full min-h-[220px] w-full">{frame}</div>;
  }

  const shellW = fixed ? Math.ceil((viewport.width ?? 0) * zoom) : "100%";
  const shellH = fixed ? Math.ceil((viewport.height ?? 0) * zoom) : "100%";

  return (
    <div className="flex h-full min-h-0 w-full justify-center overflow-auto bg-[color-mix(in_oklab,var(--surface-hover)_80%,transparent)] p-3">
      <div
        className="relative shrink-0 overflow-hidden rounded-md border border-border bg-white shadow-sm"
        style={{
          width: shellW,
          height: shellH,
          minHeight: fixed ? undefined : 220,
        }}
      >
        {frame}
      </div>
    </div>
  );
}

export function isHtmlPreviewPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}
