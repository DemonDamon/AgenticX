import { describe, expect, it, vi } from "vitest";
import type { DirectFetch } from "../direct-fetch";
import {
  firecrawlBackend,
  jinaBackend,
  nativeBackend,
} from "../page-fetch-backends";
import { MIN_USABLE_PAGE_CHARS } from "../page-fetch-extract";

describe("nativeBackend", () => {
  it("returns unsupported_content_type for application/pdf", async () => {
    const fetchImpl: DirectFetch = async () =>
      new Response("%PDF-1.4", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      });
    const result = await nativeBackend("https://example.com/a.pdf", {
      fetchImpl,
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ ok: false, reason: "unsupported_content_type" });
  });

  it("returns too_short for short body", async () => {
    const short = "x".repeat(MIN_USABLE_PAGE_CHARS - 1);
    const fetchImpl: DirectFetch = async () =>
      new Response(`<article><p>${short}</p></article>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    const result = await nativeBackend("https://example.com/short", {
      fetchImpl,
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ ok: false, reason: "too_short" });
  });

  it("returns ok:false without throwing when fetchImpl throws", async () => {
    const fetchImpl: DirectFetch = async () => {
      throw new Error("network down");
    };
    const result = await nativeBackend("https://example.com/x", {
      fetchImpl,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("network_error");
  });
});

describe("jinaBackend", () => {
  it("requests r.jina.ai with original URL and no auth when key missing", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const body = "Jina 抽取正文".repeat(80);
    const fetchImpl: DirectFetch = async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(input), headers });
      return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
    };
    const target = "https://example.com/article";
    const result = await jinaBackend(target, { fetchImpl, timeoutMs: 5_000 });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.startsWith("https://r.jina.ai/")).toBe(true);
    expect(calls[0]?.url).toContain(target);
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it("adds authorization header when apiKey present", async () => {
    const calls: Array<Record<string, string>> = [];
    const body = "Jina 抽取正文".repeat(80);
    const fetchImpl: DirectFetch = async (_input, init) => {
      calls.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(body, { status: 200 });
    };
    await jinaBackend("https://example.com/a", {
      fetchImpl,
      timeoutMs: 5_000,
      apiKey: "jk-test",
    });
    expect(calls[0]?.authorization).toBe("Bearer jk-test");
  });

  it("returns ok:false without throwing when fetchImpl throws", async () => {
    const fetchImpl: DirectFetch = async () => {
      throw new Error("boom");
    };
    const result = await jinaBackend("https://example.com/x", {
      fetchImpl,
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
  });
});

describe("firecrawlBackend", () => {
  it("does not call fetch when apiKey is empty", async () => {
    const fetchImpl = vi.fn<DirectFetch>();
    const result = await firecrawlBackend("https://example.com/a", {
      fetchImpl,
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ ok: false, reason: "network_error" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("parses data.markdown from scrape response", async () => {
    const markdown = "Firecrawl 正文内容".repeat(80);
    const fetchImpl: DirectFetch = async () =>
      new Response(JSON.stringify({ data: { markdown } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await firecrawlBackend("https://example.com/a", {
      fetchImpl,
      timeoutMs: 5_000,
      apiKey: "fc-key",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("Firecrawl 正文内容");
  });

  it("returns ok:false without throwing when fetchImpl throws", async () => {
    const fetchImpl: DirectFetch = async () => {
      throw new Error("boom");
    };
    const result = await firecrawlBackend("https://example.com/x", {
      fetchImpl,
      timeoutMs: 5_000,
      apiKey: "fc-key",
    });
    expect(result.ok).toBe(false);
  });
});
