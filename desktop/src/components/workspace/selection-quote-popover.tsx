import { createPortal } from "react-dom";

const POPUP_GAP = 6;
const POPUP_HEIGHT = 28;
/** Approximate pill width for viewport clamping (content-sized button, no min-width). */
const POPUP_MIN_WIDTH = 118;
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

export function computePopupAnchorFromRect(rect: DOMRect): SelectionPopupAnchor {
  return clampPopupAnchor(rect.left + rect.width / 2, rect.bottom + POPUP_GAP, rect.top);
}

function clampPopupAnchor(centerX: number, belowY: number, selectionTop: number): SelectionPopupAnchor {
  const halfW = POPUP_MIN_WIDTH / 2;
  let top = belowY;
  if (top + POPUP_HEIGHT > window.innerHeight - VIEWPORT_MARGIN) {
    top = selectionTop - POPUP_GAP - POPUP_HEIGHT;
  }
  top = Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - POPUP_HEIGHT - VIEWPORT_MARGIN, top));
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
