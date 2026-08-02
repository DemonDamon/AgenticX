import { describe, expect, it, vi } from "vitest";
import {
  buildWebSearchQuery,
  compactHitsForModel,
  extractLastUserQuery,
  isShortFollowUpQuery,
  pipeUpstreamSse,
  runWebSearchTurn,
  synthesizeTextSse,
  WEB_SEARCH_CONTEXT_SNIPPET_CHARS,
  WEB_SEARCH_SYSTEM_HINT,
  withSearchContext,
} from "../tool-loop";
import type { WebSearchHit } from "../providers";

function sseResponse(text: string): Response {
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
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
  });

  it("detects short follow-up slot fills vs full questions", () => {
    expect(isShortFollowUpQuery("广州南沙")).toBe(true);
    expect(isShortFollowUpQuery("广州南沙天气如何")).toBe(false);
  });

  it("builds contextual search query for multi-turn slot fill", () => {
    expect(
      buildWebSearchQuery([
        { role: "user", content: "今天天气怎么样" },
        { role: "assistant", content: "请问哪个城市？" },
        { role: "user", content: "广州南沙" },
      ]),
    ).toBe("广州南沙 今天天气怎么样");

    expect(
      buildWebSearchQuery([{ role: "user", content: "广州南沙天气如何" }]),
    ).toBe("广州南沙天气如何");

    // Prior turn was greeting — do not splice into search keywords.
    expect(
      buildWebSearchQuery([
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好！" },
        { role: "user", content: "广州南沙" },
      ]),
    ).toBe("广州南沙");
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

  it("runs server-side search first and strips agenticx_web_search / tools on final stream", async () => {
    const bodies: unknown[] = [];
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
    expect(bodies).toHaveLength(1);
    const finalBody = bodies[0] as {
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
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"choices":[{"delta":{"content":"南沙今天大雨"}}]}\n\ndata: [DONE]\n\n'),
    );

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
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(executeSearch.mock.calls[0]?.[0]).toBe("广州南沙 今天天气怎么样");
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
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    const text = await readText(res);
    expect(text).toContain("agenticx_web_search_sources");
    expect(text).toContain("https://news.example/ai");
  });

  it("AGENTICX_WEB_SEARCH_ALWAYS forces search even for greetings", async () => {
    const prev = process.env.AGENTICX_WEB_SEARCH_ALWAYS;
    process.env.AGENTICX_WEB_SEARCH_ALWAYS = "1";
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
          }),
          executeSearch,
        },
      );

      expect(executeSearch).toHaveBeenCalledTimes(1);
      const text = await readText(res);
      expect(text).toContain("agenticx_web_search_sources");
      expect(text).toContain("forced");
    } finally {
      if (prev === undefined) delete process.env.AGENTICX_WEB_SEARCH_ALWAYS;
      else process.env.AGENTICX_WEB_SEARCH_ALWAYS = prev;
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
    const bodies: Array<{ messages?: Array<{ role?: string; content?: string | null }> }> = [];
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
        }),
        executeSearch,
      },
    );

    const system = String(bodies[0]?.messages?.[0]?.content ?? "");
    const injectedCount = (system.match(/^\[\d+\] /gm) ?? []).length;
    expect(injectedCount).toBeGreaterThan(10);
  });

  it("keeps SSE source order aligned with model injection indices (AC-6)", async () => {
    const bodies: Array<{ messages?: Array<{ role?: string; content?: string | null }> }> = [];
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
        }),
        executeSearch,
      },
    );

    const system = String(bodies[0]?.messages?.[0]?.content ?? "");
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

  it("resolves referential follow-up entity into the search query", async () => {
    const executeSearch = vi.fn(async (q: string) => [
      { title: "宗主梗", url: "https://ex.com/zongzhu", snippet: "蔡徐坤 宗主" },
    ]);
    const fetchImpl = vi.fn(async () =>
      sseResponse('data: {"choices":[{"delta":{"content":"答"}}]}\n\ndata: [DONE]\n\n'),
    );

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
        }),
        executeSearch,
      },
    );

    expect(executeSearch).toHaveBeenCalledTimes(1);
    expect(String(executeSearch.mock.calls[0]?.[0])).toContain("蔡徐坤");
  });

  it("skips search when referential follow-up has no resolvable entity", async () => {
    const bodies: unknown[] = [];
    const executeSearch = vi.fn(async () => []);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
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
        }),
        executeSearch,
      },
    );

    expect(executeSearch).not.toHaveBeenCalled();
    const body = bodies[0] as { messages?: Array<{ role?: string; content?: string }> };
    const system = String(body.messages?.[0]?.content ?? "");
    expect(system).not.toContain("联网搜索结果");
  });

  it("AGENTICX_WEB_SEARCH_ALWAYS still searches referential follow-ups without entity", async () => {
    const prev = process.env.AGENTICX_WEB_SEARCH_ALWAYS;
    process.env.AGENTICX_WEB_SEARCH_ALWAYS = "1";
    try {
      const executeSearch = vi.fn(async (q: string) => [
        { title: "T", url: "https://ex.com/t", snippet: String(q) },
      ]);
      const fetchImpl = vi.fn(async () =>
        sseResponse('data: {"choices":[{"delta":{"content":"forced"}}]}\n\ndata: [DONE]\n\n'),
      );

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
          }),
          executeSearch,
        },
      );

      expect(executeSearch).toHaveBeenCalledTimes(1);
    } finally {
      if (prev === undefined) delete process.env.AGENTICX_WEB_SEARCH_ALWAYS;
      else process.env.AGENTICX_WEB_SEARCH_ALWAYS = prev;
    }
  });

  it("strips prior assistant think blocks and citation indices before upstream", async () => {
    const THINK_OPEN = "<" + "think" + ">";
    const THINK_CLOSE = "<" + "/" + "think" + ">";
    const bodies: Array<{ messages?: Array<{ role?: string; content?: string }> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
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
