import { describe, expect, it } from "vitest";
import { pdfNavDeltaFromKey } from "./pdf-preview-keys";

describe("pdfNavDeltaFromKey", () => {
  it("maps all four arrow keys to page steps", () => {
    expect(pdfNavDeltaFromKey("ArrowLeft")).toBe(-1);
    expect(pdfNavDeltaFromKey("ArrowUp")).toBe(-1);
    expect(pdfNavDeltaFromKey("ArrowRight")).toBe(1);
    expect(pdfNavDeltaFromKey("ArrowDown")).toBe(1);
    expect(pdfNavDeltaFromKey("PageDown")).toBe(0);
    expect(pdfNavDeltaFromKey("a")).toBe(0);
  });
});
