import { describe, expect, it, vi } from "vitest";
import {
  extractDocumentTitle,
  extractMainText,
  fetchPageContent,
  fetchPageContentWithReason,
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

  // Both fixtures are reduced from real pages that returned the wrong text.
  // Neither uses <article>/<main>: everything is <div>, which is what made the
  // old non-greedy `<div>...</div>` match stop at the first inner `</div>` and
  // hand the page to whichever chrome container happened to be flat.
  it("keeps a nested article body instead of the flat menu beside it", () => {
    const menu = Array.from(
      { length: 30 },
      (_v, index) => `<a href="/c${index}">频道${index}</a>`,
    ).join("");
    const html = `
      <body>
        <div class="main-nav">${menu}</div>
        <div class="article-body">
          <div class="meta"><span>2026-08-14 21:12</span></div>
          <div class="txt">
            <p>公司发布半年度报告，实现营业收入907.03亿元，同比增长1.47%。</p>
            <p>归属于上市公司股东的净利润445.17亿元，同比下降1.95%。</p>
          </div>
        </div>
      </body>`;
    const text = extractMainText(html);
    expect(text).toContain("907.03亿元");
    expect(text).toContain("445.17亿元");
    expect(text).not.toContain("频道0");
  });

  it("keeps the page's own article instead of a rail of recommended headlines", () => {
    const rail = Array.from(
      { length: 12 },
      (_v, index) => `<a href="/r${index}">另一篇被推荐的报道标题之${index}，内容与本页无关。</a>`,
    ).join("");
    const html = `
      <body>
        <div class="content">
          <div class="hd">半年净利润445.17亿元</div>
          <div class="detail">
            <p>披露半年报，上半年实现营业收入907.03亿元，基本每股收益35.57元。</p>
          </div>
        </div>
        <div class="recommend">为你推荐${rail}</div>
      </body>`;
    const text = extractMainText(html);
    expect(text).toContain("35.57元");
    expect(text).not.toContain("另一篇被推荐的报道标题之0");
  });

  it("does not count inline script source as page text", () => {
    // Script bodies once inflated their container's apparent text, which let a
    // boilerplate block outrank the real article.
    const noise = `<script>${"var padding = 'xxxxxxxxxx';".repeat(80)}</script>`;
    const html = `
      <body>
        <div class="wrap">${noise}<p>短</p></div>
        <div class="story"><div class="p"><p>${"真正的正文内容。".repeat(20)}</p></div></div>
      </body>`;
    const text = extractMainText(html);
    expect(text).toContain("真正的正文内容");
    expect(text).not.toContain("padding");
  });

  it("removes an unclosed noise element through to the end of the document", () => {
    // Page HTML is truncated before extraction, so a <script> routinely has no
    // closing tag. Matching only closed elements let its source through as
    // prose — about ten thousand characters of it on a real page.
    const script = "var payload = 'LEAKED_SCRIPT_BODY';".repeat(300);
    const html =
      `<body><div class="story"><p>${"正文一句。".repeat(10)}</p>` +
      `<script>${script}</div></body>`;
    const text = extractMainText(html);
    expect(text).toContain("正文一句");
    expect(text).not.toContain("LEAKED_SCRIPT_BODY");
    expect(text.length).toBeLessThan(200);
  });

  it("treats script and style bodies as raw text, not as markup", () => {
    // A browser stops looking for tags inside script/style. Parsing them as
    // markup let a `<` in the source swallow the real closing tag, leaving the
    // element open to the end of the document — where the EOF cleanup then
    // removed the entire page. All three of these returned "".
    const body = `<article><p>${"真正的正文内容，这里是一整篇文章。".repeat(20)}</p></article>`;
    for (const noise of [
      `<script>const tpl = "<script>";</script>`,
      `<script>if (a<b) render();</script>`,
      `<style>/* <style> */ .a{color:red}</style>`,
    ]) {
      const text = extractMainText(`${noise}\n${body}`);
      expect(text).toContain("真正的正文内容");
      expect(text).not.toContain("render");
      expect(text).not.toContain("color:red");
    }
  });

  it("ends a raw-text element at its own closing tag, as a browser does", () => {
    // Not a regression repro — this one passes on the old scanner too. It
    // guards the new raw-text path against the obvious wrong version of it:
    // the classic HTML gotcha is that a "</script>" inside a JavaScript string
    // really does close the element, so scanning to the LAST closing tag
    // instead of the first would leak the source and diverge from the browser.
    const html =
      `<body><script>var s = "</script>";</script>` +
      `<div class="story"><p>${"正文一句。".repeat(20)}</p></div></body>`;
    const text = extractMainText(html);
    expect(text).toContain("正文一句");
    expect(text).not.toContain("var s");
  });

  it("survives an unclosed container without losing the body", () => {
    const html = `
      <body>
        <div class="broken">
        <div class="story"><p>${"报告显示，营业收入增长。".repeat(20)}</p></div>
      </body>`;
    expect(extractMainText(html)).toContain("营业收入增长");
  });
});

