import { describe, expect, it, vi } from "vitest";
import { extractLastUserQuery, runWebSearchTurn, synthesizeTextSse, WEB_SEARCH_TOOL_CHOICE } from "../tool-loop";
import type { WebSearchHit } from "../providers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

  it("extracts the last user query for fallback search", () => {
    expect(
      extractLastUserQuery([
        { role: "system", content: "sys" },
        { role: "user", content: "first" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "  opus 5.0  " },
      ]),
    ).toBe("opus 5.0");
  });

  it("injects web_search tool with required tool_choice and strips agenticx_web_search on probe", async () => {
    const bodies: unknown[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      call += 1;
      if (call === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "web_search", arguments: JSON.stringify({ query: "hi" }) },
                  },
                ],
              },
            },
          ],
        });
      }
      if (call === 2) {
        return jsonResponse({
          choices: [{ message: { role: "assistant", content: "ready" } }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n');
    });

    const hits: WebSearchHit[] = [{ title: "Hi", url: "https://example.com", snippet: "s" }];
    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        agenticx_web_search: true,
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({ enabled: true, provider: "duckduckgo", apiKey: "", maxResults: 5 }),
        executeSearch: async () => hits,
      },
    );

    const first = bodies[0] as {
      tools?: Array<{ function?: { name?: string } }>;
      tool_choice?: unknown;
      agenticx_web_search?: unknown;
      stream?: boolean;
    };
    expect(first.tools?.[0]?.function?.name).toBe("web_search");
    expect(first.tool_choice).toEqual(WEB_SEARCH_TOOL_CHOICE);
    expect(first.agenticx_web_search).toBeUndefined();
    expect(first.stream).toBe(false);

    const text = await readText(res);
    expect(text).toContain("**来源**");
    expect(text).toContain("data: [DONE]");
  });

  it("falls back to server-side search when model returns prose without tool_calls", async () => {
    const bodies: unknown[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      call += 1;
      if (call === 1) {
        // MiniMax-style: reasoning/prose about searching, no tool_calls.
        return jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: "<think>让我搜索一下相关信息。</think>",
              },
            },
          ],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"基于检索的回答"}}]}\n\ndata: [DONE]\n\n');
    });

    const hits: WebSearchHit[] = [
      { title: "Opus 5", url: "https://news.example/opus", snippet: "released" },
    ];
    const executeSearch = vi.fn(async (query: string) => {
      expect(query).toContain("opus");
      return hits;
    });

    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "搜一下关于opus 5.0的信息" }],
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
    const finalBody = bodies.at(-1) as { messages?: Array<{ role?: string }>; stream?: boolean };
    expect(finalBody.stream).toBe(true);
    expect(finalBody.messages?.some((m) => m.role === "tool")).toBe(true);

    const text = await readText(res);
    expect(text).toContain("基于检索的回答");
    expect(text).toContain("**来源**");
    expect(text).toContain("https://news.example/opus");
    // Must NOT treat the thinking-only probe as the final answer.
    expect(text.includes("让我搜索一下相关信息")).toBe(false);
  });

  it("appends tool role message after tool_calls and includes sources", async () => {
    let call = 0;
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      bodies.push(body);
      call += 1;
      if (call === 1) {
        return jsonResponse({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "web_search", arguments: JSON.stringify({ query: "deepseek" }) },
                  },
                ],
              },
            },
          ],
        });
      }
      if (call === 2) {
        // Second probe: no further tool calls → break to final stream.
        return jsonResponse({
          choices: [{ message: { role: "assistant", content: "ready" } }],
        });
      }
      return sseResponse('data: {"choices":[{"delta":{"content":"answer [1]"}}]}\n\ndata: [DONE]\n\n');
    });

    const hits: WebSearchHit[] = [{ title: "DeepSeek News", url: "https://news.example/ds", snippet: "latest" }];
    const res = await runWebSearchTurn(
      {
        model: "m",
        messages: [{ role: "user", content: "deepseek latest?" }],
      },
      {
        url: "http://gateway.test/v1/chat/completions",
        headers: { authorization: "Bearer t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        loadTenantConfig: async () => ({ enabled: true, provider: "duckduckgo", apiKey: "", maxResults: 5 }),
        executeSearch: async () => hits,
      },
    );

    const finalBody = bodies.at(-1) as { messages?: Array<{ role?: string; content?: string }>; stream?: boolean };
    expect(finalBody.stream).toBe(true);
    const toolMsg = finalBody.messages?.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("DeepSeek News");

    const text = await readText(res);
    expect(text).toContain("**来源**");
    expect(text).toContain("https://news.example/ds");
    expect(text).toContain("data: [DONE]");
  });

  it("does not inject tools when tenant enabled=false", async () => {
    const bodies: unknown[] = [];
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
      },
    );

    const first = bodies[0] as { tools?: unknown; stream?: boolean };
    expect(first.tools).toBeUndefined();
    expect(first.stream).toBe(true);
    const text = await readText(res);
    expect(text).toContain("管理员已关闭联网搜索");
    expect(text).toContain("plain");
  });

  it("degrades to direct stream without tools when probe throws", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { tools?: unknown; stream?: boolean };
      if (call === 1) {
        throw new Error("probe boom");
      }
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
      },
    );

    const text = await readText(res);
    expect(text).toContain("联网搜索暂不可用");
    expect(text).toContain("fallback");
  });
});
