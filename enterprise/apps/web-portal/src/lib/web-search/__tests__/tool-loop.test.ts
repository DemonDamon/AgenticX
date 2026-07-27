import { describe, expect, it, vi } from "vitest";
import { runWebSearchTurn, synthesizeTextSse } from "../tool-loop";
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

  it("injects web_search tool and strips agenticx_web_search on probe", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: "no tools needed" } }],
      });
    });

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
      },
    );

    const first = bodies[0] as {
      tools?: Array<{ function?: { name?: string } }>;
      agenticx_web_search?: unknown;
      stream?: boolean;
    };
    expect(first.tools?.[0]?.function?.name).toBe("web_search");
    expect(first.agenticx_web_search).toBeUndefined();
    expect(first.stream).toBe(false);

    const text = await readText(res);
    expect(text).toContain("no tools needed");
    expect(text).toContain("data: [DONE]");
    expect(text.includes("**来源**")).toBe(false);
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
