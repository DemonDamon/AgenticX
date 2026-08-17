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

  it("keeps in-document fragment hrefs for citations and toc", () => {
    expect(safeHref("#ref-1")).toBe("#ref-1");
    expect(safeHref("#核心结论")).toBe("#核心结论");
  });

  it("keeps bare hash but rejects fragments with whitespace", () => {
    expect(safeHref("#")).toBe("#");
    expect(safeHref("#ref 1")).toBe("#");
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
    expect(html).toContain('href="#ref-1"');
    expect(html).not.toMatch(/<a href="#">1<\/a>/);
  });

  it("renders uploaded-document citations as plain sources, not external links", () => {
    const html = renderHtmlReport({
      ...base,
      citations: [
        {
          index: 1,
          title: "Uploaded paper",
          url: "attachment:paper.pdf%3Aabc",
          snippet: "evidence",
          sourceType: "attachment" as const,
          sourceLabel: "paper.pdf",
        },
      ],
    });

    expect(html).toContain("Uploaded paper");
    expect(html).toContain("paper.pdf · 用户上传文件");
    expect(html).not.toContain('href="attachment:');
  });

  it("hides the full-text stat when its value is zero", () => {
    const html = renderHtmlReport({
      ...base,
      stats: {
        queriesPlanned: 3,
        urlsDiscovered: 12,
        sourcesSelected: 6,
        pagesFetched: 0,
      },
    });

    expect(html).toContain("规划查询");
    expect(html).toContain("选用来源");
    expect(html).not.toContain("抓取正文");
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

  it("renders body mermaid fences as .mermaid, not language-mermaid code", () => {
    const markdown = "## 架构\n\n```mermaid\nflowchart LR\n  A-->B\n```\n";
    const { html } = markdownToHtml(markdown);
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("mermaid-wrap");
    expect(html).not.toContain('class="language-mermaid"');
  });

  it("loads mermaid CDN when body has mermaid but mindmap is empty", () => {
    const html = renderHtmlReport({
      ...base,
      mindmapMermaid: "",
      markdown: "## 架构\n\n```mermaid\nflowchart LR\n  A-->B\n```\n",
    });
    expect(html).toContain("mermaid.min.js");
    expect(html).not.toContain('id="mindmap"');
  });

  it("keeps ordinary fences as language code blocks", () => {
    const { html } = markdownToHtml("```ts\nconst x = 1;\n```");
    expect(html).toContain('class="language-ts"');
    expect(html).not.toContain('class="mermaid"');
  });

  it("consumes lone pipe rows that are not a valid table", () => {
    const markdown = [
      "## 架构分析",
      "",
      "本节正文 | 维度 | A |",
      "| --- | --- |",
      "| x | 1 [1] |",
      "",
    ].join("\n");
    const { html } = markdownToHtml(markdown);
    expect(html).toContain("架构分析");
    expect(html).toContain("| --- | --- |");
  });

  it("renders a bar chart fence through the xychart path", () => {
    const spec = JSON.stringify({
      type: "bar",
      title: "市场份额",
      x: ["A", "B", "C"],
      series: [{ name: "2026", data: [30, 45, 25] }],
    });
    const { html } = markdownToHtml(`## 份额\n\n\`\`\`chart\n${spec}\n\`\`\`\n`);
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("xychart-beta");
    expect(html).toContain("bar [30, 45, 25]");
    expect(html).not.toContain('class="language-chart"');
  });

  it("renders a pie chart fence as an inline SVG figure", () => {
    const spec = JSON.stringify({
      type: "pie",
      title: "占比",
      x: ["甲", "乙"],
      series: [{ name: "s", data: [60, 40] }],
    });
    const { html } = markdownToHtml(`\`\`\`chart\n${spec}\n\`\`\`\n`);
    expect(html).toContain("chart-wrap");
    expect(html).toContain("<svg");
    expect(html).toContain("60.0%");
  });

  it("falls back to a data table when a valid chart cannot be drawn", () => {
    const spec = JSON.stringify({
      type: "pie",
      x: ["甲", "乙"],
      series: [{ name: "s", data: [0, 0] }],
    });
    const { html } = markdownToHtml(`\`\`\`chart\n${spec}\n\`\`\`\n`);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>甲</th>");
    expect(html).not.toContain('class="language-chart"');
  });

  it("keeps an invalid chart fence as escaped code", () => {
    const { html } = markdownToHtml("```chart\n{invalid json\n```");
    expect(html).toContain('class="language-chart"');
    expect(html).not.toContain('class="mermaid"');
  });

  it("loads the diagram renderer only when a chart uses xychart", () => {
    const bar = JSON.stringify({
      type: "bar",
      x: ["A", "B"],
      series: [{ name: "s", data: [1, 2] }],
    });
    const barHtml = renderHtmlReport({
      ...base,
      mindmapMermaid: "",
      markdown: `## 数值\n\n\`\`\`chart\n${bar}\n\`\`\`\n`,
    });
    expect(barHtml).toContain("mermaid.min.js");
    expect(barHtml).toContain("xychart-beta");

    const pie = JSON.stringify({
      type: "pie",
      x: ["A", "B"],
      series: [{ name: "s", data: [1, 2] }],
    });
    const pieHtml = renderHtmlReport({
      ...base,
      mindmapMermaid: "",
      markdown: `## 数值\n\n\`\`\`chart\n${pie}\n\`\`\`\n`,
    });
    expect(pieHtml).not.toContain("mermaid.min.js");
  });

  it("keeps left toc at mid width and collapses toc under 520px", () => {
    const html = renderHtmlReport(base);
    expect(html).toContain("max-width: 860px) and (min-width: 521px)");
    expect(html).toContain("max-width: 520px");
    expect(html).toContain(".sidebar:not(.toc-open) .toc { display: none; }");
    expect(html).toContain('classList.toggle("toc-open")');
    // Legacy full-stack-at-860 behavior must be gone.
    expect(html).not.toMatch(
      /@media \(max-width: 860px\) \{\s*\.layout \{ flex-direction: column; \}/,
    );
  });

  it("uses icon theme toggle instead of text pill", () => {
    const html = renderHtmlReport(base);
    expect(html).toContain('aria-label="明暗切换"');
    expect(html).toContain('class="icon-sun"');
    expect(html).toContain('class="icon-moon"');
    expect(html).not.toMatch(/>明暗切换</);
  });

  it("intercepts in-document hash clicks to avoid parent navigation", () => {
    const html = renderHtmlReport(base);
    expect(html).toContain("function scrollToHash");
    expect(html).toContain('href.charAt(0) !== "#"');
    expect(html).toContain("scrollIntoView");
    expect(html).toContain("preventDefault");
    // preventDefault must run for every # link, not only when scrollToHash succeeds.
    const clickHandler = html.slice(
      html.indexOf('document.addEventListener("click"'),
      html.indexOf("var links = document.querySelectorAll"),
    );
    expect(clickHandler.indexOf("preventDefault")).toBeLessThan(
      clickHandler.lastIndexOf("scrollToHash(href)"),
    );
  });
});
