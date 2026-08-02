import { describe, expect, it, vi } from "vitest";
import {
  extractMainText,
  fetchPageContent,
  fetchPagesBatch,
  MIN_USABLE_PAGE_CHARS,
} from "../page-fetch";
import type { DirectFetch } from "../direct-fetch";

describe("extractMainText", () => {
  it("extracts article body and strips script/nav/footer", () => {
    const html = `
      <html><body>
        <nav>导航栏</nav>
        <script>alert(1)</script>
        <article><p>正文第一段。</p><p>正文第二段。</p></article>
        <footer>页脚</footer>
      </body></html>
    `;
    const text = extractMainText(html);
    expect(text).toContain("正文第一段");
    expect(text).toContain("正文第二段");
    expect(text).not.toContain("导航栏");
    expect(text).not.toContain("页脚");
    expect(text).not.toContain("alert");
  });

  it("prefers the longer of article vs main", () => {
    const html = `
      <main><p>短</p></main>
      <article><p>${"长内容".repeat(40)}</p></article>
    `;
    const text = extractMainText(html);
    expect(text.length).toBeGreaterThan(40);
    expect(text).toContain("长内容");
  });

  it("turns block tags into newlines so paragraphs do not glue", () => {
    const html = `<article><p>甲</p><p>乙</p><br>丙</article>`;
    const text = extractMainText(html);
    expect(text).toMatch(/甲\n+乙/);
    expect(text).toContain("丙");
  });

  it("decodes common HTML entities", () => {
    const html = `<article><p>A&amp;B&nbsp;C</p></article>`;
    expect(extractMainText(html)).toContain("A&B C");
  });
});

describe("fetchPageContent", () => {
  it("returns null for non-html content types", async () => {
    const fetchImpl: DirectFetch = async () =>
      new Response("%PDF-1.4", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    await expect(
      fetchPageContent("https://example.com/a.pdf", {
        fetchImpl,
        backends: ["native"],
      }),
    ).resolves.toBeNull();
  });

  it("returns null when extracted text is too short", async () => {
    const short = "x".repeat(MIN_USABLE_PAGE_CHARS - 1);
    const fetchImpl: DirectFetch = async () =>
      new Response(`<article><p>${short}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    await expect(
      fetchPageContent("https://example.com/short", {
        fetchImpl,
        backends: ["native"],
      }),
    ).resolves.toBeNull();
  });

  it("returns null without throwing when fetchImpl throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl: DirectFetch = async () => {
      throw new Error("network down");
    };
    await expect(
      fetchPageContent("https://example.com/x", {
        fetchImpl,
        backends: ["native"],
      }),
    ).resolves.toBeNull();
    warn.mockRestore();
  });

  it("returns page content for a usable html document", async () => {
    const body = "核心技术点".repeat(80);
    const fetchImpl: DirectFetch = async () =>
      new Response(`<article><p>${body}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    const page = await fetchPageContent("https://example.com/ok", {
      fetchImpl,
      backends: ["native"],
    });
    expect(page).not.toBeNull();
    expect(page!.text).toContain("核心技术点");
    expect(page!.rawChars).toBeGreaterThanOrEqual(MIN_USABLE_PAGE_CHARS);
    expect(page!.backend).toBe("native");
  });

  it("falls back to jina when native returns too_short", async () => {
    const short = "x".repeat(MIN_USABLE_PAGE_CHARS - 1);
    const jinaBody = "Jina 回退正文".repeat(80);
    const fetchImpl: DirectFetch = async (input) => {
      const url = String(input);
      if (url.startsWith("https://r.jina.ai/")) {
        return new Response(jinaBody, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(`<article><p>${short}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const page = await fetchPageContent("https://example.com/short", {
      fetchImpl,
      backends: ["native", "jina"],
    });
    expect(page).not.toBeNull();
    expect(page!.backend).toBe("jina");
    expect(page!.text).toContain("Jina 回退正文");
  });

  it("does not fall back on unsupported_content_type", async () => {
    let calls = 0;
    const fetchImpl: DirectFetch = async () => {
      calls += 1;
      return new Response("%PDF", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    };
    const page = await fetchPageContent("https://example.com/a.pdf", {
      fetchImpl,
      backends: ["native", "jina"],
    });
    expect(page).toBeNull();
    expect(calls).toBe(1);
  });
});

describe("fetchPagesBatch", () => {
  it("preserves order with mixed success/failure and accumulates stats", async () => {
    const okBody = "可用正文内容".repeat(80);
    const fetchImpl: DirectFetch = async (input) => {
      const url = String(input);
      if (url.includes("fail")) {
        return new Response("nope", {
          status: 200,
          headers: { "content-type": "application/pdf" },
        });
      }
      return new Response(`<article><p>${okBody}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const { pages, stats } = await fetchPagesBatch(
      ["https://example.com/a", "https://example.com/fail", "https://example.com/c"],
      { fetchImpl, concurrency: 2, backends: ["native"] },
    );
    expect(pages).toHaveLength(3);
    expect(pages[0]?.text).toContain("可用正文内容");
    expect(pages[1]).toBeNull();
    expect(pages[2]?.text).toContain("可用正文内容");
    expect(stats.unsupported_content_type).toBe(1);
  });
});
