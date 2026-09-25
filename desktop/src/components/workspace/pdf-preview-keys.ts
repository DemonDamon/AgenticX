export const MAX_PDF_RENDER_PAGES = 10;

export function pdfNavDeltaFromKey(key: string): -1 | 1 | 0 {
  if (key === "ArrowLeft" || key === "ArrowUp") return -1;
  if (key === "ArrowRight" || key === "ArrowDown") return 1;
  return 0;
}

/** Page numbers rendered in the stacked preview, bounded for large documents. */
export function pdfPageNumbers(pageCount: number, maxPages = MAX_PDF_RENDER_PAGES): number[] {
  const count = Math.max(0, Math.min(Math.floor(pageCount), Math.floor(maxPages)));
  return Array.from({ length: count }, (_, index) => index + 1);
}

export type PdfRenderTask = { cancel?: () => void };

/** Cancel all in-flight page renders when zoom, file, or the component changes. */
export function cancelPdfRenderTasks(tasks: readonly PdfRenderTask[]): void {
  for (const task of tasks) task.cancel?.();
}
