import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  markdownToHtml,
  renderHtmlReport,
  safeHref,
} from "./report-html";

describe("escapeHtml / safeHref", () => {
  it("escapes script tags", () => {
    const out = escapeHtml("<script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });

  it("rejects javascript: hrefs", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
  });

  it("keeps https urls", () => {
    expect(safeHref("https://a.com")).toBe("https://a.com");
  });
});

describe("renderHtmlReport", () => {
  const base = {
    title: "测试报告",
    topic: "主题 A",
    markdown: "## 核心结论\n\n正文 [1](#ref-1)\n\n## 分项分析\n\n更多",
    citations: [
      { index: 1, title: "来源一", url: "https://example.com/a", snippet: "s" },
      { index: 2, title: "来源二", url: "https://example.com/b", snippet: "s" },
    ],
    mindmapMermaid: "mindmap\n  root((主题))\n    核心结论",
    generatedAt: "2026-08-02T00:00:00.000Z",
  };

  it("emits doctype, title, toc, and sources", () => {
    const html = renderHtmlReport(base);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>测试报告</title>");
    expect(html).toContain('id="toc"');
    expect(html).toContain('id="sources"');
    expect(html).toContain('id="ref-1"');
    expect(html).toContain('id="ref-2"');
  });

  it("matches ## heading count in toc and body ids", () => {
    const html = renderHtmlReport(base);
    const headingCount = (base.markdown.match(/^## /gm) ?? []).length;
    expect(headingCount).toBe(2);
    const { toc } = markdownToHtml(base.markdown);
    expect(toc.filter((t) => t.level === 2)).toHaveLength(2);
    for (const entry of toc) {
      expect(html).toContain(`id="${entry.id}"`);
      expect(html).toContain(`href="#${entry.id}"`);
    }
  });

  it("omits mindmap section when mermaid empty", () => {
    const html = renderHtmlReport({ ...base, mindmapMermaid: "" });
    expect(html).not.toContain('id="mindmap"');
    expect(html).not.toContain("mermaid.min.js");
  });
});
