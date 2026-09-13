import { describe, expect, it } from "vitest";
import { localizeReportChrome } from "./localize-report-chrome";

describe("localizeReportChrome", () => {
  it("leaves Chinese chrome unchanged when locale is zh", () => {
    const md = "# Title\n\n## 目录\n\n1. Core Conclusions\n";
    expect(localizeReportChrome(md, "zh")).toBe(md);
  });

  it("rewrites canned TOC heading for English preview", () => {
    const md = "# Title\n\n## 目录\n\n1. Core Conclusions\n";
    expect(localizeReportChrome(md, "en")).toContain("## Contents");
    expect(localizeReportChrome(md, "en")).not.toContain("## 目录");
  });

  it("rewrites HTML sidebar TOC chrome for English preview", () => {
    const html = '<aside><h2>目录</h2><ul><li class="muted">无目录</li></ul></aside>';
    const out = localizeReportChrome(html, "en");
    expect(out).toContain("<h2>Contents</h2>");
    expect(out).toContain("No contents");
    expect(out).not.toContain("目录");
  });
});
