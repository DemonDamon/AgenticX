import { describe, expect, it } from "vitest";
import {
  cancelPdfRenderTasks,
  MAX_PDF_RENDER_PAGES,
  pdfNavDeltaFromKey,
  pdfPageNumbers,
} from "./pdf-preview-keys";

describe("pdfNavDeltaFromKey", () => {
  it("maps all four arrow keys to page steps", () => {
    expect(pdfNavDeltaFromKey("ArrowLeft")).toBe(-1);
    expect(pdfNavDeltaFromKey("ArrowUp")).toBe(-1);
    expect(pdfNavDeltaFromKey("ArrowRight")).toBe(1);
    expect(pdfNavDeltaFromKey("ArrowDown")).toBe(1);
    expect(pdfNavDeltaFromKey("PageDown")).toBe(0);
    expect(pdfNavDeltaFromKey("a")).toBe(0);
  });

  it("builds a bounded stacked page list", () => {
    expect(pdfPageNumbers(3)).toEqual([1, 2, 3]);
    expect(pdfPageNumbers(100)).toEqual(
      Array.from({ length: MAX_PDF_RENDER_PAGES }, (_, index) => index + 1),
    );
    expect(pdfPageNumbers(0)).toEqual([]);
  });

  it("cancels every active page render during teardown", () => {
    const cancelled: number[] = [];
    cancelPdfRenderTasks([
      { cancel: () => cancelled.push(1) },
      {},
      { cancel: () => cancelled.push(3) },
    ]);
    expect(cancelled).toEqual([1, 3]);
  });
});
