import {
  computePopupAnchorFromRect,
  type SelectionPopupAnchor,
} from "../workspace/selection-quote-popover";

export type BrowserGuestSelection = {
  text: string;
  /** Guest viewport rect (CSS px before host offset / zoom). */
  rect: { top: number; left: number; width: number; height: number };
};

export type BrowserQuotePayload = {
  text: string;
  url: string;
  title: string;
};

/**
 * Inject once per guest document. Stores the latest non-empty selection snapshot
 * on mouseup / keyup for the host to poll via executeJavaScript.
 */
export const BROWSER_SELECTION_HOOK_JS = `(() => {
  if (window.__nearBrowserSelHook) return true;
  window.__nearBrowserSelHook = true;
  window.__nearBrowserSel = null;
  const capture = () => {
    try {
      const sel = window.getSelection();
      const text = String(sel && sel.toString ? sel.toString() : "").trim();
      if (!text || !sel || !sel.rangeCount) {
        window.__nearBrowserSel = null;
        return;
      }
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      const rect =
        rects.length > 0
          ? rects[rects.length - 1]
          : range.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        window.__nearBrowserSel = null;
        return;
      }
      window.__nearBrowserSel = {
        text,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        },
      };
    } catch (_) {
      window.__nearBrowserSel = null;
    }
  };
  document.addEventListener("mouseup", capture, true);
  document.addEventListener("keyup", capture, true);
  document.addEventListener("selectionchange", () => {
    try {
      const sel = window.getSelection();
      const text = String(sel && sel.toString ? sel.toString() : "").trim();
      if (!text) window.__nearBrowserSel = null;
    } catch (_) {
      window.__nearBrowserSel = null;
    }
  });
  return true;
})()`;

/** Read the last selection snapshot written by the hook. */
export const BROWSER_SELECTION_READ_JS = `(() => {
  try {
    const snap = window.__nearBrowserSel;
    if (!snap || !snap.text || !snap.rect) return null;
    const text = String(snap.text || "").trim();
    if (!text) return null;
    return {
      text,
      rect: {
        top: Number(snap.rect.top) || 0,
        left: Number(snap.rect.left) || 0,
        width: Number(snap.rect.width) || 0,
        height: Number(snap.rect.height) || 0,
      },
    };
  } catch (_) {
    return null;
  }
})()`;

export function parseBrowserGuestSelection(raw: unknown): BrowserGuestSelection | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const text = String(obj.text || "").trim();
  if (!text) return null;
  const rectRaw = obj.rect;
  if (!rectRaw || typeof rectRaw !== "object") return null;
  const r = rectRaw as Record<string, unknown>;
  const rect = {
    top: Number(r.top) || 0,
    left: Number(r.left) || 0,
    width: Number(r.width) || 0,
    height: Number(r.height) || 0,
  };
  return { text, rect };
}

/** Map guest selection rect into host viewport anchor for the floating toolbar. */
export function mapGuestRectToHostAnchor(
  guestRect: BrowserGuestSelection["rect"],
  webviewHostRect: Pick<DOMRect, "top" | "left">,
  opts?: { zoom?: number }
): SelectionPopupAnchor {
  const zoom = opts?.zoom && opts.zoom > 0 ? opts.zoom : 1;
  const centerX = webviewHostRect.left + (guestRect.left + guestRect.width / 2) * zoom;
  const bottomY = webviewHostRect.top + (guestRect.top + guestRect.height) * zoom;
  const width = Math.max(1, guestRect.width * zoom);
  const height = Math.max(1, guestRect.height * zoom);
  const topY = bottomY - height;
  // Avoid `new DOMRect` — unavailable in vitest node env; computePopupAnchorFromRect only reads geometry fields.
  const rect = {
    x: centerX - width / 2,
    y: topY,
    left: centerX - width / 2,
    top: topY,
    width,
    height,
    right: centerX + width / 2,
    bottom: bottomY,
    toJSON: () => ({}),
  } as DOMRect;
  return computePopupAnchorFromRect(rect);
}
