import { describe, expect, it } from "vitest";
import { isHtmlPreviewPath } from "./HtmlPreviewBody";

describe("isHtmlPreviewPath", () => {
  it("matches .html and .htm case-insensitively", () => {
    expect(isHtmlPreviewPath("report.html")).toBe(true);
    expect(isHtmlPreviewPath("Report.HTML")).toBe(true);
    expect(isHtmlPreviewPath("/tmp/a.htm")).toBe(true);
  });

  it("rejects non-html paths", () => {
    expect(isHtmlPreviewPath("main.py")).toBe(false);
    expect(isHtmlPreviewPath("readme.md")).toBe(false);
    expect(isHtmlPreviewPath("page.html.bak")).toBe(false);
  });
});