describe("extractDocumentTitle", () => {
  it("reads and decodes the standard title element without site-specific rules", () => {
    expect(
      extractDocumentTitle(
        "<html><head><TITLE>Research &amp; Engineering</TITLE></head><body></body></html>",
      ),
    ).toBe("Research & Engineering");
  });

  it("returns undefined for a missing or empty title", () => {
    expect(extractDocumentTitle("<html><body>body</body></html>")).toBeUndefined();
    expect(extractDocumentTitle("<title>   </title>")).toBeUndefined();
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

  it("preserves too_short for callers that need an explicit fallback notice", async () => {
    const short = "x".repeat(MIN_USABLE_PAGE_CHARS - 1);
    const fetchImpl: DirectFetch = async () =>
      new Response(`<article><p>${short}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });

    await expect(
      fetchPageContentWithReason("https://example.com/short", {
        fetchImpl,
        backends: ["native"],
      }),
    ).resolves.toEqual({ page: null, failure: "too_short" });
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
      new Response(`<html><head><title>论文标题</title></head><body><article><p>${body}</p></article></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    const page = await fetchPageContent("https://example.com/ok", {
      fetchImpl,
      backends: ["native"],
    });
    expect(page).not.toBeNull();
    expect(page!.text).toContain("核心技术点");
    expect(page!.title).toBe("论文标题");
    expect(page!.rawChars).toBeGreaterThanOrEqual(MIN_USABLE_PAGE_CHARS);
    expect(page!.backend).toBe("native");
  });

  it("keeps the legacy 12k default but accepts a bounded explicit-read ceiling", async () => {
    const body = "A".repeat(20_000);
    const fetchImpl: DirectFetch = async () =>
      new Response(`<article><p>${body}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const legacy = await fetchPageContent("https://example.com/default", {
      fetchImpl,
      backends: ["native"],
    });
    const expanded = await fetchPageContent("https://example.com/expanded", {
      fetchImpl,
      backends: ["native"],
      maxChars: 30_000,
    });
    expect(legacy?.text.length).toBeLessThan(20_000);
    expect(expanded?.text.length).toBe(20_000);
    expect(expanded?.rawChars).toBe(20_000);
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

  it("falls back to jina for a PDF that native cannot read", async () => {
    // Authority sources (arxiv, tech reports) are mostly PDFs; native rejects
    // them on content-type, so the chain must still reach the reader backend.
    const jinaBody = "论文正文段落".repeat(80);
    const seen: string[] = [];
    const fetchImpl: DirectFetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith("https://r.jina.ai/")) {
        return new Response(jinaBody, {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response("%PDF", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    };
    const page = await fetchPageContent("https://arxiv.org/pdf/2401.00001", {
      fetchImpl,
      backends: ["native", "jina"],
    });
    expect(page).not.toBeNull();
    expect(page!.backend).toBe("jina");
    expect(page!.text).toContain("论文正文段落");
    expect(seen).toHaveLength(2);
  });

  it("stops the chain on invalid_url without touching later backends", async () => {
    const fetchImpl = vi.fn(async () => new Response("x")) as unknown as DirectFetch;
    const page = await fetchPageContent("ftp://example.com/a", {
      fetchImpl,
      backends: ["native", "jina"],
    });
    expect(page).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "https://service.internal/private",
  ])("never fetches a private or internal result URL: %s", async (url) => {
    const fetchImpl = vi.fn(async () => new Response("x")) as unknown as DirectFetch;

    const page = await fetchPageContent(url, {
      fetchImpl,
      backends: ["native", "jina"],
    });

    expect(page).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a transient failure once on the same backend", async () => {
    const body = "重试后拿到的正文".repeat(80);
    let calls = 0;
    const fetchImpl: DirectFetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return new Response(`<article><p>${body}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };
    const page = await fetchPageContent("https://example.com/flaky", {
      fetchImpl,
      backends: ["native"],
    });
    expect(page).not.toBeNull();
    expect(page!.backend).toBe("native");
    expect(calls).toBe(2);
  });

  it("spends the retry budget once per url, not once per backend", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const fetchImpl: DirectFetch = async () => {
      calls += 1;
      throw new Error("network down");
    };
    const page = await fetchPageContent("https://example.com/dead", {
      fetchImpl,
      backends: ["native", "jina"],
    });
    expect(page).toBeNull();
    // native, native retry, jina — not four attempts.
    expect(calls).toBe(3);
    warn.mockRestore();
  });

  it("skips retries when transientRetries is 0", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const fetchImpl: DirectFetch = async () => {
      calls += 1;
      throw new Error("network down");
    };
    await fetchPageContent("https://example.com/dead", {
      fetchImpl,
      backends: ["native"],
      transientRetries: 0,
    });
    expect(calls).toBe(1);
    warn.mockRestore();
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
