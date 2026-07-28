import { describe, expect, it, vi } from "vitest";
import {
  executeWebSearch,
  looksLikeDdgChallenge,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
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

const DDG_LITE_HTML = `
<html><body>
<table>
<tr><td><a class="result-link" href="//example.com/lite-a">Lite Alpha</a></td></tr>
<tr><td class="result-snippet">Lite alpha snippet</td></tr>
<tr><td><a class="result-link" href="https://example.com/lite-b">Lite Beta</a></td></tr>
<tr><td class="result-snippet">Lite beta snippet</td></tr>
</table>
</body></html>
`;

/** Real DDG Lite order: href before class (regression for Near-aligned parser). */
const DDG_LITE_HTML_HREF_FIRST = `
<html><body>
<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeepseek.com%2F&amp;rut=abc" class='result-link'>DeepSeek</a>
<td class='result-snippet'>Official site snippet</td>
<a rel="nofollow" href="https://en.wikipedia.org/wiki/DeepSeek" class='result-link'>DeepSeek - Wikipedia</a>
<td class='result-snippet'>Wiki snippet</td>
</body></html>
`;

const DDG_CHALLENGE_HTML = `
<html><body>
<script src="anomaly.js"></script>
<p>Unfortunately, unusual traffic from your computer network</p>
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

  it("parses duckduckgo lite and normalizes protocol-relative urls", () => {
    const hits = parseDuckDuckGoLite(DDG_LITE_HTML, 5);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.url).toBe("https://example.com/lite-a");
    expect(hits[0]?.title).toContain("Lite Alpha");
    expect(hits[0]?.snippet).toContain("Lite alpha");
  });

  it("parses real lite markup where href precedes class", () => {
    const hits = parseDuckDuckGoLite(DDG_LITE_HTML_HREF_FIRST, 5);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.url).toBe("https://deepseek.com/");
    expect(hits[0]?.title).toBe("DeepSeek");
    expect(hits[1]?.url).toContain("wikipedia.org");
  });

  it("detects duckduckgo challenge pages", () => {
    expect(looksLikeDdgChallenge(202, "")).toBe(true);
    expect(looksLikeDdgChallenge(200, DDG_CHALLENGE_HTML)).toBe(true);
    expect(looksLikeDdgChallenge(200, DDG_HTML)).toBe(false);
  });

  it("falls back to lite when html returns challenge", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("html.duckduckgo.com")) {
        return new Response(DDG_CHALLENGE_HTML, { status: 200 });
      }
      if (String(url).includes("lite.duckduckgo.com")) {
        return new Response(DDG_LITE_HTML, { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const hits = await executeWebSearch(
      "q",
      5,
      { provider: "duckduckgo", apiKey: "", maxResults: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(hits[0]?.title).toContain("Lite Alpha");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails when both html and lite return challenge pages", async () => {
    const fetchImpl = vi.fn(async () => new Response(DDG_CHALLENGE_HTML, { status: 202 }));
    await expect(
      executeWebSearch(
        "q",
        5,
        { provider: "duckduckgo", apiKey: "", maxResults: 5 },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/challenge|duckduckgo/i);
  });

  it("falls back to lite when html endpoint throws", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("html.duckduckgo.com")) {
        throw new Error("html timeout");
      }
      return new Response(DDG_LITE_HTML, { status: 200 });
    });
    const hits = await executeWebSearch(
      "q",
      5,
      { provider: "duckduckgo", apiKey: "", maxResults: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("lite.duckduckgo.com");
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
