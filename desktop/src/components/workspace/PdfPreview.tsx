import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { PreviewFallback } from "./PreviewFallback";
import { dataUrlToArrayBuffer, loadLocalPreviewDataUrl } from "./preview-data";

type PdfPreviewProps = {
  absolutePath: string;
  mimeType: string;
  onCopyPath: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

const MAX_RENDER_PAGES = 10;

export function PdfPreview({
  absolutePath,
  mimeType,
  onCopyPath,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.1);
  const pdfDocRef = useRef<{ getPage: (n: number) => Promise<unknown>; numPages: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPageNum(1);
    setPageCount(0);
    pdfDocRef.current = null;

    void (async () => {
      const loaded = await loadLocalPreviewDataUrl(absolutePath);
      if (cancelled) return;
      if (!loaded.ok) {
        setError(loaded.error);
        setLoading(false);
        return;
      }
      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const workerMod = await import("pdfjs-dist/legacy/build/pdf.worker.mjs?url");
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerMod.default;
        const buffer = await dataUrlToArrayBuffer(loaded.dataUrl);
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPageCount(Math.min(pdf.numPages, MAX_RENDER_PAGES));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      pdfDocRef.current = null;
    };
  }, [absolutePath]);

  useEffect(() => {
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas || pageNum < 1) return;

    let cancelled = false;
    void (async () => {
      try {
        const page = (await pdf.getPage(pageNum)) as {
          getViewport: (opts: { scale: number }) => { width: number; height: number };
          render: (opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
            promise: Promise<void>;
          };
        };
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageNum, scale, loading]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center bg-surface-base p-6 text-sm text-text-muted">
        正在加载 PDF…
      </div>
    );
  }

  if (error || !pdfDocRef.current) {
    return (
      <PreviewFallback
        title="PDF"
        message={error ?? "PDF 预览失败；当前可在系统应用中打开。"}
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
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="text-xs text-text-muted">
          第 {pageNum} / {pageCount} 页
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
            disabled={pageNum <= 1}
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            title="上一页"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
            disabled={pageNum >= pageCount}
            onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))}
            title="下一页"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong"
            onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
            title="缩小"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong"
            onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
            title="放大"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4">
        <canvas ref={canvasRef} className="rounded border border-[var(--border-subtle)] bg-white shadow-sm" />
      </div>
    </div>
  );
}
