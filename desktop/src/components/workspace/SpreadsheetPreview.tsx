import { useEffect, useMemo, useState } from "react";
import { PreviewFallback } from "./PreviewFallback";
import { dataUrlToArrayBuffer, loadLocalPreviewDataUrl } from "./preview-data";

type SpreadsheetPreviewProps = {
  absolutePath: string;
  mimeType: string;
  onCopyPath: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

const MAX_SHEETS = 8;
const MAX_ROWS = 200;
const MAX_COLS = 50;

export function SpreadsheetPreview({
  absolutePath,
  mimeType,
  onCopyPath,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: SpreadsheetPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [truncatedHint, setTruncatedHint] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSheetNames([]);
    setActiveSheet("");
    setRows([]);
    setTruncatedHint("");

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
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-left text-[12px] text-text-primary">
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={`row-${rowIdx}`} className="border-b border-[var(--border-subtle)]">
                {Array.from({ length: colCount }).map((_, colIdx) => (
                  <td
                    key={`cell-${rowIdx}-${colIdx}`}
                    className="max-w-[240px] truncate border-r border-[var(--border-subtle)] px-2 py-1 align-top"
                    title={String(row[colIdx] ?? "")}
                  >
                    {String(row[colIdx] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
