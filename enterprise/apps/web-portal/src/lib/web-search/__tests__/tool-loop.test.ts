import { describe, expect, it, vi } from "vitest";
import {
  buildWebSearchQuery,
  compactHitsForModel,
  extractLastUserQuery,
  formatWebSearchSourcesSse,
  pipeUpstreamSse,
  runWebSearchTurn,
  summarizeSelectedEvidence,
  synthesizeTextSse,
  WEB_SEARCH_CONTEXT_SNIPPET_CHARS,
  WEB_SEARCH_SYSTEM_HINT,
  withSearchContext,
} from "../tool-loop";
import { executeWebSearch, type WebSearchHit } from "../providers";
import {
  isTenantDailySearchProviderQuotaExceeded,
  TenantDailySearchProviderQuotaError,
} from "../daily-provider-quota";
import { readDirectPage, type DirectPageView } from "../direct-page";
import type { PreparedSearchPlan } from "../../chat-routing/turn-plan";
import type { CalculationIntent } from "../../calculator/intent";

type ExecuteSearchConfig = Parameters<typeof executeWebSearch>[2];

/**
 * The body of the streaming answer call.
 *
 * A turn now makes several gateway calls — query rewrite and calculation
 * planning are both non-streaming — so the answer is selected by `stream`
 * rather than by position.
 */
function answerBody<T extends { stream?: unknown }>(bodies: readonly T[]): T | undefined {
  return bodies.find((body) => body.stream === true);
}

/** Non-streaming calls: query rewrite, and calculation planning when it runs. */
function preflightBodies<T extends { stream?: unknown }>(bodies: readonly T[]): T[] {
  return bodies.filter((body) => body.stream === false);
}

function answerBodies<T extends { stream?: unknown }>(bodies: readonly T[]): T[] {
  return bodies.filter((body) => body.stream === true);
}

function sseResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readText(res: Response): Promise<string> {
  return res.text();
}

