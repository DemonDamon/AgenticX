import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { PreviewFallback } from "./PreviewFallback";
import { dataUrlToArrayBuffer, loadLocalPreviewDataUrl } from "./preview-data";
import { pptxNavDeltaFromKey } from "./pptx-preview-keys";

type PptxPreviewProps = {
  absolutePath: string;
  mimeType: string;
  onCopyPath: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
};

export function PptxPreview({
  absolutePath,
  mimeType,
  onCopyPath,
  onRevealInFileManager,
  revealInFileManagerLabel,
}: PptxPreviewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const { t } = useTranslation("workspace");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(100);
  const pageNumRef = useRef(1);
  const pageCountRef = useRef(0);
  const goToSlideRef = useRef<((index: number) => Promise<void>) | null>(null);
  const setZoomRef = useRef<((percent: number) => Promise<void>) | null>(null);

  pageNumRef.current = pageNum;
  pageCountRef.current = pageCount;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBuffer(null);
    setPageNum(1);
    setPageCount(0);
    setZoom(100);
    goToSlideRef.current = null;
    setZoomRef.current = null;

    void (async () => {
      const loaded = await loadLocalPreviewDataUrl(absolutePath);
      if (cancelled) return;
      if (!loaded.ok) {
        setError(loaded.error);
        setLoading(false);
        return;
      }
      try {
        const next = await dataUrlToArrayBuffer(loaded.dataUrl);
        if (cancelled) return;
        setBuffer(next);
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
    const host = hostRef.current;
    const scroll = scrollRef.current;
    if (!buffer || !host || !scroll) return;

    let cancelled = false;
    const controller = new AbortController();
    let viewer: { destroy: () => void } | null = null;

    void (async () => {
      try {
        const { PptxViewer } = await import("@aiden0z/pptx-renderer");
        const opened = await PptxViewer.open(buffer, host, {
          fitMode: "contain",
          renderMode: "list",
          scrollContainer: scroll,
          lazyMedia: true,
          lazySlides: true,
          zoomPercent: 100,
          signal: controller.signal,
          listOptions: {
            windowed: true,
            initialSlides: 3,
            overscanViewport: 1,
          },
          onSlideChange: (index) => {
            if (!cancelled) setPageNum(index + 1);
          },
        });
        if (cancelled) {
          opened.destroy();
          return;
        }
        viewer = opened;
        goToSlideRef.current = (index) =>
          opened.goToSlide(index, { behavior: "smooth", block: "start" });
        setZoomRef.current = (percent) => opened.setZoom(percent);
        setPageCount(Math.max(1, opened.slideCount));
        setPageNum(opened.currentSlideIndex + 1);
        setLoading(false);
        rootRef.current?.focus({ preventScroll: true });
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(String(err));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      goToSlideRef.current = null;
      setZoomRef.current = null;
      viewer?.destroy();
      host.replaceChildren();
    };
  }, [buffer]);

  const changePage = (next: number) => {
    const max = pageCountRef.current;
    const clamped = Math.min(max, Math.max(1, next));
    setPageNum(clamped);
    void goToSlideRef.current?.(clamped - 1);
  };

  const changeZoom = (next: number) => {
    const clamped = Math.min(250, Math.max(50, next));
    setZoom(clamped);
    void setZoomRef.current?.(clamped);
  };

  const onPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
    const delta = pptxNavDeltaFromKey(event.key);
    if (!delta || loading || pageCountRef.current < 1) return;
    event.preventDefault();
    changePage(pageNumRef.current + delta);
  };

  if (error) {
    return (
      <PreviewFallback
        title={t("preview.pptxTitle")}
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
    <div
      ref={rootRef}
      tabIndex={0}
      className="flex h-full min-h-0 flex-col bg-surface-base outline-none"
      onKeyDown={onPreviewKeyDown}
      onMouseDown={() => rootRef.current?.focus({ preventScroll: true })}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="text-xs text-text-muted">
          {loading ? t("preview.pptxLoading") : t("preview.pageOf", { page: pageNum, total: pageCount })}
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
            onClick={() => changeZoom(zoom - 15)}
            title={t("preview.zoomOut")}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
            disabled={loading}
            onClick={() => changeZoom(zoom + 15)}
            title={t("preview.zoomIn")}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-base text-sm text-text-muted">
            {t("preview.pptxLoading")}
          </div>
        ) : null}
        <div className="flex min-h-full items-start justify-center p-4">
          <div ref={hostRef} className="agx-pptx-preview w-full max-w-5xl" />
        </div>
      </div>
    </div>
  );
}
