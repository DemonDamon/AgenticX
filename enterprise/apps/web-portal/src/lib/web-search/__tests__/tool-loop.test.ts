import { describe, expect, it, vi } from "vitest";
import {
  extractLastUserQuery,
  runWebSearchTurn,
  synthesizeTextSse,
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

  it("injects search hits into system context without tools", () => {
    const hits: WebSearchHit[] = [{ title: "T", url: "https://example.com", snippet: "s" }];
    const msgs = withSearchContext([{ role: "user", content: "q" }], hits);
    expect(msgs[0]?.role).toBe("system");
    expect(String(msgs[0]?.content)).toContain("https://example.com");
    expect(String(msgs[0]?.content)).toContain("禁止输出任何工具调用");
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
        messages: [{ role: "user", content: "hi" }],
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
});
