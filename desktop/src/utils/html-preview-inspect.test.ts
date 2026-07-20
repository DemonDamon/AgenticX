import { describe, expect, it } from "vitest";
import {
  HTML_INSPECT_MSG,
  buildHtmlElementContextSnippet,
  injectHtmlInspectBridge,
  isHtmlInspectChildMessage,
} from "./html-preview-inspect";

describe("injectHtmlInspectBridge", () => {
  it("injects bridge before </body>", () => {
    const html = "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>";
    const out = injectHtmlInspectBridge(html);
    expect(out).toContain("__agxHtmlInspectInstalled");
    expect(out).toContain(HTML_INSPECT_MSG);
    expect(out.indexOf("__agxHtmlInspectInstalled")).toBeLessThan(out.indexOf("</body>"));
  });

  it("is idempotent", () => {
    const html = "<html><body>x</body></html>";
    const once = injectHtmlInspectBridge(html);
    const twice = injectHtmlInspectBridge(once);
    expect(twice).toBe(once);
  });

  it("appends when no body/html close tags", () => {
    const out = injectHtmlInspectBridge("<div>solo</div>");
    expect(out.endsWith("</script>") || out.includes("__agxHtmlInspectInstalled")).toBe(true);
  });
});

describe("isHtmlInspectChildMessage", () => {
  it("accepts hover/select/leave/escape", () => {
    expect(isHtmlInspectChildMessage({ type: HTML_INSPECT_MSG, action: "leave" })).toBe(true);
    expect(isHtmlInspectChildMessage({ type: HTML_INSPECT_MSG, action: "escape" })).toBe(true);
    expect(isHtmlInspectChildMessage({ type: "other", action: "leave" })).toBe(false);
  });
});

describe("buildHtmlElementContextSnippet", () => {
  it("includes path, selector, and outerHTML for model editing", () => {
    const block = buildHtmlElementContextSnippet({
      absolutePath: "/tmp/report.html",
      tagName: "h1",
      selectorHint: "h1",
      outerHTML: "<h1>AI Coding</h1>",
      innerText: "AI Coding",
    });
    expect(block).toContain("path: /tmp/report.html");
    expect(block).toContain("tag: h1");
    expect(block).toContain("visible_text: AI Coding");
    expect(block).toContain("<h1>AI Coding</h1>");
    expect(block).toContain("answer from visible_text first");
  });

  it("notes Mermaid/SVG when markup looks like rendered diagram nodes", () => {
    const block = buildHtmlElementContextSnippet({
      absolutePath: "/tmp/charts/index.html",
      tagName: "g",
      selectorHint: "g.cluster",
      outerHTML: '<g class="cluster"><rect/><text>当前状态</text></g>',
      innerText: "当前状态 前期涨幅过大",
    });
    expect(block).toContain("visible_text: 当前状态 前期涨幅过大");
    expect(block).toContain("Mermaid/SVG");
  });

  it("includes user_comment from 评论到对话", () => {
    const block = buildHtmlElementContextSnippet({
      absolutePath: "/tmp/a.html",
      tagName: "h1",
      selectorHint: "h1",
      outerHTML: "<h1>Title</h1>",
      innerText: "Title",
      comment: "这个对吗",
    });
    expect(block).toContain("user_comment: 这个对吗");
    expect(block).toContain("User question/comment about this element");
    expect(block).toContain("Do NOT give a generic HTML tag dictionary");
  });
});
