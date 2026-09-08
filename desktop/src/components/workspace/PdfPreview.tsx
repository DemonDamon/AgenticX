import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { PreviewFallback } from "./PreviewFallback";
import { dataUrlToArrayBuffer, loadLocalPreviewDataUrl } from "./preview-data";
import { pdfNavDeltaFromKey } from "./pdf-preview-keys";

type PdfPreviewProps = {
  absolutePath: string;
  mimeType: string;
  onCopyPath: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

type PdfJsPage = {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void>; cancel?: () => void };
};

type PdfJsDoc = {
  getPage: (n: number) => Promise<PdfJsPage>;
  numPages: number;
};

const MAX_RENDER_PAGES = 10;

export function PdfPreview({
  absolutePath,
  mimeType,
  onCopyPath,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: PdfPreviewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageWrapRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const pdfDocRef = useRef<PdfJsDoc | null>(null);
  const pageNumRef = useRef(1);
  const pageCountRef = useRef(0);
  const { t } = useTranslation("workspace");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.1);

  pageNumRef.current = pageNum;
  pageCountRef.current = pageCount;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPageNum(1);
    setPageCount(0);
    pdfDocRef.current = null;
    pageWrapRefs.current = [];
    canvasRefs.current = [];

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
        const pdf = (await pdfjsLib.getDocument({ data: buffer }).promise) as PdfJsDoc;
        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPageCount(Math.min(pdf.numPages, MAX_RENDER_PAGES));
        setLoading(false);
        rootRef.current?.focus({ preventScroll: true });
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
    if (!pdf || loading || pageCount < 1) return;

    let cancelled = false;
    const tasks: Array<{ cancel?: () => void }> = [];

    void (async () => {
      try {
        for (let n = 1; n <= pageCount; n += 1) {
          if (cancelled) return;
          const canvas = canvasRefs.current[n - 1];
          if (!canvas) continue;
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          const task = page.render({ canvasContext: ctx, viewport });
          tasks.push(task);
          await task.promise;
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
      for (const task of tasks) {
        task.cancel?.();
      }
    };
  }, [pageCount, scale, loading]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || loading || pageCount < 1) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target as HTMLElement | undefined;
        const next = Number(top?.dataset.page);
        if (Number.isInteger(next) && next >= 1) {
          setPageNum(next);
        }
      },
      { root, threshold: [0.35, 0.55, 0.75] },
    );

    for (const el of pageWrapRefs.current) {
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [loading, pageCount]);

  const changePage = (next: number) => {
    const max = pageCountRef.current;
    if (max < 1) return;
    const clamped = Math.min(max, Math.max(1, next));
    setPageNum(clamped);
    pageWrapRefs.current[clamped - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
    const delta = pdfNavDeltaFromKey(event.key);
    if (!delta || loading || pageCountRef.current < 1) return;
    event.preventDefault();
    changePage(pageNumRef.current + delta);
  };

  if (error || (!loading && !pdfDocRef.current)) {
    return (
      <PreviewFallback
        title="PDF"
        message={error ?? t("preview.pdfFallback")}
        mimeType={mimeType}
        onCopyPath={onCopyPath}
        onRevealInFileManager={onRevealInFileManager}
        revealInFileManagerLabel={revealInFileManagerLabel}
        absolutePath={absolutePath}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="flex h-full min-h-0 flex-col bg-surface-base outline-none"
      onKeyDown={onPreviewKeyDown}
      onMouseDown={() => rootRef.current?.focus({ preventScroll: true })}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="text-xs text-text-muted">
          {loading ? t("preview.pdfLoading") : t("preview.pageOf", { page: pageNum, total: pageCount })}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
            disabled={loading || pageNum <= 1}
            onClick={() => {
              changePage(pageNum - 1);
              rootRef.current?.focus({ preventScroll: true });
            }}
            title={t("preview.prevPage")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
            disabled={loading || pageNum >= pageCount}
            onClick={() => {
              changePage(pageNum + 1);
              rootRef.current?.focus({ preventScroll: true });
            }}
            title={t("preview.nextPage")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
            disabled={loading}
            onClick={() => setScale((s) => Math.max(0.5, s - 0.15))}
            title={t("preview.zoomOut")}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
            disabled={loading}
            onClick={() => setScale((s) => Math.min(2.5, s + 0.15))}
            title={t("preview.zoomIn")}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-base text-sm text-text-muted">
            {t("preview.pdfLoading")}
          </div>
        ) : null}
        <div className="agx-pdf-preview p-4">
          {Array.from({ length: pageCount }, (_, index) => (
            <div
              key={index + 1}
              ref={(el) => {
                pageWrapRefs.current[index] = el;
              }}
              data-page={index + 1}
              className="flex justify-center"
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[index] = el;
                }}
                className="rounded border border-[var(--border-subtle)] bg-white shadow-sm"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
