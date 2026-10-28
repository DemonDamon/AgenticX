import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageWatermark, resolvePageWatermarkText } from "../PageWatermark";

describe("PageWatermark", () => {
  it("resolves env or fallback", () => {
    expect(resolvePageWatermarkText("alice@example.com")).toBe("alice@example.com");
    expect(resolvePageWatermarkText("")).toBe("demo@agenticx.local");
    expect(resolvePageWatermarkText(undefined)).toBe("demo@agenticx.local");
  });

  it("renders testid and text", () => {
    const html = renderToStaticMarkup(
      createElement(PageWatermark, { text: "demo@agenticx.local" }),
    );
    expect(html).toContain('data-testid="page-watermark"');
    expect(html).toContain("demo@agenticx.local");
  });

  it("returns null for blank text", () => {
    const html = renderToStaticMarkup(createElement(PageWatermark, { text: "  " }));
    expect(html).toBe("");
  });
});
