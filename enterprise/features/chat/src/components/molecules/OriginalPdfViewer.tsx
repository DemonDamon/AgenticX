"use client";

import * as React from "react";

export type OriginalPdfViewerProps = {
  url: string;
  scale: number;
  className?: string;
  onError?: (message: string) => void;
};

/**
 * Client-only PDF page renderer (pdfjs-dist). Must not be SSR'd.
 */
export function OriginalPdfViewer({ url, scale, className, onError }: OriginalPdfViewerProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [pageCount, setPageCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const onErrorRef = React.useRef(onError);
  onErrorRef.current = onError;

  React.useEffect(() => {
    let cancelled = false;
    let destroyDoc: (() => Promise<void>) | null = null;

    async function run() {
      setLoading(true);
      setPageCount(0);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const loadingTask = pdfjs.getDocument({ url, withCredentials: true });
        const doc = await loadingTask.promise;
        destroyDoc = () => doc.destroy();
        if (cancelled) {
          await doc.destroy();
          return;
        }
        setPageCount(doc.numPages);
        const root = containerRef.current;
        if (!root) return;
        root.replaceChildren();

        for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
          if (cancelled) break;
          const page = await doc.getPage(pageNum);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.className = "mb-3 max-w-full rounded border border-border bg-card shadow-sm";
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          root.appendChild(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (error) {
        if (!cancelled) {
          onErrorRef.current?.(error instanceof Error ? error.message : "PDF 预览失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (destroyDoc) void destroyDoc();
    };
  }, [url, scale]);

  return (
    <div className={className}>
      {loading ? <p className="text-sm text-muted-foreground">正在加载原件…</p> : null}
      {!loading && pageCount > 0 ? (
        <p className="mb-2 text-xs text-muted-foreground">共 {pageCount} 页</p>
      ) : null}
      <div ref={containerRef} />
    </div>
  );
}
