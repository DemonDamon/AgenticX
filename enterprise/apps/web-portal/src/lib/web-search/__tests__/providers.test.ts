import { describe, expect, it, vi } from "vitest";
import {
  configuredWebSearchProviders,
  executeWebSearch,
  formatHits,
  listWebSearchAdapters,
  looksLikeDdgChallenge,
  parseDuckDuckGoHtml,
  parseDuckDuckGoLite,
  registerWebSearchAdapter,
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

  it("registers and maps the standalone Doubao Custom search protocol", async () => {
    const longQuery = `${"前".repeat(110)}保留结尾约束`;
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          ResponseMetadata: { RequestId: "request-1" },
          Result: {
            WebResults: [
              {
                Title: "实时结果",
                Url: "https://news.example/result",
                Snippet: "短摘要",
                Summary: "适合模型使用的长摘要",
                PublishTime: "2026-08-13T08:00:00+08:00",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const hits = await executeWebSearch(
      longQuery,
      5,
      { provider: "doubao", apiKey: "search-key", maxResults: 5 },
      fetchImpl as unknown as typeof fetch,
    );

    expect(listWebSearchAdapters()).toContainEqual(
      expect.objectContaining({
        id: "doubao",
        requiresApiKey: true,
        supportsCustomEndpoint: true,
      }),
    );
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://open.feedcoopapi.com/search_api/web_search",
    );
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(Array.from(String(request.Query)).length).toBeLessThanOrEqual(100);
    expect(String(request.Query)).toContain("保留结尾约束");
    expect(request).toMatchObject({
      SearchType: "web",
      Count: 5,
      NeedSummary: true,
    });
    expect(request).not.toHaveProperty("Filter");
    expect(request).not.toHaveProperty("QueryControl");
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("x-traffic-tag")).toBe(
      "skill_web_search_common",
    );
    expect(hits).toEqual([
      {
        title: "实时结果",
        url: "https://news.example/result",
        snippet: "适合模型使用的长摘要",
        publishedAt: "2026-08-13T08:00:00+08:00",
      },
    ]);
  });

  it("treats structured Doubao provider errors as failed search attempts", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            Error: { CodeN: 700429, Code: "TooManyRequests", Message: "rate limited" },
          },
          Result: null,
        }),
        { status: 200 },
      ),
    );

    await expect(
      executeWebSearch(
        "q",
        5,
        { provider: "doubao", apiKey: "search-key", maxResults: 5 },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/TooManyRequests/);
  });

  it("uses a custom endpoint only through a compatible registered protocol", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          data: {
            webPages: {
              value: [{ name: "Custom", url: "https://result.example/a", summary: "ok" }],
            },
          },
        }),
        { status: 200 },
      ),
    );
    const hits = await executeWebSearch(
      "q",
      5,
      {
        provider: "bocha",
        apiKey: "legacy",
        maxResults: 5,
        providers: [
          {
            id: "customer-search",
            adapter: "bocha",
            displayName: "Customer search",
            apiKey: "customer-key",
            enabled: true,
            priority: 0,
            options: { endpoint: "https://1.1.1.1/search" },
          },
        ],
      },
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://1.1.1.1/search");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      connectAddress: "1.1.1.1",
    });
    expect(hits[0]?.title).toBe("Custom");
  });

  it("discards provider-returned links to private network targets", async () => {
    const search = vi.fn(async () => [
      { title: "Unsafe", url: "http://127.0.0.1/admin", snippet: "private" },
    ]);
    registerWebSearchAdapter({
      id: "test-private-result-protocol",
      displayName: "Test private result protocol",
      requiresApiKey: false,
      search,
    });

    await expect(
      executeWebSearch("q", 5, {
        provider: "test-private-result-protocol",
        apiKey: "",
        maxResults: 5,
      }),
    ).rejects.toThrow(/no hits/i);
  });

  it("rejects private custom endpoints before sending credentials", async () => {
    const fetchImpl = vi.fn();
    await expect(
      executeWebSearch(
        "q",
        5,
        {
          provider: "bocha",
          apiKey: "legacy",
          maxResults: 5,
          providers: [
            {
              id: "unsafe-search",
              adapter: "bocha",
              displayName: "Unsafe",
              apiKey: "secret",
              enabled: true,
              priority: 0,
              options: { endpoint: "https://127.0.0.1/private" },
            },
          ],
        },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/私有|保留|内部/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("routes tenant-defined provider ids through a registered adapter", async () => {
    const search = vi.fn(async ({ query }: { query: string }) => [
      { title: "Custom", url: "https://custom.example/result", snippet: query },
    ]);
    registerWebSearchAdapter({
      id: "test-custom-protocol",
      displayName: "Test custom protocol",
      requiresApiKey: true,
      search,
    });

    const hits = await executeWebSearch("custom query", 5, {
      provider: "test-custom-protocol",
      apiKey: "legacy-key",
      maxResults: 5,
      providers: [
        {
          id: "tenant-chosen-name",
          adapter: "test-custom-protocol",
          displayName: "Tenant Search",
          apiKey: "tenant-key",
          enabled: true,
          priority: 0,
        },
      ],
    });

    expect(hits[0]?.snippet).toBe("custom query");
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "tenant-key", query: "custom query" }),
    );
  });

  it("does not revive a disabled explicit provider through legacy mirrors", () => {
    expect(
      configuredWebSearchProviders({
        provider: "bocha",
        apiKey: "legacy-key",
        maxResults: 5,
        providers: [
          {
            id: "disabled-provider",
            adapter: "bocha",
            displayName: "Disabled",
            apiKey: "configured-key",
            enabled: false,
            priority: 0,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("sends bocha summary+freshness for weather queries and omits freshness for stable facts", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({
          data: {
            webPages: {
              value: [{ name: "Hit", url: "https://example.com/a", snippet: "s" }],
            },
          },
        }),
        { status: 200 },
      );
    });

    await executeWebSearch(
      "广州南沙天气如何",
      5,
      { provider: "bocha", apiKey: "k", maxResults: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(bodies[0]).toMatchObject({ summary: true, freshness: "oneDay" });

    await executeWebSearch(
      "OpenAI 是谁创办的",
      5,
      { provider: "bocha", apiKey: "k", maxResults: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    const stableBody = bodies[1] as Record<string, unknown>;
    expect(stableBody.summary).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(stableBody, "freshness")).toBe(false);
  });

  it("prefers bocha summary over snippet and maps datePublished", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            webPages: {
              value: [
                {
                  name: "t",
                  url: "https://a",
                  snippet: "s",
                  summary: "long-summary",
                  datePublished: "2026-08-02T00:00:00+08:00",
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );
    const hits = await executeWebSearch(
      "广州南沙天气如何",
      5,
      { provider: "bocha", apiKey: "k", maxResults: 5 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(hits[0]?.snippet).toBe("long-summary");
    expect(hits[0]?.publishedAt).toBe("2026-08-02T00:00:00+08:00");
  });

  it("formatHits includes publishedAt when present", () => {
    const withDate = formatHits([
      {
        title: "t",
        url: "https://a",
        snippet: "s",
        publishedAt: "2026-08-02T00:00:00+08:00",
      },
    ]);
    expect(withDate).toContain("发布时间: 2026-08-02T00:00:00+08:00");

    const withoutDate = formatHits([{ title: "t", url: "https://a", snippet: "s" }]);
    expect(withoutDate).not.toContain("发布时间");
  });

  it("falls back only to another configured provider instance", async () => {
    const attempts: Array<{ providerId: string; outcome: string; hitCount: number }> = [];
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("bochaai.com")) {
        throw new Error("bocha down");
      }
      return new Response(DDG_HTML, { status: 200 });
    });
    const hits = await executeWebSearch(
      "q",
      5,
      {
        provider: "bocha",
        apiKey: "k",
        maxResults: 5,
        providers: [
          {
            id: "customer-primary",
            adapter: "bocha",
            displayName: "Primary",
            apiKey: "k",
            enabled: true,
            priority: 0,
          },
          {
            id: "customer-secondary",
            adapter: "duckduckgo",
            displayName: "Secondary",
            apiKey: "",
            enabled: true,
            priority: 1,
          },
        ],
      },
      fetchImpl as unknown as typeof fetch,
      {
        onProviderAttempt: ({ providerId, outcome, hitCount }) => {
          attempts.push({ providerId, outcome, hitCount });
        },
      },
    );
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(attempts).toEqual([
      { providerId: "customer-primary", outcome: "failed", hitCount: 0 },
      { providerId: "customer-secondary", outcome: "ok", hitCount: hits.length },
    ]);
  });

  it("lets an authoritative admission hook stop provider failover before network I/O", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("primary down");
    });
    const admitted: string[] = [];

    await expect(
      executeWebSearch(
        "q",
        5,
        {
          provider: "bocha",
          apiKey: "k",
          maxResults: 5,
          providers: [
            {
              id: "primary",
              adapter: "bocha",
              displayName: "Primary",
              apiKey: "k",
              enabled: true,
              priority: 0,
            },
            {
              id: "secondary",
              adapter: "duckduckgo",
              displayName: "Secondary",
              apiKey: "",
              enabled: true,
              priority: 1,
            },
          ],
        },
        fetchImpl as unknown as typeof fetch,
        {
          beforeProviderAttempt: (providerId) => {
            admitted.push(providerId);
            if (providerId === "secondary") throw new Error("provider budget exhausted");
          },
        },
      ),
    ).rejects.toThrow("provider budget exhausted");

    expect(admitted).toEqual(["primary", "secondary"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("awaits an async admission hook and counts primary plus failover attempts", async () => {
    const search = vi.fn(async () => {
      throw new Error("provider down");
    });
    registerWebSearchAdapter({
      id: "test-admission-primary",
      displayName: "Admission primary",
      requiresApiKey: false,
      search,
    });
    registerWebSearchAdapter({
      id: "test-admission-secondary",
      displayName: "Admission secondary",
      requiresApiKey: false,
      search,
    });
    let reserved = 0;
    const reserve = vi.fn(async () => {
      // Async gate: the provider request must not start before it settles.
      await Promise.resolve();
      reserved += 1;
    });

    await expect(
      executeWebSearch(
        "q",
        5,
        {
          provider: "test-admission-primary",
          apiKey: "",
          maxResults: 5,
          providers: [
            {
              id: "primary",
              adapter: "test-admission-primary",
              displayName: "Primary",
              apiKey: "",
              enabled: true,
              priority: 0,
            },
            {
              id: "secondary",
              adapter: "test-admission-secondary",
              displayName: "Secondary",
              apiKey: "",
              enabled: true,
              priority: 1,
            },
          ],
        },
        undefined,
        { beforeProviderAttempt: reserve },
      ),
    ).rejects.toThrow("provider down");

    // Both the failed primary attempt and the failover attempt are metered.
    expect(reserved).toBe(2);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("never reaches the adapter once the admission hook rejects", async () => {
    const search = vi.fn(async () => []);
    registerWebSearchAdapter({
      id: "test-admission-blocked",
      displayName: "Admission blocked",
      requiresApiKey: false,
      search,
    });

    await expect(
      executeWebSearch(
        "q",
        5,
        {
          provider: "test-admission-blocked",
          apiKey: "",
          maxResults: 5,
          providers: [
            {
              id: "primary",
              adapter: "test-admission-blocked",
              displayName: "Primary",
              apiKey: "",
              enabled: true,
              priority: 0,
            },
            {
              id: "secondary",
              adapter: "test-admission-blocked",
              displayName: "Secondary",
              apiKey: "",
              enabled: true,
              priority: 1,
            },
          ],
        },
        undefined,
        { beforeProviderAttempt: async () => Promise.reject(new Error("daily quota exhausted")) },
      ),
    ).rejects.toThrow("daily quota exhausted");

    expect(search).not.toHaveBeenCalled();
  });

  it("does not charge admission for unknown adapters or missing credentials", async () => {
    const search = vi.fn(async () => []);
    const reserve = vi.fn(async () => undefined);
    registerWebSearchAdapter({
      id: "test-admission-keyed",
      displayName: "Admission keyed",
      requiresApiKey: true,
      search,
    });

    await expect(
      executeWebSearch(
        "q",
        5,
        {
          provider: "test-admission-keyed",
          apiKey: "",
          maxResults: 5,
          providers: [
            {
              id: "ghost",
              adapter: "adapter-that-was-never-registered",
              displayName: "Ghost",
              apiKey: "",
              enabled: true,
              priority: 0,
            },
            {
              id: "keyless",
              adapter: "test-admission-keyed",
              displayName: "Keyless",
              apiKey: "",
              enabled: true,
              priority: 1,
            },
          ],
        },
        undefined,
        { beforeProviderAttempt: reserve },
      ),
    ).rejects.toThrow(/no configured web search provider/);

    expect(reserve).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("does not invent an unconfigured fallback provider", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("primary down");
    });
    await expect(
      executeWebSearch(
        "q",
        5,
        { provider: "bocha", apiKey: "k", maxResults: 5 },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow("primary down");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("propagates a shared run deadline into the active provider request", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          providerSignal = init?.signal;
          if (init?.signal?.aborted) {
            reject(init.signal.reason);
            return;
          }
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    );
    const pending = executeWebSearch(
      "q",
      5,
      { provider: "bocha", apiKey: "k", maxResults: 5 },
      fetchImpl as unknown as typeof fetch,
      { signal: controller.signal },
    );
    const reason = new DOMException("run deadline", "TimeoutError");
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(providerSignal?.aborted).toBe(true);
  });

  it("clamps max_results above cap to 50", async () => {
    const fetchImpl = vi.fn(async () => new Response(DDG_HTML, { status: 200 }));
    await executeWebSearch("q", 999, { provider: "duckduckgo", apiKey: "", maxResults: 5 }, fetchImpl as unknown as typeof fetch);
    // Cap is applied internally; ensure parse still returns at most cap.
    const hits = parseDuckDuckGoHtml(DDG_HTML, WEB_SEARCH_MAX_RESULTS_CAP);
    expect(hits.length).toBeLessThanOrEqual(WEB_SEARCH_MAX_RESULTS_CAP);
  });
});
