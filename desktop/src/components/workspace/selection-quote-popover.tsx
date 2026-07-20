import { createPortal } from "react-dom";

const POPUP_GAP = 6;
/** Single-line「引用」pill — keep in sync with SelectionQuotePopover h-7. */
const POPUP_HEIGHT = 28;
/** HTML select-element Trae capsule (评论到对话 | 添加到对话) — py-2 + 11px leading-none. */
export const HTML_ELEMENT_TOOLBAR_HEIGHT = 36;
/** Approximate pill width for viewport clamping (content-sized button, no min-width). */
const POPUP_MIN_WIDTH = 118;
/** Wider clamp for dual-action HTML element toolbar. */
const HTML_ELEMENT_TOOLBAR_MIN_WIDTH = 260;
const VIEWPORT_MARGIN = 8;

export type SelectionPopupAnchor = {
  top: number;
  left: number;
};

/** Viewport anchor for a floating quote button — uses last client rect (selection end line). */
export function computeSelectionPopupAnchor(range: Range): SelectionPopupAnchor | null {
  const rects = range.getClientRects();
  const rect =
    rects.length > 0
      ? rects[rects.length - 1]!
      : (() => {
          const fallback = range.getBoundingClientRect();
          if (fallback.width === 0 && fallback.height === 0) return null;
          return fallback;
        })();
  if (!rect) return null;
  return clampPopupAnchor(rect.left + rect.width / 2, rect.bottom + POPUP_GAP, rect.top);
}

export function computePopupAnchorFromRect(
  rect: DOMRect,
  opts?: { height?: number; minWidth?: number }
): SelectionPopupAnchor {
  return clampPopupAnchor(
    rect.left + rect.width / 2,
    rect.bottom + POPUP_GAP,
    rect.top,
    opts?.height ?? POPUP_HEIGHT,
    opts?.minWidth ?? POPUP_MIN_WIDTH
  );
}

/** Anchor for HtmlElementSelectPopover (taller/wider than the quote pill). */
export function computeHtmlElementToolbarAnchor(rect: DOMRect): SelectionPopupAnchor {
  return computePopupAnchorFromRect(rect, {
    height: HTML_ELEMENT_TOOLBAR_HEIGHT,
    minWidth: HTML_ELEMENT_TOOLBAR_MIN_WIDTH,
  });
}

function clampPopupAnchor(
  centerX: number,
  belowY: number,
  selectionTop: number,
  popupHeight: number = POPUP_HEIGHT,
  minWidth: number = POPUP_MIN_WIDTH
): SelectionPopupAnchor {
  const halfW = minWidth / 2;
  let top = belowY;
  if (top + popupHeight > window.innerHeight - VIEWPORT_MARGIN) {
    top = selectionTop - POPUP_GAP - popupHeight;
  }
  top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(window.innerHeight - popupHeight - VIEWPORT_MARGIN, top)
  );
  const left = Math.max(
    halfW + VIEWPORT_MARGIN,
    Math.min(window.innerWidth - halfW - VIEWPORT_MARGIN, centerX)
  );
  return { top, left };
}

type SelectionQuotePopoverProps = {
  anchor: SelectionPopupAnchor;
  onQuote: () => void;
};

export function SelectionQuotePopover({ anchor, onQuote }: SelectionQuotePopoverProps) {
  return createPortal(
    <button
      type="button"
      className="agx-selection-quote-btn fixed z-[100] flex h-7 w-max max-w-[calc(100vw-16px)] -translate-x-1/2 items-center justify-center whitespace-nowrap rounded-full border px-2.5 text-[11px] font-normal leading-none transition-[background-color,border-color,color,box-shadow]"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onQuote}
    >
      引用至当前对话
    </button>,
    document.body
  );
}
