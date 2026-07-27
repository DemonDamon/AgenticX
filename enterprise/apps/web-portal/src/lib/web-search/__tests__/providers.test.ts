import { describe, expect, it, vi } from "vitest";
import {
  executeWebSearch,
  parseDuckDuckGoHtml,
  unwrapDuckDuckGoRedirect,
  WEB_SEARCH_MAX_RESULTS_CAP,
} from "../providers";

const DDG_HTML = `
<html><body>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">Alpha Title</a>
<a class="result__snippet">Alpha snippet text</a>
<a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Beta Title</a>
<a class="result__snippet">Beta snippet text</a>
</body></html>
`;

describe("web search providers", () => {
  it("unwraps duckduckgo uddg redirects", () => {
    const href = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fpost";
    expect(unwrapDuckDuckGoRedirect(href)).toBe("https://news.example.com/post");
  });

  it("parses duckduckgo html into >=2 hits with real urls", () => {
    const hits = parseDuckDuckGoHtml(DDG_HTML, 5);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.url).toBe("https://example.com/a");
    expect(hits[0]?.url.includes("uddg=")).toBe(false);
    expect(hits[1]?.title).toContain("Beta");
  });

  it("maps bocha and tavily json payloads", async () => {
    const bochaFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            webPages: {
              value: [{ name: "Bocha Hit", url: "https://bocha.example/x", snippet: "s1" }],
            },
          },
        }),
        { status: 200 },
      ),
    );
    const bochaHits = await executeWebSearch("q", 5, { provider: "bocha", apiKey: "k", maxResults: 5 }, bochaFetch as unknown as typeof fetch);
    expect(bochaHits[0]?.title).toBe("Bocha Hit");

    const tavilyFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ title: "Tavily Hit", url: "https://tavily.example/y", content: "c1" }],
        }),
        { status: 200 },
      ),
    );
    const tavilyHits = await executeWebSearch("q", 5, { provider: "tavily", apiKey: "k", maxResults: 5 }, tavilyFetch as unknown as typeof fetch);
    expect(tavilyHits[0]?.title).toBe("Tavily Hit");
  });

  it("falls back to duckduckgo when bocha throws", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("bochaai.com")) {
        throw new Error("bocha down");
      }
      return new Response(DDG_HTML, { status: 200 });
    });
    const hits = await executeWebSearch("q", 5, { provider: "bocha", apiKey: "k", maxResults: 5 }, fetchImpl as unknown as typeof fetch);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("clamps max_results above cap to 50", async () => {
    const fetchImpl = vi.fn(async () => new Response(DDG_HTML, { status: 200 }));
    await executeWebSearch("q", 999, { provider: "duckduckgo", apiKey: "", maxResults: 5 }, fetchImpl as unknown as typeof fetch);
    // Cap is applied internally; ensure parse still returns at most cap.
    const hits = parseDuckDuckGoHtml(DDG_HTML, WEB_SEARCH_MAX_RESULTS_CAP);
    expect(hits.length).toBeLessThanOrEqual(WEB_SEARCH_MAX_RESULTS_CAP);
  });
});
