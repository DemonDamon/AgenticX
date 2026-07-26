import { createPortal } from "react-dom";
import { Copy, Quote, Search } from "lucide-react";
import type { SelectionPopupAnchor } from "../workspace/selection-quote-popover";

type Props = {
  anchor: SelectionPopupAnchor;
  onQuote: () => void;
  onCopy: () => void;
  onSearch: () => void;
};

/**
 * Host-side floating actions for remote webview text selection.
 * mousedown preventDefault keeps guest selection alive until click handlers run.
 */
export function BrowserSelectionToolbar({ anchor, onQuote, onCopy, onSearch }: Props) {
  return createPortal(
    <div
      className="fixed z-[100] flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-surface-popover px-1 py-0.5 shadow-lg"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] leading-none text-text-strong transition hover:bg-surface-hover"
        onClick={onSearch}
      >
        <Search size={12} className="shrink-0 text-text-faint" strokeWidth={1.8} />
        搜索
      </button>
      <button
        type="button"
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] leading-none text-text-strong transition hover:bg-surface-hover"
        onClick={onCopy}
      >
        <Copy size={12} className="shrink-0 text-text-faint" strokeWidth={1.8} />
        复制
      </button>
      <button
        type="button"
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium leading-none text-text-strong transition hover:bg-surface-hover"
        onClick={onQuote}
      >
        <Quote size={12} className="shrink-0 text-text-faint" strokeWidth={1.8} />
        引用至当前对话
      </button>
    </div>,
    document.body
  );
}
