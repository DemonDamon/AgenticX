import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { chatMarkdownComponents, MarkdownContext } from "./markdown-components";

describe("chat markdown local artifact paths", () => {
  it("keeps long clickable paths inside narrow message bubbles", () => {
    const longPath =
      "/Users/dubianche/.agenticx/groups/370ac7979/2026-08-28-0813-各位-我们想做一个企业用的-agent/gr_606bd56418234.md";
    const html = renderToStaticMarkup(
      <MarkdownContext.Provider value={{ onRevealPath: vi.fn() }}>
        <ReactMarkdown components={chatMarkdownComponents}>{`\`${longPath}\``}</ReactMarkdown>
      </MarkdownContext.Provider>,
    );

    expect(html).toContain("<button");
    expect(html).toContain("max-w-full");
    expect(html).toContain("whitespace-normal");
    expect(html).toContain("break-all");
    expect(html).toContain("text-left");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain(longPath);
  });
});
