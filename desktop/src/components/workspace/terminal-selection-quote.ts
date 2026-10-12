import {
  computePopupAnchorFromRect,
  type SelectionPopupAnchor,
} from "./selection-quote-popover";

export type TerminalOverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Normalize xterm `getSelection()` text for a chat quote chip. */
export function normalizeTerminalQuoteText(raw: string): string | null {
  const text = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  return text ? text : null;
}

export function lastNonEmptyOverlayRect(
  rects: TerminalOverlayRect[]
): TerminalOverlayRect | null {
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const rect = rects[i];
    if (rect && (rect.width > 0 || rect.height > 0)) return rect;
  }
  return null;
}

/** Viewport anchor for the floating「引用」pill — last overlay line, same as file preview. */
export function computeTerminalSelectionAnchor(
  rects: TerminalOverlayRect[]
): SelectionPopupAnchor | null {
  const last = lastNonEmptyOverlayRect(rects);
  if (!last) return null;
  const rect = {
    x: last.left,
    y: last.top,
    left: last.left,
    top: last.top,
    width: last.width,
    height: last.height,
    right: last.left + last.width,
    bottom: last.top + last.height,
    toJSON: () => ({}),
  } as DOMRect;
  return computePopupAnchorFromRect(rect);
}

export function readXtermSelectionOverlayRects(root: ParentNode): TerminalOverlayRect[] {
  return Array.from(root.querySelectorAll(".xterm-selection div")).map((node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  });
}