describe("web search tool loop", () => {
  it("synthesizes sse text frames ending with [DONE]", () => {
    const out = synthesizeTextSse("hello", { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
    expect(out).toContain('data: {"usage"');
    expect(out).toContain('"content":"hello"');
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("extracts the last user query for server-side search", () => {
    expect(
      extractLastUserQuery([
        { role: "system", content: "sys" },
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "  opus 5.0  " },
      ]),
    ).toBe("opus 5.0");
  });

  it("does not fall back to an older query when the latest user turn has no text", () => {
    expect(
      extractLastUserQuery([
        { role: "user", content: "旧问题" },
        { role: "assistant", content: "旧回答" },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          ],
        },
      ]),
    ).toBe("");
  });

  it("strips injected attachment bodies from the search query", async () => {
    const { sanitizeWebSearchQuery } = await import("../tool-loop");
    const raw = [
      "总结一下",
      "",
      "--- 附件: 方案.md ---",
      "很长的正文".repeat(80),
    ].join("\n");
    expect(sanitizeWebSearchQuery(raw)).toBe("总结一下");
    expect(
      extractLastUserQuery([{ role: "user", content: raw }]),
    ).toBe("总结一下");
    expect(
      sanitizeWebSearchQuery(
        "Summarize\n--- Attachment: report.md ---\nembedded prompt",
      ),
    ).toBe("Summarize");
  });

  it("keeps deterministic fallback limited to the current user query", () => {
    expect(
      buildWebSearchQuery([
        { role: "user", content: "今天天气怎么样" },
        { role: "assistant", content: "请问哪个城市？" },
        { role: "user", content: "广州南沙" },
      ]),
    ).toBe("广州南沙");

    expect(
      buildWebSearchQuery([{ role: "user", content: "广州南沙天气如何" }]),
    ).toBe("广州南沙天气如何");

    expect(
      buildWebSearchQuery([
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好！" },
        { role: "user", content: "广州南沙" },
      ]),
    ).toBe("广州南沙");
  });

  it("attributes a globally deduped URL only to the facet that kept it", () => {
    const summaries = summarizeSelectedEvidence(
      ["甲 原因", "乙 原因"],
      [{
        title: "共同报道",
        url: "https://news.example/shared",
        snippet: "s",
        searchQuery: "甲 原因",
      }],
    );
    expect(summaries.map((summary) => summary.coverage)).toEqual(["covered", "missing"]);
  });

  it("grounded hint forbids channel-list answers", () => {
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("推荐查询渠道");
    expect(WEB_SEARCH_SYSTEM_HINT).toMatch(/禁止声称无法联网|仍禁止声称无法联网/);
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("可核验事实");
  });

  it("grounded hint forbids ending with 'please visit the site yourself'", () => {
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("建议直接访问某网站获取详情");
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("而不是让用户自己去查");
  });

  it("grounded hint requires handling stale publishedAt", () => {
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("发布时间");
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("多实体须逐项取证");
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("风评转变");
  });

  it("grounded hint scopes [N] to current turn and allows off-topic escape", () => {
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("仅对应本轮搜索结果");
    expect(WEB_SEARCH_SYSTEM_HINT).toContain("与问题无关");
    const msgs = withSearchContext(
      [{ role: "user", content: "q" }],
      [{ title: "T", url: "https://example.com", snippet: "s" }],
    );
    const system = String(msgs[0]?.content);
    expect(system).toContain("仅对应本轮搜索结果");
    expect(system).toContain("与问题无关");
  });

  it("compactHitsForModel preserves publishedAt", () => {
    const compacted = compactHitsForModel([
      {
        title: "t",
        url: "https://a",
        snippet: "s",
        publishedAt: "2026-08-02T00:00:00+08:00",
      },
    ]);
    expect(compacted[0]?.publishedAt).toBe("2026-08-02T00:00:00+08:00");
  });

  it("injects search hits into system context without tools", () => {
    const hits: WebSearchHit[] = [{ title: "T", url: "https://example.com", snippet: "s" }];
    const msgs = withSearchContext([{ role: "user", content: "q" }], hits);
    expect(msgs[0]?.role).toBe("system");
    expect(String(msgs[0]?.content)).toContain("https://example.com");
    expect(String(msgs[0]?.content)).toContain("禁止输出任何工具调用");
    expect(String(msgs[0]?.content)).toContain("推荐查询渠道");
  });

  it("reads a glued arXiv URL directly without spending a provider call", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return sseResponse('data: {"choices":[{"delta":{"content":"可以读懂 [1]"}}]}\n\ndata: [DONE]\n\n');
    });
    const executeSearch = vi.fn(async () => []);
    const readPage = vi.fn(async (reference): Promise<DirectPageView> => ({
      reference,
      title: "Paper title",
      text: "Paper title\n\nAbstract evidence\n\nIntroduction evidence\n\nLate appendix",
      rawChars: 80,
      coverage: "full_html",
      backend: "native",
    }));

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "你好" },
          { role: "assistant", content: "你好" },
          {
            role: "user",
            content: "https://arxiv.org/pdf/2606.19348你能读懂这篇文章嘛?",
          },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
        readPage,
      },
      {
        preparedSearchPlan: {
          query: "read arXiv 2606.19348",
          needSearch: true,
          searchQueries: ["arXiv 2606.19348"],
          calculationIntent: "uncertain" as const,
          confidence: 0.98,
          source: "auto-route",
        },
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(readPage.mock.calls[0]?.[0]).toMatchObject({
      readUrl: "https://arxiv.org/html/2606.19348",
      question: "你能读懂这篇文章嘛?",
    });
    expect(answerBodies(bodies)).toHaveLength(1);
    expect(JSON.stringify(answerBody(bodies))).toContain("网页直读状态");
    expect(JSON.stringify(bodies[0])).toContain("Abstract evidence");
    const text = await response.text();
    expect(text).toContain('"reason":"direct_page_html"');
    expect(text).toContain('"providerCalls":0');
  });

  it("uses the existing contextual rewrite and BM25 passage ranker for a follow-up", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      bodies.push(body);
      const headers = new Headers(init?.headers);
      if (headers.get("x-agenticx-trace-stage") === "chat.search-query-rewrite") {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  need_search: true,
                  resolved_query: "Table 8 Pass Rate",
                  search_queries: ["Table 8 Pass Rate"],
                  confidence: 0.99,
                }),
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"80% [1]"}}]}\n\ndata: [DONE]\n\n');
    });
    const executeSearch = vi.fn(async () => []);
    const readPage = vi.fn(async (reference): Promise<DirectPageView> => ({
      reference,
      title: "Paper title",
      text: [
        "Paper title and abstract.",
        "Introduction and background.",
        "Method details.",
        "Table 8 Pass Rate Internal Engineers 80 percent.",
      ].join("\n\n"),
      rawChars: 140,
      coverage: "full_html",
      backend: "native",
    }));

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "https://arxiv.org/pdf/2606.19348 读一下" },
          { role: "assistant", content: "已阅读摘要，其中还有 Table 8。" },
          { role: "user", content: "这张表的通过率是什么？" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
        readPage,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    expect(readPage).toHaveBeenCalledTimes(1);
    expect(answerBodies(bodies)).toHaveLength(1);
    expect(JSON.stringify(answerBody(bodies))).toContain(
      "Table 8 Pass Rate Internal Engineers 80 percent",
    );
  });

  it("expands a weak cross-language document hit before answering", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      bodies.push(body);
      const headers = new Headers(init?.headers);
      if (headers.get("x-agenticx-trace-stage") === "chat.search-query-rewrite") {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  need_search: true,
                  resolved_query: "注意力机制细节和评测数据",
                  search_queries: [
                    "hybrid attention mechanism details",
                    "evaluation results benchmark figures",
                  ],
                  confidence: 0.99,
                }),
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"已找到相关正文 [1]"}}]}\n\ndata: [DONE]\n\n');
    });
    const executeSearch = vi.fn(async () => []);
    const readPage = vi.fn(async (reference): Promise<DirectPageView> => ({
      reference,
      title: "Efficient Long Context Models",
      text: [
        "Cited by: Figure 8.",
        "The hybrid attention mechanism combines compressed sparse attention with heavily compressed attention for efficient long contexts.",
        "Evaluation results compare model quality, inference efficiency, and long-context benchmark performance across several settings and figures.",
      ].join("\n\n"),
      rawChars: 300,
      coverage: "full_html",
      backend: "native",
    }));

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "https://example.com/paper 读一下" },
          { role: "assistant", content: "已读取摘要。" },
          {
            role: "user",
            content: "我对注意力机制细节和评测数据感兴趣，结合 figure 解读",
          },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
          maxSearchCalls: 3,
        }),
        executeSearch,
        readPage,
      },
    );

    expect(readPage).toHaveBeenCalledTimes(1);
    expect(executeSearch).not.toHaveBeenCalled();
    expect(answerBodies(bodies)).toHaveLength(1);
    expect(JSON.stringify(preflightBodies(bodies)[0])).toContain("target_document");
    expect(JSON.stringify(bodies[1])).toContain("hybrid attention mechanism");
    expect(JSON.stringify(bodies[1])).toContain("Evaluation results compare model quality");
    const text = await response.text();
    expect(text).toContain('"reason":"direct_page_html"');
    expect(text).toContain('"providerCalls":0');
  });

  it("reads a matching historical document before contextual query rewrite", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return sseResponse('data: {"choices":[{"delta":{"content":"Figure 11 compares win rates [1]"}}]}\n\ndata: [DONE]\n\n');
    });
    const executeSearch = vi.fn(async () => []);
    const readPage = vi.fn(async (reference): Promise<DirectPageView> => ({
      reference,
      title: "Paper title",
      text: [
        "Paper title and abstract.",
        "Introduction and background.",
        "Figure 11: Win-rate comparison across analysis, generation, and editing tasks.",
      ].join("\n\n"),
      rawChars: 160,
      coverage: "full_html",
      backend: "native",
    }));

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "https://arxiv.org/pdf/2606.19348 读一下" },
          { role: "assistant", content: "已阅读摘要" },
          { role: "user", content: "Figure 11 讲了什么？" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
        readPage,
      },
    );

    expect(readPage).toHaveBeenCalledTimes(1);
    expect(executeSearch).not.toHaveBeenCalled();
    expect(answerBodies(bodies)).toHaveLength(1);
    expect(JSON.stringify(answerBody(bodies))).toContain("Figure 11: Win-rate comparison");
    const text = await response.text();
    expect(text).toContain('"reason":"direct_page_html"');
    expect(text).toContain('"queryResolutionMs":0');
  });

  it("strictly filters arXiv fallback search and uses the alternate provider", async () => {
    const attempted: string[] = [];
    const executeSearch = vi.fn(async (
      query: string,
      _max: number | undefined,
      cfg: ExecuteSearchConfig,
    ) => {
      attempted.push(String(cfg.primaryProviderId));
      expect(query).toBe("arXiv 2606.19348");
      if (cfg.primaryProviderId === "primary") {
        return [{ title: "Noise", url: "https://arxiv.org/abs/2606.19349", snippet: "wrong" }];
      }
      return [
        {
          title: "Exact paper",
          url: "https://arxiv.org/abs/2606.19348v1",
          snippet: "exact abstract",
        },
      ];
    });
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"choices":[{"delta":{"content":"fallback [1]"}}]}\n\ndata: [DONE]\n\n'),
    );

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "https://arxiv.org/pdf/2606.19348 帮我读" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "a",
          maxResults: 50,
          calculatorEnabled: true,
          maxSearchCalls: 2,
          providers: [
            { id: "primary", adapter: "bocha", displayName: "P", apiKey: "a", enabled: true, priority: 0 },
            { id: "secondary", adapter: "tavily", displayName: "S", apiKey: "b", enabled: true, priority: 1 },
          ],
        }),
        executeSearch,
        readPage: vi.fn(async () => null),
      },
    );

    expect(attempted).toEqual(["primary", "secondary"]);
    const text = await response.text();
    expect(text).toContain("https://arxiv.org/abs/2606.19348v1");
    expect(text).not.toContain("2606.19349");
  });

  it("discloses a short dynamic page and constrains the search fallback", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"基于搜索结果回答 [1]"}}]}\n\ndata: [DONE]\n\n',
      );
    });
    const executeSearch = vi.fn(async () => [
      {
        title: "可核验结果",
        url: "https://search.example/result",
        snippet: "搜索结果正文摘要",
      },
    ]);
    const readPage = vi.fn(
      async (
        _reference: Parameters<typeof readDirectPage>[0],
        options: Parameters<typeof readDirectPage>[1],
      ) => {
        options?.onFailure?.("too_short");
        return null;
      },
    );

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          {
            role: "user",
            content: "https://example.com/dynamic 帮我总结这个页面",
          },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
        readPage,
      },
    );

    expect(readPage).toHaveBeenCalledTimes(1);
    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(answerBodies(bodies)).toHaveLength(1);
    const gatewayBody = JSON.stringify(answerBody(bodies));
    expect(gatewayBody).toContain("正文未能完整提取");
    expect(gatewayBody).toContain("不得声称已打开、通读或直接读取该页面");

    const text = await response.text();
    expect(text).toContain("该页面可能依赖动态渲染或限制自动访问");
    expect(text).toContain("agenticx_web_search_sources");
    expect(text).toContain("https://search.example/result");
  });

  it("runs server-side search first and strips agenticx_web_search / tools on final stream", async () => {
    const bodies: Array<{ stream?: unknown }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse('data: {"choices":[{"delta":{"content":"基于检索的回答 [1]"}}]}\n\ndata: [DONE]\n\n');
    });

    const hits: WebSearchHit[] = [{ title: "Opus", url: "https://news.example/opus", snippet: "latest" }];
    const executeSearch = vi.fn(async (query: string) => {
      expect(query).toContain("opus");
      return hits;
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        // Include optimistic empty assistant — must not be forwarded to Moonshot-class upstreams.
        messages: [
          { role: "user", content: "搜一下关于opus 5.0的信息" },
          { role: "assistant", content: "" },
        ],
        agenticx_web_search: true,
        tools: [{ type: "function", function: { name: "web_search" } }],
        tool_choice: "auto",
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({ enabled: true, provider: "duckduckgo", apiKey: "", maxResults: 5 }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(answerBodies(bodies)).toHaveLength(1);
    const finalBody = answerBody(bodies) as {
      agenticx_web_search?: unknown;
      tools?: unknown;
      tool_choice?: unknown;
      stream?: boolean;
      messages?: Array<{ role?: string; content?: string }>;
    };
    expect(finalBody.agenticx_web_search).toBeUndefined();
    expect(finalBody.tools).toBeUndefined();
    expect(finalBody.tool_choice).toBeUndefined();
    expect(finalBody.stream).toBe(true);
    expect(finalBody.messages?.[0]?.content).toContain("当前时间");
    expect(finalBody.messages?.[0]?.content).toContain("联网搜索结果");
    expect(finalBody.messages?.some((m) => m.role === "assistant" && !String(m.content ?? "").trim())).toBe(
      false,
    );

    const text = await readText(res);
    expect(text).toContain("基于检索的回答");
    expect(text).toContain("agenticx_web_search_sources");
    expect(text).toContain("https://news.example/opus");
    expect(text.includes("**来源**")).toBe(false);
    expect(text.includes("minimax:tool_call")).toBe(false);
  });

  it("complements extremely sparse evidence with a different configured provider", async () => {
    const searched: Array<{ query: string; providerId?: string }> = [];
    const executeSearch = vi.fn(async (
      query: string,
      _max: number | undefined,
      cfg: ExecuteSearchConfig,
    ) => {
      searched.push({ query, providerId: cfg.primaryProviderId });
      if (cfg.primaryProviderId === "tenant-primary") {
        return [{ title: "Primary", url: "https://one.example/a", snippet: "one" }];
      }
      return [
        { title: "Second A", url: "https://two.example/a", snippet: "two" },
        { title: "Second B", url: "https://three.example/b", snippet: "three" },
      ];
    });
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
    );

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "查询今天最新行业动态" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "primary-key",
          maxResults: 50,
          calculatorEnabled: true,
          providers: [
            {
              id: "tenant-primary",
              adapter: "bocha",
              displayName: "Primary",
              apiKey: "primary-key",
              enabled: true,
              priority: 0,
            },
            {
              id: "tenant-secondary",
              adapter: "tavily",
              displayName: "Secondary",
              apiKey: "secondary-key",
              enabled: true,
              priority: 1,
            },
          ],
        }),
        executeSearch,
      },
    );

    expect(searched).toEqual([
      { query: "查询今天最新行业动态", providerId: "tenant-primary" },
      { query: "查询今天最新行业动态", providerId: "tenant-secondary" },
    ]);
    const text = await response.text();
    expect(text).toContain("https://one.example/a");
    expect(text).toContain("https://two.example/a");
  });

  it("does not complement evidence that already has source diversity", async () => {
    const executeSearch = vi.fn(async () => [
      { title: "A", url: "https://one.example/a", snippet: "one" },
      { title: "B", url: "https://two.example/b", snippet: "two" },
    ]);
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
    );

    await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "查询最新消息" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "primary-key",
          maxResults: 50,
          calculatorEnabled: true,
          providers: [
            {
              id: "tenant-primary",
              adapter: "bocha",
              displayName: "Primary",
              apiKey: "primary-key",
              enabled: true,
              priority: 0,
            },
            {
              id: "tenant-secondary",
              adapter: "tavily",
              displayName: "Secondary",
              apiKey: "secondary-key",
              enabled: true,
              priority: 1,
            },
          ],
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
  });

  it("tries at most one different configured provider after primary failure", async () => {
    const attempted: string[] = [];
    const executeSearch = vi.fn(async (
      _query: string,
      _max: number | undefined,
      cfg: ExecuteSearchConfig,
    ) => {
      attempted.push(String(cfg.primaryProviderId));
      throw new Error("provider unavailable");
    });
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"choices":[{"delta":{"content":"degraded"}}]}\n\ndata: [DONE]\n\n'),
    );

    await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "查询最新消息" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "primary-key",
          maxResults: 50,
          calculatorEnabled: true,
          providers: [
            {
              id: "provider-a",
              adapter: "bocha",
              displayName: "A",
              apiKey: "a",
              enabled: true,
              priority: 0,
            },
            {
              id: "provider-b",
              adapter: "tavily",
              displayName: "B",
              apiKey: "b",
              enabled: true,
              priority: 1,
            },
            {
              id: "provider-c",
              adapter: "duckduckgo",
              displayName: "C",
              apiKey: "",
              enabled: true,
              priority: 2,
            },
          ],
        }),
        executeSearch,
      },
    );

    expect(attempted).toEqual(["provider-a", "provider-b"]);
  });

  it("skips web search for pure current-date questions and grounds on local clock", async () => {
    const bodies: unknown[] = [];
    const executeSearch = vi.fn(async () => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"今天是2026年8月1日"}}]}\n\ndata: [DONE]\n\n',
      );
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "今天几号啊" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    const body = bodies[0] as { messages?: Array<{ role?: string; content?: string }> };
    expect(body.messages?.[0]?.role).toBe("system");
    expect(String(body.messages?.[0]?.content)).toContain("当前时间");
    expect(String(body.messages?.[0]?.content)).toContain("本轮说明");
    expect(String(body.messages?.[0]?.content)).not.toContain("联网搜索结果");
    const text = await readText(res);
    expect(text).toContain("今天是2026年8月1日");
    expect(text).not.toContain("agenticx_web_search_sources");
  });

  it("searches ordinary work requests in main-aligned auto mode", async () => {
    const bodies: unknown[] = [];
    const executeSearch = vi.fn(async (_query: string) => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse('data: {"choices":[{"delta":{"content":"邮件草稿"}}]}\n\ndata: [DONE]\n\n');
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "帮我写一封请假邮件" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch.mock.calls[0]?.[0]).toBe("帮我写一封请假邮件");
    const body = bodies[0] as { messages?: Array<{ role?: string; content?: string }> };
    expect(String(body.messages?.[0]?.content)).not.toContain("联网搜索结果");
    const text = await readText(res);
    expect(text).toContain("联网搜索暂不可用");
    expect(text).toContain("邮件草稿");
  });

  it("keeps the shared capability context on capability-like search turns", async () => {
    const bodies: unknown[] = [];
    const executeSearch = vi.fn(async (_query: string) => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse('data: {"choices":[{"delta":{"content":"支持联网搜索"}}]}\n\ndata: [DONE]\n\n');
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "现在有联网功能吗" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch.mock.calls[0]?.[0]).toBe("现在有联网功能吗");
    const body = bodies[0] as { messages?: Array<{ role?: string; content?: string }> };
    expect(String(body.messages?.[0]?.content)).toContain("和创智派能力说明");
    expect(await readText(res)).toContain("联网搜索暂不可用");
  });

  it("does not search when tenant enabled=false", async () => {
    const bodies: unknown[] = [];
    const executeSearch = vi.fn(async () => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse('data: {"choices":[{"delta":{"content":"plain"}}]}\n\ndata: [DONE]\n\n');
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({ enabled: false, provider: "duckduckgo", apiKey: "", maxResults: 5 }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    const first = bodies[0] as { tools?: unknown; stream?: boolean };
    expect(first.tools).toBeUndefined();
    expect(first.stream).toBe(true);
    const text = await readText(res);
    expect(text).toContain("管理员已关闭联网搜索");
    expect(text).toContain("plain");
  });

  it("degrades to direct stream when search throws", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { tools?: unknown; stream?: boolean };
      expect(body.tools).toBeUndefined();
      expect(body.stream).toBe(true);
      return sseResponse('data: {"choices":[{"delta":{"content":"fallback"}}]}\n\ndata: [DONE]\n\n');
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        // Informational query — greetings like "hi" now skip search-first entirely.
        messages: [{ role: "user", content: "最新的 AI 新闻" }],
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({ enabled: true, provider: "duckduckgo", apiKey: "", maxResults: 5 }),
        executeSearch: async () => {
          throw new Error("ddg timeout via proxy");
        },
      },
    );

    const text = await readText(res);
    expect(text).toContain("联网搜索暂不可用");
    expect(text).toContain("fallback");
  });

  it("searches with contextual query when user fills a slot across turns", async () => {
    const executeSearch = vi.fn(async (q: string) => [
      { title: "南沙天气", url: "https://weather.example/nansha", snippet: "气温 24~30℃" },
    ]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: '{"resolved_query":"广州南沙 今天天气","confidence":0.98}',
              },
            },
          ],
        });
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"南沙今天大雨"}}]}\n\ndata: [DONE]\n\n',
      );
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "今天天气怎么样" },
          { role: "assistant", content: "请问哪个城市？" },
          { role: "user", content: "广州南沙" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch.mock.calls[0]?.[0]).toBe("广州南沙 今天天气");
    // Query rewrite, calculation planning, answer. The middle one is the cost
    // of the calculator: this snippet states 24 and 30, so a calculation is
    // possible and the model is asked. It declines, and nothing is injected.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("skips web search for greetings", async () => {
    const bodies: unknown[] = [];
    const executeSearch = vi.fn(async () => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"你好！有什么可以帮你的？"}}]}\n\ndata: [DONE]\n\n',
      );
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "你好" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    const body = bodies[0] as { messages?: Array<{ role?: string; content?: string }> };
    const system = String(body.messages?.[0]?.content);
    expect(system).toContain("当前时间");
    expect(system).toContain("本轮说明");
    expect(system).toContain("不要提及工具、功能调用");
    expect(system).not.toContain("联网搜索结果");
    const text = await readText(res);
    expect(text).toContain("你好！有什么可以帮你的？");
    expect(text).not.toContain("agenticx_web_search_sources");
  });

  it("still searches for informational queries", async () => {
    const executeSearch = vi.fn(async () => [
      { title: "AI News", url: "https://news.example/ai", snippet: "latest" },
    ]);
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"choices":[{"delta":{"content":"基于检索"}}]}\n\ndata: [DONE]\n\n'),
    );

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "最新的 AI 新闻" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    const text = await readText(res);
    expect(text).toContain("agenticx_web_search_sources");
    expect(text).toContain("https://news.example/ai");
  });

  it.each([
    "AGENTICX_WEB_SEARCH_BYPASS_FAST_SKIP",
    "AGENTICX_WEB_SEARCH_ALWAYS",
  ])("%s bypasses the deterministic greeting skip", async (envName) => {
    vi.stubEnv("AGENTICX_WEB_SEARCH_BYPASS_FAST_SKIP", "");
    vi.stubEnv("AGENTICX_WEB_SEARCH_ALWAYS", "");
    vi.stubEnv(envName, "1");
    try {
      const executeSearch = vi.fn(async () => [
        { title: "Hello", url: "https://ex.com/hi", snippet: "greeting" },
      ]);
      const fetchImpl = vi.fn(async () =>
        sseResponse('data: {"choices":[{"delta":{"content":"forced"}}]}\n\ndata: [DONE]\n\n'),
      );

      const res = await runWebSearchTurn(
        {
          model: "m",
          messages: [{ role: "user", content: "你好" }],
          agenticx_web_search: true,
        },
        {
          url: "http://gateway.test/v1/chat/completions",
          headers: { authorization: "Bearer t" },
          fetchImpl: fetchImpl as unknown as typeof fetch,
          loadTenantConfig: async () => ({
            enabled: true,
            provider: "duckduckgo",
            apiKey: "",
            maxResults: 5,
            calculatorEnabled: true,
          }),
          executeSearch,
        },
      );

      expect(executeSearch).toHaveBeenCalledTimes(1);
      const text = await readText(res);
      expect(text).toContain("agenticx_web_search_sources");
      expect(text).toContain("forced");
      expect(text).toContain('"reason":"fast_skip_bypassed"');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("warns once when the fast-skip bypass is enabled in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENTICX_WEB_SEARCH_BYPASS_FAST_SKIP", "1");
    vi.stubEnv("AGENTICX_WEB_SEARCH_ALWAYS", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const executeSearch = vi.fn(async () => [
        { title: "Hello", url: "https://ex.com/hi", snippet: "greeting" },
      ]);
      const fetchImpl = vi.fn(async () =>
        sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'),
      );
      const run = () => runWebSearchTurn(
        {
          model: "m",
          messages: [{ role: "user", content: "你好" }],
          agenticx_web_search: true,
        },
        {
          url: "http://gateway.test/v1/chat/completions",
          headers: {},
          fetchImpl: fetchImpl as unknown as typeof fetch,
          loadTenantConfig: async () => ({
            enabled: true,
            provider: "duckduckgo",
            apiKey: "",
            maxResults: 5,
            calculatorEnabled: true,
          }),
          executeSearch,
        },
      );

      await (await run()).text();
      await (await run()).text();

      const productionWarnings = warn.mock.calls.filter((args) =>
        String(args[0]).includes("enabled in production"),
      );
      expect(productionWarnings).toHaveLength(1);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("returns JSON 503 when gateway fetch throws after successful search (not search-degrade)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "给个个人介绍模板" }],
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({ enabled: true, provider: "duckduckgo", apiKey: "", maxResults: 5 }),
        executeSearch: async () => [{ title: "T", url: "https://ex.com", snippet: "s" }],
      },
    );

    expect(res.status).toBe(503);
    const payload = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(payload.error?.code).toBe("50301");
    expect(payload.error?.message).toContain("Gateway 不可用");
    expect(payload.error?.message).toContain("ECONNREFUSED");
  });

  it("emits SSE error after sources when upstream body read fails (no hard-close)", async () => {
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("socket hang up"));
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
    const hits: WebSearchHit[] = [{ title: "T", url: "https://ex.com", snippet: "s" }];
    const res = await pipeUpstreamSse(upstream, {
      sourcesFrame: `data: ${JSON.stringify({ agenticx_web_search_sources: hits })}\n\n`,
    });
    expect(res.status).toBe(200);
    const text = await readText(res);
    expect(text).toContain("agenticx_web_search_sources");
    expect(text).toContain("聊天流式连接中断");
    expect(text).toContain("socket hang up");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("emits SSE error after sources when upstream HTTP fails", async () => {
    const upstream = new Response(JSON.stringify({ error: { message: "network error" } }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
    const hits: WebSearchHit[] = [{ title: "T", url: "https://ex.com", snippet: "s" }];
    const res = await pipeUpstreamSse(upstream, {
      sourcesFrame: `data: ${JSON.stringify({ agenticx_web_search_sources: hits })}\n\n`,
    });
    expect(res.status).toBe(200);
    const text = await readText(res);
    expect(text).toContain("agenticx_web_search_sources");
    expect(text).toContain("模型回答失败");
    expect(text).toContain("network error");
    expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("compacts long snippets before model injection", () => {
    const long = "字".repeat(WEB_SEARCH_CONTEXT_SNIPPET_CHARS + 80);
    const compacted = compactHitsForModel([{ title: "T", url: "https://ex.com", snippet: long }]);
    expect(compacted[0]?.snippet.length).toBeLessThanOrEqual(WEB_SEARCH_CONTEXT_SNIPPET_CHARS);
  });

  it("injects more than 10 hits for large-context models (AC-5)", async () => {
    const bodies: Array<{ stream?: boolean; messages?: Array<{ role?: string; content?: string | null }> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    const hits: WebSearchHit[] = Array.from({ length: 30 }, (_, i) => ({
      title: `Hit ${i + 1}`,
      url: `https://ex.com/${i + 1}`,
      snippet: `snippet ${i + 1} 字`.repeat(20),
    }));
    const executeSearch = vi.fn(async () => hits);

    await runWebSearchTurn(
      {
        model: "glm-5.2",
        messages: [{ role: "user", content: "英伟达最新财报摘要" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    const system = String(answerBody(bodies)?.messages?.[0]?.content ?? "");
    const injectedCount = (system.match(/^\[\d+\] /gm) ?? []).length;
    expect(injectedCount).toBeGreaterThan(10);
  });

  it("keeps SSE source order aligned with model injection indices (AC-6)", async () => {
    const bodies: Array<{ stream?: boolean; messages?: Array<{ role?: string; content?: string | null }> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    const hits: WebSearchHit[] = Array.from({ length: 20 }, (_, i) => ({
      title: `Hit ${i + 1}`,
      url: `https://ex.com/${i + 1}`,
      snippet: `snippet ${i + 1}`,
    }));
    // Put the most relevant hits at the end so rerank must promote them.
    hits[18] = {
      title: "广州南沙今日天气",
      url: "https://ex.com/weather-a",
      snippet: "南沙天气 气温 湿度 风力",
    };
    hits[19] = {
      title: "南沙天气预报",
      url: "https://ex.com/weather-b",
      snippet: "南沙 天气 降水",
    };
    const executeSearch = vi.fn(async () => hits);

    const res = await runWebSearchTurn(
      {
        model: "glm-5.2",
        messages: [{ role: "user", content: "广州南沙天气如何" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    const system = String(answerBody(bodies)?.messages?.[0]?.content ?? "");
    const injectedUrls = [...system.matchAll(/^URL: (https:\/\/\S+)/gm)].map((m) => m[1]!);
    expect(injectedUrls.length).toBeGreaterThan(0);

    const text = await readText(res);
    const sourcesLine = text
      .split("\n")
      .find((line) => line.includes("agenticx_web_search_sources"));
    expect(sourcesLine).toBeTruthy();
    const payload = JSON.parse(sourcesLine!.replace(/^data:\s*/, "")) as {
      agenticx_web_search_sources: Array<{ url: string; usedByModel?: boolean }>;
    };
    const sources = payload.agenticx_web_search_sources;
    const k = injectedUrls.length;
    expect(sources.slice(0, k).map((s) => s.url)).toEqual(injectedUrls);
    expect(sources.slice(0, k).every((s) => s.usedByModel === true)).toBe(true);
    expect(sources.slice(k).every((s) => s.usedByModel === false)).toBe(true);
    expect(sources.length).toBe(hits.length);
  });

  it("lets the rewrite agent complete a contextual search query", async () => {
    const executeSearch = vi.fn(async (q: string) => [
      { title: "宗主梗", url: "https://ex.com/zongzhu", snippet: "蔡徐坤 宗主" },
    ]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: '{"resolved_query":"蔡徐坤 为什么被封为宗主呢","confidence":0.98}',
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"答"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "你认识宗主吗" },
          { role: "assistant", content: '百科式回答。' },
          { role: "user", content: "我说的是最近比较活人的宗主" },
          {
            role: "assistant",
            content: '根据搜索结果，最近活跃的应该是指**蔡徐坤**。[8]',
          },
          { role: "user", content: "他为什么被封为宗主呢" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch.mock.calls[0]?.[0]).toBe("蔡徐坤 为什么被封为宗主呢");
  });

  it("uses a semantic no-search decision for natural-language arithmetic", async () => {
    const bodies: Array<{ stream?: boolean; messages?: Array<{ content?: string }> }> = [];
    const executeSearch = vi.fn(async () => [
      { title: "不应搜索", url: "https://example.com/no", snippet: "no" },
    ]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ content?: string }>;
      };
      bodies.push(body);
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content:
                  '{"need_search":false,"resolved_query":"1+1 等于几","search_queries":[],"confidence":0.99}',
              },
            },
          ],
        });
      }
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"1+1=2"}}]}\n\ndata: [DONE]\n\n',
      );
    });

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "我们刚才在聊数学家" },
          { role: "assistant", content: "是的。" },
          { role: "user", content: "但是我想知道 1+1 的等于几" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    expect(answerBodies(bodies)).toHaveLength(1);
    expect(String(answerBody(bodies)?.messages?.[0]?.content)).toContain("本轮说明");
    const text = await response.text();
    expect(text).toContain("1+1=2");
    expect(text).not.toContain("agenticx_web_search_sources");
  });

  it("searches independent entity facets and preserves both in answer context", async () => {
    const searched: Array<{ query: string; max?: number }> = [];
    const bodies: Array<{
      stream?: boolean;
      messages?: Array<{ role?: string; content?: string }>;
    }> = [];
    const executeSearch = vi.fn(async (query: string, max?: number) => {
      searched.push({ query, max });
      if (query.startsWith("王虹")) {
        return [{ title: "王虹经历", url: "https://wang.example/leave", snippet: "王虹 北大" }];
      }
      return [{ title: "邓煜经历", url: "https://deng.example/leave", snippet: "邓煜 北大" }];
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ role?: string; content?: string }>;
      };
      bodies.push(body);
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  need_search: true,
                  resolved_query: "王虹和邓煜为什么分别离开北京大学",
                  search_queries: [
                    "王虹 离开北京大学 原因",
                    "邓煜 离开北京大学 原因",
                  ],
                  confidence: 0.99,
                }),
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"分别说明"}}]}\n\ndata: [DONE]\n\n');
    });

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "王虹和邓煜都获得了数学奖项" },
          { role: "assistant", content: "两人都有北京大学求学经历。" },
          { role: "user", content: "他们两个人为什么都从北大离开了？" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(searched).toEqual([
      { query: "王虹 离开北京大学 原因", max: 25 },
      { query: "邓煜 离开北京大学 原因", max: 25 },
    ]);
    const system = String(bodies.find((body) => body.stream === true)?.messages?.[0]?.content);
    expect(system).toContain("检索子问题: 王虹 离开北京大学 原因");
    expect(system).toContain("检索子问题: 邓煜 离开北京大学 原因");
    expect(system).toContain("证据覆盖提醒");
    expect(system).toContain("正文验证可比时间状态");
    const text = await response.text();
    expect(text).toContain("https://wang.example/leave");
    expect(text).toContain("https://deng.example/leave");
    expect(text).toContain("agenticx_web_search_trace");
    expect(text).toContain('"providerCalls":2');
    expect(text).toContain('"providerIds":["duckduckgo"]');
    expect(text).toContain('"resolvedQuery":"王虹和邓煜为什么分别离开北京大学"');
  });

  it("shares one retry across two facets and caps provider calls at three", async () => {
    const attempted: Array<{ query: string; providerId?: string }> = [];
    const executeSearch = vi.fn(async (
      query: string,
      _max: number | undefined,
      cfg: ExecuteSearchConfig,
    ) => {
      attempted.push({ query, providerId: cfg.primaryProviderId });
      if (cfg.primaryProviderId === "secondary") {
        return [{ title: "补充证据", url: "https://fallback.example/a", snippet: query }];
      }
      return [];
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  need_search: true,
                  resolved_query: "甲和乙的离职原因",
                  search_queries: ["甲 离职 原因", "乙 离职 原因"],
                  confidence: 0.99,
                }),
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "甲和乙曾经在同一家公司" },
          { role: "assistant", content: "是的。" },
          { role: "user", content: "他们为什么离职？" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "primary-key",
          maxResults: 50,
          calculatorEnabled: true,
          providers: [
            {
              id: "primary",
              adapter: "bocha",
              displayName: "Primary",
              apiKey: "primary-key",
              enabled: true,
              priority: 0,
            },
            {
              id: "secondary",
              adapter: "tavily",
              displayName: "Secondary",
              apiKey: "secondary-key",
              enabled: true,
              priority: 1,
            },
          ],
        }),
        executeSearch,
      },
    );

    expect(attempted).toEqual([
      { query: "甲 离职 原因", providerId: "primary" },
      { query: "乙 离职 原因", providerId: "primary" },
      { query: "甲 离职 原因", providerId: "secondary" },
    ]);
    const text = await response.text();
    expect(text).toContain('"providerCalls":3');
    expect(text).toContain('"fromProviderId":"primary"');
    expect(text).toContain('"toProviderId":"secondary"');
    expect(text).toContain('"providerIds":["primary","secondary"]');
  });

  it("gates the primary and the failover call through the tenant daily quota", async () => {
    const executeSearch = vi.fn(
      async (
        query: string,
        _max: number | undefined,
        cfg: ExecuteSearchConfig,
        _fetchImpl?: typeof fetch,
        diagnostics?: { beforeProviderAttempt?: (providerId: string) => void | Promise<void> },
      ) => {
        await diagnostics?.beforeProviderAttempt?.(cfg.primaryProviderId ?? "primary");
        if (cfg.primaryProviderId === "secondary") {
          return [{ title: "补充证据", url: "https://fallback.example/a", snippet: query }];
        }
        return [];
      },
    );
    const reserveProviderCall = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ need_search: false }) } }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "2026 年 8 月 AI 监管新规有哪些" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "primary-key",
          maxResults: 50,
          calculatorEnabled: true,
          providers: [
            {
              id: "primary",
              adapter: "bocha",
              displayName: "Primary",
              apiKey: "primary-key",
              enabled: true,
              priority: 0,
            },
            {
              id: "secondary",
              adapter: "tavily",
              displayName: "Secondary",
              apiKey: "secondary-key",
              enabled: true,
              priority: 1,
            },
          ],
        }),
        executeSearch: executeSearch as unknown as typeof executeWebSearch,
        reserveProviderCall,
      },
    );

    // Primary attempt plus the failover attempt each reserve one call.
    expect(reserveProviderCall).toHaveBeenCalledTimes(2);
  });

  it("stops the turn instead of answering unsearched once the daily quota is gone", async () => {
    const executeSearch = vi.fn(
      async (
        _query: string,
        _max: number | undefined,
        cfg: ExecuteSearchConfig,
        _fetchImpl?: typeof fetch,
        diagnostics?: { beforeProviderAttempt?: (providerId: string) => void | Promise<void> },
      ) => {
        await diagnostics?.beforeProviderAttempt?.(cfg.primaryProviderId ?? "primary");
        return [];
      },
    );
    const reserveProviderCall = vi.fn(async () => {
      throw new TenantDailySearchProviderQuotaError("exhausted");
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ need_search: false }) } }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    await expect(
      runWebSearchTurn(
        {
          model: "m",
          messages: [{ role: "user", content: "2026 年 8 月 AI 监管新规有哪些" }],
          agenticx_web_search: true,
        },
        {
          url: "http://gateway.test/v1/chat/completions",
          headers: {},
          fetchImpl: fetchImpl as unknown as typeof fetch,
          loadTenantConfig: async () => ({
            enabled: true,
            provider: "bocha",
            apiKey: "primary-key",
            maxResults: 50,
            calculatorEnabled: true,
            providers: [
              {
                id: "primary",
                adapter: "bocha",
                displayName: "Primary",
                apiKey: "primary-key",
                enabled: true,
                priority: 0,
              },
              {
                id: "secondary",
                adapter: "tavily",
                displayName: "Secondary",
                apiKey: "secondary-key",
                enabled: true,
                priority: 1,
              },
            ],
          }),
          executeSearch: executeSearch as unknown as typeof executeWebSearch,
          reserveProviderCall,
        },
      ),
    ).rejects.toSatisfy(isTenantDailySearchProviderQuotaExceeded);

    // The failover attempt is never made once the gate is closed.
    expect(reserveProviderCall).toHaveBeenCalledTimes(1);
  });

  it("uses one- and two-call budgets without adding a fallback retry", async () => {
    const runWithBudget = async (maxSearchCalls: number) => {
      const attempted: Array<{ query: string; providerId?: string }> = [];
      const executeSearch = vi.fn(async (
        query: string,
        _max: number | undefined,
        cfg: ExecuteSearchConfig,
      ) => {
        attempted.push({ query, providerId: cfg.primaryProviderId });
        return [];
      });
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
        if (body.stream === false) {
          return jsonResponse({
            choices: [{
              message: {
                content: JSON.stringify({
                  need_search: true,
                  resolved_query: "甲和乙的近况",
                  search_queries: ["甲 近况", "乙 近况"],
                  confidence: 0.99,
                }),
              },
            }],
          });
        }
        return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
      });

      const response = await runWebSearchTurn(
        {
          model: "m",
          messages: [
            { role: "user", content: "甲和乙是同事" },
            { role: "assistant", content: "是的。" },
            { role: "user", content: "他们最近怎么样？" },
          ],
          agenticx_web_search: true,
        },
        {
          url: "http://gateway.test/v1/chat/completions",
          headers: {},
          fetchImpl: fetchImpl as unknown as typeof fetch,
          loadTenantConfig: async () => ({
            enabled: true,
            provider: "bocha",
            apiKey: "primary-key",
            maxResults: 50,
            calculatorEnabled: true,
            maxSearchCalls,
            providers: [
              {
                id: "primary",
                adapter: "bocha",
                displayName: "Primary",
                apiKey: "primary-key",
                enabled: true,
                priority: 0,
              },
              {
                id: "secondary",
                adapter: "tavily",
                displayName: "Secondary",
                apiKey: "secondary-key",
                enabled: true,
                priority: 1,
              },
            ],
          }),
          executeSearch,
        },
      );
      return { attempted, text: await response.text() };
    };

    const one = await runWithBudget(1);
    expect(one.attempted).toEqual([
      { query: "甲和乙的近况", providerId: "primary" },
    ]);
    expect(one.text).toContain('"providerCalls":1');
    expect(one.text).not.toContain('"toProviderId":"secondary"');

    const two = await runWithBudget(2);
    expect(two.attempted).toEqual([
      { query: "甲 近况", providerId: "primary" },
      { query: "乙 近况", providerId: "primary" },
    ]);
    expect(two.text).toContain('"providerCalls":2');
    expect(two.text).not.toContain('"toProviderId":"secondary"');
  });

  it("executes four facets and at most one retry within a five-call budget", async () => {
    const attempted: Array<{ query: string; providerId?: string }> = [];
    const rewriteBodies: Array<{ messages?: Array<{ content?: string }> }> = [];
    const executeSearch = vi.fn(async (
      query: string,
      _max: number | undefined,
      cfg: ExecuteSearchConfig,
    ) => {
      attempted.push({ query, providerId: cfg.primaryProviderId });
      return [{
        title: `${cfg.primaryProviderId} ${query}`,
        url: `https://${cfg.primaryProviderId}.example/${encodeURIComponent(query)}`,
        snippet: query,
      }];
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ content?: string }>;
      };
      if (body.stream === false) {
        rewriteBodies.push(body);
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                need_search: true,
                resolved_query: "甲乙丙丁的近况",
                search_queries: ["甲 近况", "乙 近况", "丙 近况", "丁 近况"],
                confidence: 0.99,
              }),
            },
          }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "甲乙丙丁都是研究员" },
          { role: "assistant", content: "明白。" },
          { role: "user", content: "分别看看他们的近况" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "primary-key",
          maxResults: 50,
          calculatorEnabled: true,
          maxSearchCalls: 5,
          providers: [
            {
              id: "primary",
              adapter: "bocha",
              displayName: "Primary",
              apiKey: "primary-key",
              enabled: true,
              priority: 0,
            },
            {
              id: "secondary",
              adapter: "tavily",
              displayName: "Secondary",
              apiKey: "secondary-key",
              enabled: true,
              priority: 1,
            },
          ],
        }),
        executeSearch,
      },
    );

    expect(rewriteBodies[0]?.messages?.[0]?.content).toContain("1 到 5 条可直接检索查询");
    expect(attempted).toHaveLength(5);
    expect(attempted.slice(0, 4)).toEqual([
      { query: "甲 近况", providerId: "primary" },
      { query: "乙 近况", providerId: "primary" },
      { query: "丙 近况", providerId: "primary" },
      { query: "丁 近况", providerId: "primary" },
    ]);
    expect(attempted[4]).toEqual({ query: "甲 近况", providerId: "secondary" });
    expect((await response.text())).toContain('"providerCalls":5');
  });

  it("executes an automatic prepared plan without another query-rewrite call", async () => {
    const gatewayBodies: Array<{ stream?: boolean }> = [];
    const executeSearch = vi.fn(async (query: string) => [
      {
        title: "Prepared result",
        url: "https://example.com/prepared",
        snippet: query,
      },
    ]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      gatewayBodies.push({ stream: body.stream });
      return sseResponse(
        'data: {"choices":[{"delta":{"content":"prepared"}}]}\n\ndata: [DONE]\n\n',
      );
    });

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "王虹是谁" },
          { role: "assistant", content: "她是一位数学家。" },
          { role: "user", content: "她最近有什么新闻" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
          maxSearchCalls: 1,
        }),
        executeSearch,
      },
      {
        preparedSearchPlan: {
          query: "数学家 王虹 近期新闻",
          needSearch: true,
          searchQueries: ["数学家 王虹 近期新闻", "王虹 最新动态"],
          calculationIntent: "uncertain" as const,
          confidence: 0.97,
          source: "auto-route",
        },
      },
    );

    expect(gatewayBodies.filter((body) => body.stream === true)).toEqual([
      { stream: true },
    ]);
    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch).toHaveBeenCalledWith(
      "数学家 王虹 近期新闻",
      undefined,
      expect.anything(),
      undefined,
      undefined,
    );
    const text = await response.text();
    expect(text).toContain('"reason":"auto_route_search"');
  });

  it("rewrites only the current query, not the prior question", async () => {
    const executeSearch = vi.fn(async (q: string) => [
      { title: "王虹", url: "https://ex.com/wang-hong", snippet: q },
    ]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: '{"resolved_query":"王虹 最近怎么样","confidence":0.99}',
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"答"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "王虹是谁" },
          { role: "assistant", content: "王虹是一位研究员。" },
          { role: "user", content: "她最近怎么样" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledWith(
      "王虹 最近怎么样",
      undefined,
      expect.anything(),
      undefined,
      undefined,
    );
    expect(executeSearch.mock.calls[0]?.[0]).not.toContain("王虹是谁");
    const rewriteBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? "{}")) as {
      stream?: boolean;
      agenticx_web_search?: unknown;
    };
    expect(rewriteBody.stream).toBe(false);
    expect(rewriteBody.agenticx_web_search).toBeUndefined();
  });

  it("adds the identity anchor needed for an ambiguous Chinese name", async () => {
    const executeSearch = vi.fn(async (q: string) => [
      { title: "王虹近期新闻", url: "https://ex.com/wang-hong-news", snippet: q },
    ]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content:
                  '{"resolved_query":"数学家 王虹 最近几天 新闻","confidence":0.99}',
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"答"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "王虹到底解决了什么数学难题" },
          {
            role: "assistant",
            content: "数学家王虹与合作者证明了三维挂谷猜想。",
          },
          { role: "user", content: "搜一下这几天关于她的新闻" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "k",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    // Query rewrite, calculation planning, answer.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch).toHaveBeenCalledWith(
      "数学家 王虹 最近几天 新闻",
      undefined,
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it("skips search when the rewrite agent cannot form a standalone query", async () => {
    const bodies: unknown[] = [];
    const executeSearch = vi.fn(async () => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      bodies.push(body);
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: { content: '{"resolved_query":"","confidence":0}' },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"基于上下文"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "你认识宗主吗" },
          { role: "assistant", content: "这是一个很宽泛的称呼，没有具体人名。" },
          { role: "user", content: "他为什么被封为宗主呢" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    const body = bodies[1] as { messages?: Array<{ role?: string; content?: string }> };
    const system = String(body.messages?.[0]?.content ?? "");
    expect(system).not.toContain("联网搜索结果");
  });

  it("never searches the raw contextual query when the rewrite call fails", async () => {
    const executeSearch = vi.fn(async () => [
      { title: "不应调用", url: "https://ex.com/no", snippet: "raw" },
    ]);
    const bodies: Array<{ stream?: boolean; messages?: Array<{ content?: string }> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ content?: string }>;
      };
      bodies.push(body);
      if (body.stream === false) {
        return new Response("upstream unavailable", { status: 503 });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"基于已有对话回答"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "王虹到底解决了什么数学难题" },
          { role: "assistant", content: "数学家王虹研究三维挂谷猜想。" },
          { role: "user", content: "搜一下这几天关于她的新闻" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "k",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    expect(bodies.filter((body) => body.stream === false)).toHaveLength(2);
    const directBody = bodies.find((body) => body.stream === true);
    expect(directBody?.messages?.[0]?.content).not.toContain("本轮是寒暄");
  });

  it("searches the self-contained current question once when the rewriter is down", async () => {
    const executeSearch = vi.fn(async (q: string) => [
      { title: "定价页", url: "https://ex.com/pricing", snippet: String(q) },
    ]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        return new Response("upstream unavailable", { status: 503 });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "帮我看看国产大模型的定价" },
          { role: "assistant", content: "好的。" },
          { role: "user", content: "DeepSeek-V3 在 2026 年 3 月的定价是多少" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "k",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    // Exactly one query, no facet split, no history concatenation.
    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch.mock.calls[0]?.[0]).toBe("DeepSeek-V3 在 2026 年 3 月的定价是多少");
    const text = await response.text();
    expect(text).toContain('"reason":"rewrite_fallback_search"');
  });

  it("does not fall back when the rewriter explicitly resolved nothing", async () => {
    const executeSearch = vi.fn(async () => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        // A confident "cannot resolve" is a decision, not an outage.
        return jsonResponse({
          choices: [{ message: { content: '{"resolved_query":"","confidence":0}' } }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "帮我看看国产大模型的定价" },
          { role: "assistant", content: "好的。" },
          { role: "user", content: "DeepSeek-V3 在 2026 年 3 月的定价是多少" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "k",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
  });

  it("does not fall back after the turn was aborted", async () => {
    const executeSearch = vi.fn(async () => []);
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      if (body.stream === false) {
        throw new DOMException("Aborted", "AbortError");
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "帮我看看国产大模型的定价" },
          { role: "assistant", content: "好的。" },
          { role: "user", content: "DeepSeek-V3 在 2026 年 3 月的定价是多少" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "bocha",
          apiKey: "k",
          maxResults: 50,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );

    // The rewrite was attempted and failed; the abort — not the query — is what
    // blocks the fallback.
    expect(
      fetchImpl.mock.calls.some(
        ([, init]) =>
          (JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean }).stream === false,
      ),
    ).toBe(true);
    expect(executeSearch).not.toHaveBeenCalled();
  });

  it("the legacy bypass does not override contextual query resolution", async () => {
    vi.stubEnv("AGENTICX_WEB_SEARCH_BYPASS_FAST_SKIP", "");
    vi.stubEnv("AGENTICX_WEB_SEARCH_ALWAYS", "1");
    try {
      const executeSearch = vi.fn(async (q: string) => [
        { title: "T", url: "https://ex.com/t", snippet: String(q) },
      ]);
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
        if (body.stream === false) {
          return jsonResponse({
            choices: [
              {
                message: { content: '{"resolved_query":"","confidence":0}' },
              },
            ],
          });
        }
        return sseResponse('data: {"choices":[{"delta":{"content":"forced"}}]}\n\ndata: [DONE]\n\n');
      });

      await runWebSearchTurn(
        {
          model: "m",
          messages: [
            { role: "user", content: "你认识宗主吗" },
            { role: "assistant", content: "这是一个很宽泛的称呼，没有具体人名。" },
            { role: "user", content: "他为什么被封为宗主呢" },
          ],
          agenticx_web_search: true,
        },
        {
          url: "http://gateway.test/v1/chat/completions",
          headers: { authorization: "Bearer t" },
          fetchImpl: fetchImpl as unknown as typeof fetch,
          loadTenantConfig: async () => ({
            enabled: true,
            provider: "duckduckgo",
            apiKey: "",
            maxResults: 5,
            calculatorEnabled: true,
          }),
          executeSearch,
        },
      );

      expect(executeSearch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("strips prior assistant think blocks and citation indices before upstream", async () => {
    const THINK_OPEN = "<" + "think" + ">";
    const THINK_CLOSE = "<" + "/" + "think" + ">";
    const bodies: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        stream?: boolean;
        messages?: Array<{ role?: string; content?: string }>;
      };
      if (body.stream === false) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: '{"resolved_query":"蔡徐坤 为什么被封为宗主呢","confidence":0.98}',
              },
            },
          ],
        });
      }
      bodies.push(body);
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "你认识宗主吗" },
          {
            role: "assistant",
            content: `${THINK_OPEN}长推理${THINK_CLOSE}答案提到**蔡徐坤**[8]`,
          },
          { role: "user", content: "他为什么被封为宗主呢" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch: async () => [
          { title: "T", url: "https://ex.com/t", snippet: "蔡徐坤 宗主梗" },
        ],
      },
    );

    const historyAssistant = bodies[0]?.messages?.find(
      (m) => m.role === "assistant" && String(m.content).includes("蔡徐坤"),
    );
    expect(historyAssistant).toBeTruthy();
    const content = String(historyAssistant?.content);
    expect(content).not.toContain(THINK_OPEN);
    expect(content).not.toContain("[8]");
    expect(content).toContain("蔡徐坤");
  });
});

