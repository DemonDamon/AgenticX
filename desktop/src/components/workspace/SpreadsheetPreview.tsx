import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PreviewFallback } from "./PreviewFallback";
import { dataUrlToArrayBuffer, loadLocalPreviewDataUrl } from "./preview-data";
import {
  computePopupAnchorFromRect,
  SelectionQuotePopover,
  type SelectionPopupAnchor,
} from "./selection-quote-popover";
import type { WorkspacePreviewQuotePayload } from "./workspace-preview-types";

type SpreadsheetPreviewProps = {
  path: string;
  absolutePath: string;
  mimeType: string;
  onCopyPath: () => void;
  onQuoteSelection?: (payload: WorkspacePreviewQuotePayload) => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

const MAX_SHEETS = 8;
const MAX_ROWS = 200;
const MAX_COLS = 50;

export function SpreadsheetPreview({
  path,
  absolutePath,
  mimeType,
  onCopyPath,
  onQuoteSelection,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: SpreadsheetPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [truncatedHint, setTruncatedHint] = useState("");
  const [anchorCell, setAnchorCell] = useState<{ row: number; col: number } | null>(null);
  const [selection, setSelection] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionPopupAnchor | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSheetNames([]);
    setActiveSheet("");
    setRows([]);
    setTruncatedHint("");
    setAnchorCell(null);
    setSelection(null);
    setSelectionAnchor(null);

    void (async () => {
      const loaded = await loadLocalPreviewDataUrl(absolutePath);
      if (cancelled) return;
      if (!loaded.ok) {
        setError(loaded.error);
        setLoading(false);
        return;
      }
      try {
        const XLSX = await import("xlsx");
        const buffer = await dataUrlToArrayBuffer(loaded.dataUrl);
        const workbook = XLSX.read(buffer, { type: "array" });
        const names = workbook.SheetNames.slice(0, MAX_SHEETS);
        if (cancelled) return;
        if (names.length === 0) {
          setError("工作簿中没有工作表");
          setLoading(false);
          return;
        }
        setSheetNames(names);
        setActiveSheet(names[0] ?? "");
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [absolutePath]);

  useEffect(() => {
    if (!activeSheet || loading) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadLocalPreviewDataUrl(absolutePath);
        if (cancelled || !loaded.ok || !loaded.dataUrl) return;
        const XLSX = await import("xlsx");
        const buffer = await dataUrlToArrayBuffer(loaded.dataUrl);
        const workbook = XLSX.read(buffer, { type: "array" });
        const sheet = workbook.Sheets[activeSheet];
        if (!sheet) return;
        const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
          header: 1,
          raw: false,
          defval: "",
        }) as string[][];
        const limitedRows = matrix.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLS));
        const hints: string[] = [];
        if (matrix.length > MAX_ROWS) hints.push(`前 ${MAX_ROWS} 行`);
        const maxColCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
        if (maxColCount > MAX_COLS) hints.push(`${MAX_COLS} 列`);
        if (cancelled) return;
        setRows(limitedRows);
        setTruncatedHint(hints.length ? `仅展示${hints.join(" / ")}` : "");
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [absolutePath, activeSheet, loading]);

  const colCount = useMemo(() => rows.reduce((max, row) => Math.max(max, row.length), 0), [rows]);

  const toColLetters = (colIndex1Based: number): string => {
    let n = Math.max(1, colIndex1Based);
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };

  const updateSelectionAnchor = useCallback(() => {
    if (!selection || !tableScrollRef.current) {
      setSelectionAnchor(null);
      return;
    }
    const bottom = Math.max(selection.r1, selection.r2);
    const right = Math.max(selection.c1, selection.c2);
    const cell = tableScrollRef.current.querySelector(
      `[data-row="${bottom}"][data-col="${right}"]`
    ) as HTMLElement | null;
    if (!cell) {
      setSelectionAnchor(null);
      return;
    }
    setSelectionAnchor(computePopupAnchorFromRect(cell.getBoundingClientRect()));
  }, [selection]);

  useEffect(() => {
    updateSelectionAnchor();
  }, [updateSelectionAnchor]);

  useEffect(() => {
    const scrollEl = tableScrollRef.current;
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", updateSelectionAnchor, { passive: true });
    return () => scrollEl.removeEventListener("scroll", updateSelectionAnchor);
  }, [updateSelectionAnchor]);

  const quoteSelection = () => {
    if (!selection || !activeSheet || !onQuoteSelection) return;
    const top = Math.min(selection.r1, selection.r2);
    const bottom = Math.max(selection.r1, selection.r2);
    const left = Math.min(selection.c1, selection.c2);
    const right = Math.max(selection.c1, selection.c2);
    const matrix = rows
      .slice(top - 1, bottom)
      .map((row) => row.slice(left - 1, right).map((cell) => String(cell ?? "")));
    const snippet = matrix.map((line) => line.join("\t")).join("\n").trimEnd();
    if (!snippet) return;
    const a1Start = `${toColLetters(left)}${top}`;
    const a1End = `${toColLetters(right)}${bottom}`;
    const a1 = a1Start === a1End ? a1Start : `${a1Start}:${a1End}`;
    const baseName = path.split(/[\\/]/).pop() || path || absolutePath;
    onQuoteSelection({
      kind: "spreadsheet-range",
      path,
      absolutePath,
      sheet: activeSheet,
      a1,
      snippet,
      label: `${baseName} · ${activeSheet} · ${a1}`,
    });
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center bg-surface-base p-6 text-sm text-text-muted">
        正在加载电子表格…
      </div>
    );
  }

  if (error) {
    return (
      <PreviewFallback
        title="Office 文档"
        message={error}
        mimeType={mimeType}
        onCopyPath={onCopyPath}
        onRevealInFileManager={onRevealInFileManager}
        revealInFileManagerLabel={revealInFileManagerLabel}
        absolutePath={absolutePath}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base">
      {sheetNames.length > 1 ? (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-border px-3 py-2">
          {sheetNames.map((name) => (
            <button
              key={name}
              type="button"
              className={`rounded px-2 py-1 text-xs ${
                name === activeSheet
                  ? "bg-surface-popover text-text-strong"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
              }`}
              onClick={() => setActiveSheet(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {truncatedHint ? (
        <div className="shrink-0 border-b border-border px-4 py-1.5 text-[11px] text-text-faint">{truncatedHint}</div>
      ) : null}
      {selection && selectionAnchor && onQuoteSelection ? (
        <SelectionQuotePopover anchor={selectionAnchor} onQuote={quoteSelection} />
      ) : null}
      <div ref={tableScrollRef} className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-left text-[12px] text-text-primary">
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={`row-${rowIdx}`} className="border-b border-[var(--border-subtle)]">
                {Array.from({ length: colCount }).map((_, colIdx) => (
                  (() => {
                    const row1 = rowIdx + 1;
                    const col1 = colIdx + 1;
                    const selected = selection
                      ? row1 >= Math.min(selection.r1, selection.r2) &&
                        row1 <= Math.max(selection.r1, selection.r2) &&
                        col1 >= Math.min(selection.c1, selection.c2) &&
                        col1 <= Math.max(selection.c1, selection.c2)
                      : false;
                    return (
                  <td
                    key={`cell-${rowIdx}-${colIdx}`}
                    data-row={row1}
                    data-col={col1}
                    className={`max-w-[240px] truncate border-r border-[var(--border-subtle)] px-2 py-1 align-top ${
                      selected ? "bg-primary/20 ring-1 ring-primary/40" : ""
                    }`}
                    title={String(row[colIdx] ?? "")}
                    onClick={(event) => {
                      const current = { row: row1, col: col1 };
                      if (event.shiftKey && anchorCell) {
                        setSelection({ r1: anchorCell.row, c1: anchorCell.col, r2: current.row, c2: current.col });
                        return;
                      }
                      setAnchorCell(current);
                      setSelection({ r1: current.row, c1: current.col, r2: current.row, c2: current.col });
                    }}
                  >
                    {String(row[colIdx] ?? "")}
                  </td>
                    );
                  })()
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
