import { createPortal } from "react-dom";

const POPUP_GAP = 6;
const POPUP_HEIGHT = 32;
const POPUP_MIN_WIDTH = 160;
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
      className="agx-selection-quote-btn fixed z-[100] flex h-8 min-w-[160px] -translate-x-1/2 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--border-subtle)] px-3 text-xs leading-none shadow-[0_4px_20px_rgba(0,0,0,0.45)] transition-[background-color,border-color,color,box-shadow]"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onQuote}
    >
      <span className="text-text-muted">引用至当前对话</span>
    </button>,
    document.body
  );
}