describe("web search calculator", () => {
  const HITS: WebSearchHit[] = [
    {
      title: "公司半年报",
      url: "https://ex.com/hy",
      snippet: "上半年营业收入 907.03 亿元，归属于母公司股东的净利润 445.17 亿元。",
    },
    {
      title: "上年同期",
      url: "https://ex.com/last",
      snippet: "上年同期营业收入 893.90 亿元。",
    },
  ];

  /** Gateway that answers the rewrite, the calculation planner and the answer. */
  const gateway = (calculations: unknown) => {
    const bodies: Array<{
      stream?: boolean;
      messages?: Array<{ role?: string; content?: string }>;
    }> = [];
    const stages: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      bodies.push(body as (typeof bodies)[number]);
      const stage = (init?.headers as Record<string, string> | undefined)?.[
        "x-agenticx-trace-stage"
      ];
      if (stage) stages.push(stage);
      if (stage === "chat.search-calculator") {
        return jsonResponse({
          choices: [{ message: { content: JSON.stringify({ calculations }) } }],
        });
      }
      if (body.stream === false) {
        return jsonResponse({
          choices: [{ message: { content: '{"resolved_query":"公司 半年报","confidence":0.9}' } }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    return { fetchImpl, bodies, stages };
  };

  const turn = async (
    calculations: unknown,
    preparedSearchPlan?: PreparedSearchPlan,
  ) => {
    const { fetchImpl, bodies, stages } = gateway(calculations);
    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "这家公司上半年净利率和营收同比是多少" }],
        agenticx_web_search: true,
        tools: [{ type: "function", function: { name: "web_search" } }],
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch: async () => HITS,
      },
      preparedSearchPlan ? { preparedSearchPlan } : {},
    );
    await readText(res);
    return { bodies, stages, system: String(answerBody(bodies)?.messages?.[0]?.content ?? "") };
  };

  const routedPlan = (calculationIntent: CalculationIntent): PreparedSearchPlan => ({
    query: "某公司 上半年 营收 净利润",
    needSearch: true,
    searchQueries: ["某公司 上半年 营收 净利润"],
    confidence: 0.95,
    source: "auto-route",
    calculationIntent,
  });

  it("computes what the model asked for and hands the answer the exact value", async () => {
    // 净利率 and 同比 are the model's reading of the question; this module
    // knows neither, only quotient and percentage_change over stated figures.
    const { system, stages } = await turn([
      { id: "c1", operation: "quotient", operands: ["445.17", "907.03"] },
      { id: "c2", operation: "percentage_change", operands: ["893.90", "907.03"] },
    ]);
    expect(stages).toContain("chat.search-calculator");
    expect(system).toContain("本轮确定性计算结果");
    expect(system).toContain("0.49079");
    expect(system).toContain("1.46884");
    // Appended last, like the search results block itself. An earlier version
    // put the calculations in front of everything, which changed the system
    // prompt from its first byte and made every computing turn miss the
    // provider's prefix cache — the one thing `withSearchContext` avoids by
    // appending. The figures also read better next to the question.
    expect(system.indexOf("本轮确定性计算结果")).toBeGreaterThan(
      system.indexOf("联网搜索结果"),
    );
  });

  it("changes nothing ahead of the material it was computed from", async () => {
    // Deliberately not asserting a byte-identical prefix: the current-time
    // block sits at offset zero and carries a second-resolution timestamp, so
    // two runs differ whenever they straddle a second. What this change owns is
    // narrower — calculating adds text after the evidence and touches nothing
    // before it.
    const withCalc = await turn([
      { id: "c1", operation: "quotient", operands: ["445.17", "907.03"] },
    ]);
    const withoutCalc = await turn([]);
    const head = (system: string) => system.slice(0, system.indexOf("联网搜索结果"));
    expect(head(withCalc.system)).not.toContain("本轮确定性计算结果");
    expect(head(withCalc.system).length).toBe(head(withoutCalc.system).length);
    expect(withCalc.system.indexOf("本轮确定性计算结果")).toBeGreaterThan(
      withCalc.system.indexOf("联网搜索结果"),
    );
  });

  it("still forwards no tools upstream and does not disturb the sources frame", async () => {
    const { bodies } = await turn([
      { id: "c1", operation: "quotient", operands: ["445.17", "907.03"] },
    ]);
    const answer = answerBody(bodies) as Record<string, unknown> | undefined;
    expect(answer?.tools).toBeUndefined();
    expect(answer?.tool_choice).toBeUndefined();
    expect(answer?.stream).toBe(true);
  });

  it("leaves the grounded answer untouched when nothing is computable", async () => {
    const { system } = await turn([]);
    expect(system).not.toContain("本轮确定性计算结果");
    expect(system).toContain("联网搜索结果");
  });

  it("skips the planning call only when a routing agent said it is not needed", async () => {
    const { stages, system } = await turn(
      [{ id: "c1", operation: "quotient", operands: ["445.17", "907.03"] }],
      routedPlan("not_needed"),
    );
    expect(stages).not.toContain("chat.search-calculator");
    expect(system).not.toContain("本轮确定性计算结果");
    expect(system).toContain("联网搜索结果");
  });

  it("plans on needed, on uncertain, and when no agent judged the turn", async () => {
    // uncertain is the honest answer before retrieval — "上半年表现如何" cannot
    // be settled until the pages are in hand — so it must not skip. Absent is
    // uncertain too: the rewrite agent does not run on every search turn.
    for (const plan of [routedPlan("needed"), routedPlan("uncertain"), undefined]) {
      const { stages, system } = await turn(
        [{ id: "c1", operation: "quotient", operands: ["445.17", "907.03"] }],
        plan,
      );
      expect(stages).toContain("chat.search-calculator");
      expect(system).toContain("0.49079");
    }
  });


  it("computes over a page the user named, not only over search results", async () => {
    // This path returns before the ordinary search flow. It was reported as
    // covered while it was not: "打开这个财报页，算一下净利率" reached the
    // answering model with the figures and no arithmetic.
    const stages: string[] = [];
    const bodies: Array<{
      stream?: boolean;
      messages?: Array<{ role?: string; content?: string }>;
    }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const stage = (init?.headers as Record<string, string> | undefined)?.[
        "x-agenticx-trace-stage"
      ];
      if (stage) stages.push(stage);
      if (stage === "chat.search-calculator") {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  calculations: [
                    { id: "c1", operation: "quotient", operands: ["445.17", "907.03"] },
                  ],
                }),
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    const readPage = vi.fn(async (reference): Promise<DirectPageView> => ({
      reference,
      title: "某公司半年报",
      text: "某公司半年报\n\n上半年实现营业收入 907.03 亿元。\n\n归属于母公司股东的净利润 445.17 亿元。",
      rawChars: 120,
      coverage: "full_html",
      backend: "native",
    }));

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          {
            role: "user",
            content: "https://ex.com/hy 打开这个财报页，帮我算一下净利率",
          },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch: async () => [],
        readPage,
      },
    );
    await readText(res);

    expect(stages).toContain("chat.search-calculator");
    const system = String(answerBody(bodies)?.messages?.[0]?.content ?? "");
    expect(system).toContain("本轮确定性计算结果");
    expect(system).toContain("0.49079");
  });

  it("still calculates when the turn skips search entirely", async () => {
    // "1+2" takes the arithmetic fast path and never searches. Answering it
    // from the model's own head was worse with the toggle on than off.
    const stages: string[] = [];
    const bodies: Array<{
      stream?: boolean;
      messages?: Array<{ role?: string; content?: string }>;
    }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      const stage = (init?.headers as Record<string, string> | undefined)?.[
        "x-agenticx-trace-stage"
      ];
      if (stage) stages.push(stage);
      if (stage === "chat.calculator") {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  calculations: [{ id: "c1", operation: "sum", operands: ["0.1", "0.2"] }],
                }),
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "0.1+0.2" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch: async () => {
          throw new Error("search must not run for a pure expression");
        },
      },
    );
    const text = await readText(res);

    expect(stages).toContain("chat.calculator");
    const system = String(answerBody(bodies)?.messages?.[0]?.content ?? "");
    expect(system).toContain('"value":"0.3"');
    expect(text).toContain("ok");
  });

  it("does not search or attach sources for an expression with a value-question tail", async () => {
    const stages: string[] = [];
    const bodies: Array<{
      stream?: boolean;
      messages?: Array<{ role?: string; content?: string }>;
    }> = [];
    const executeSearch = vi.fn(async () => {
      throw new Error("search must not run for a self-contained arithmetic question");
    });
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      bodies.push(body);
      const stage = (init?.headers as Record<string, string> | undefined)?.[
        "x-agenticx-trace-stage"
      ];
      if (stage) stages.push(stage);
      if (stage === "chat.calculator") {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  calculations: [
                    {
                      id: "c1",
                      operation: "quotient",
                      operands: ["312.67", "13.01"],
                    },
                  ],
                }),
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    const response = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "312.67 ÷ 13.01 等于多少" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );
    const text = await readText(response);

    expect(executeSearch).not.toHaveBeenCalled();
    expect(stages).toContain("chat.calculator");
    expect(String(answerBody(bodies)?.messages?.[0]?.content)).toContain(
      '"value":"24.033051498847"',
    );
    expect(text).toContain('"reason":"arithmetic"');
    expect(text).toContain('"providerCalls":0');
    expect(text).not.toContain("agenticx_web_search_sources");
  });

  it("shows the planner the request, not only the compressed retrieval term", async () => {
    // The resolved query is built to be short — the instruction to compute is
    // exactly what gets compressed out of it.
    let plannerPrompt = "";
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const stage = (init?.headers as Record<string, string> | undefined)?.[
        "x-agenticx-trace-stage"
      ];
      if (stage === "chat.search-calculator") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          messages?: Array<{ content?: string }>;
        };
        plannerPrompt = String(body.messages?.[1]?.content ?? "");
        return jsonResponse({
          choices: [{ message: { content: '{"calculations":[]}' } }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "查一下某公司最新股价和 EPS，并帮我算出 PE" },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch: async () => [
          { title: "某公司行情", url: "https://ex.com/q", snippet: "最新股价 42.50 元，EPS 3.40 元。" },
        ],
      },
      {
        preparedSearchPlan: {
          query: "某公司 最新股价 EPS",
          needSearch: true,
          searchQueries: ["某公司 最新股价 EPS"],
          confidence: 0.95,
          source: "auto-route",
          calculationIntent: "uncertain" as const,
        },
      },
    );
    await readText(res);

    expect(plannerPrompt).toContain("并帮我算出 PE");
    expect(plannerPrompt).toContain("某公司 最新股价 EPS");
  });


  /** Answers the calculation planner, the query rewriter, then the stream. */
  const noEvidenceGateway = (rewrite?: string) => {
    const stages: string[] = [];
    const bodies: Array<{
      stream?: unknown;
      messages?: Array<{ role?: string; content?: string }>;
    }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { stream?: boolean };
      bodies.push(body as (typeof bodies)[number]);
      const stage = (init?.headers as Record<string, string> | undefined)?.[
        "x-agenticx-trace-stage"
      ];
      if (stage) stages.push(stage);
      if (stage === "chat.calculator") {
        return jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  calculations: [
                    { id: "c1", operation: "difference", operands: ["31.2", "28.5"] },
                  ],
                }),
              },
            },
          ],
        });
      }
      if (rewrite && body.stream === false) {
        return jsonResponse({ choices: [{ message: { content: rewrite } }] });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
    return { fetchImpl, bodies, stages };
  };

  const MARGIN_QUESTION = "去年毛利率 28.5，今年 31.2，高了多少";

  it("lets a no-search decision still open a calculation the pattern missed", async () => {
    // The rewriter says this needs no public web facts and, in the same reply,
    // that the answer needs arithmetic. Nothing in the pattern gate recognises
    // the question, so without the hint the answer is whatever the model works
    // out in its head.
    const { fetchImpl, bodies, stages } = noEvidenceGateway(
      JSON.stringify({
        need_search: false,
        resolved_query: MARGIN_QUESTION,
        search_queries: [],
        confidence: 0.95,
        calculation_intent: "needed",
      }),
    );
    const executeSearch = vi.fn(async () => []);
    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [
          { role: "user", content: "上次那家公司的毛利率是多少" },
          { role: "assistant", content: "去年 28.5%。" },
          { role: "user", content: MARGIN_QUESTION },
        ],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch,
      },
    );
    await readText(res);

    expect(executeSearch).not.toHaveBeenCalled();
    expect(stages).toContain("chat.calculator");
    expect(String(answerBody(bodies)?.messages?.[0]?.content)).toContain('"value":"2.7"');
  });

  it("keeps computing when an administrator disabled search, hint and all", async () => {
    const { fetchImpl, bodies, stages } = noEvidenceGateway();
    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "31.2 - 28.5" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: false,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch: async () => [],
      },
    );
    const text = await readText(res);

    expect(stages).toContain("chat.calculator");
    expect(String(answerBody(bodies)?.messages?.[0]?.content)).toContain('"value":"2.7"');
    // The administrator notice is still the first thing the reader sees.
    expect(text).toContain("管理员已关闭联网搜索");
  });

  it("keeps computing when retrieval fails, and still says retrieval failed", async () => {
    const { fetchImpl, bodies, stages } = noEvidenceGateway();
    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "查一下今年行情。另外 31.2 - 28.5 是多少" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: {},
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({
          enabled: true,
          provider: "duckduckgo",
          apiKey: "",
          maxResults: 5,
          calculatorEnabled: true,
        }),
        executeSearch: async () => [],
      },
    );
    const text = await readText(res);

    expect(stages).toContain("chat.calculator");
    expect(String(answerBody(bodies)?.messages?.[0]?.content)).toContain('"value":"2.7"');
    expect(text).toContain("联网搜索暂不可用");
  });

  it("drops a figure the sources never stated rather than computing it exactly", async () => {
    // 445.17 misread as 445.71: the arithmetic would be perfect and the answer
    // wrong, and it travels in a system message nobody sees.
    const { system } = await turn([
      { id: "c1", operation: "quotient", operands: ["445.71", "907.03"] },
    ]);
    expect(system).not.toContain("本轮确定性计算结果");
  });
});

describe("formatWebSearchSourcesSse", () => {
  it("carries the provider timestamp so ranking can be audited afterwards", () => {
    // Dropping it made the persisted record look as though the providers
    // returned no dates, which is the opposite of what actually happened.
    const frame = formatWebSearchSourcesSse(
      [
        {
          title: "行情页",
          url: "https://ex.com/a",
          snippet: "价格 348.580",
          publishedAt: "2026-08-07",
        },
      ],
      [{ title: "无日期来源", url: "https://ex.com/b", snippet: "x" }],
    );
    const payload = JSON.parse(frame.replace(/^data: /, "").trim()) as {
      agenticx_web_search_sources: Array<Record<string, unknown>>;
    };
    expect(payload.agenticx_web_search_sources[0]).toMatchObject({
      url: "https://ex.com/a",
      usedByModel: true,
      publishedAt: "2026-08-07",
    });
    // Absent stays absent rather than becoming an empty string.
    expect(payload.agenticx_web_search_sources[1]).not.toHaveProperty("publishedAt");
  });
});
