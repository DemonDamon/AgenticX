import type { ReactNode } from "react";
import { useContext, useRef, useState } from "react";
import { Copy, Check, Download } from "lucide-react";
import { HoverTip } from "../ds/HoverTip";
import { MarkdownContext } from "./markdown-components";
import {
  extractTableRows,
  rowsToCsv,
  rowsToMarkdown,
  triggerBlobDownload,
} from "../../utils/markdown-table-export";

type Props = {
  children: ReactNode;
  className?: string;
};

export function TableBlock({ children, className, ...rest }: Props & Record<string, unknown>) {
  const { isStreaming } = useContext(MarkdownContext);
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);

  const readRows = () => {
    if (!tableRef.current) return [] as string[][];
    return extractTableRows(tableRef.current);
  };

  const handleCopy = async () => {
    const rows = readRows();
    if (rows.length === 0) return;
    try {
      await navigator.clipboard.writeText(rowsToMarkdown(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable in some Electron contexts.
    }
  };

  const handleDownload = () => {
    const rows = readRows();
    if (rows.length === 0) return;
    const csv = rowsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    triggerBlobDownload(blob, `table-${Date.now()}.csv`);
  };

  return (
    <div className="flex w-full justify-center">
      <div className="agx-table-block group/table my-2 w-fit max-w-full overflow-hidden rounded-xl border border-border bg-surface-panel">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-border bg-surface-hover/50 px-3 text-xs text-text-faint">
        <span className="text-[11px] font-medium tracking-wide text-text-muted">表格</span>
        {!isStreaming && (
          <div className="flex items-center gap-1 text-text-faint">
            <HoverTip label="复制 Markdown">
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="flex items-center justify-center rounded p-1 hover:bg-surface-hover hover:text-text-strong"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            </HoverTip>
            <HoverTip label="下载 CSV">
              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center justify-center rounded p-1 hover:bg-surface-hover hover:text-text-strong"
              >
                <Download size={12} />
              </button>
            </HoverTip>
          </div>
        )}
      </div>
      <div className="max-w-full overflow-x-auto">
        <table ref={tableRef} className={className} {...rest}>
          {children}
        </table>
      </div>
      </div>
    </div>
  );
}
