/**
 * Bounded web_search tool loop for portal BFF chat completions.
 */

import { executeWebSearch, formatHits, type WebSearchHit, type WebSearchRuntimeConfig } from "./providers";
import { resolveWebSearchConfig, type TenantWebSearchRow } from "./config";

export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "检索公开网页，获取最新资讯、实时数据，以及超出模型知识截止日期的信息。用户问题涉及时效性、当前事实或外部网页时必须调用。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词，使用与问题相同的语言" },
        max_results: { type: "integer", description: "返回结果条数，1-10，默认 5" },
      },
      required: ["query"],
    },
  },
} as const;

export const WEB_SEARCH_SYSTEM_HINT =
  "你已具备联网搜索能力：当问题依赖时效性或最新事实时，必须先调用 web_search 再作答，禁止声称自己无法联网。" +
  "每条来自搜索结果的事实，句末用 [N] 标注来源编号，N 与工具返回结果中的编号一致。";

const MAX_SEARCH_ROUNDS = 2;
const ADMIN_DISABLED_HINT = "> 管理员已关闭联网搜索。\n\n";
const UNAVAILABLE_HINT = "> 联网搜索暂不可用，以下回答基于模型已有知识。\n\n";

/** User explicitly toggled web search — force the first probe to call the tool. */
export const WEB_SEARCH_TOOL_CHOICE = {
  type: "function",
  function: { name: "web_search" },
} as const;

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

type ToolCall = {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

type CompletionsJson = {
  choices?: Array<{
    message?: ChatMessage;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type GatewayFetchDeps = {
  url: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  loadTenantConfig?: () => Promise<TenantWebSearchRow>;
  executeSearch?: typeof executeWebSearch;
};

function sseDataFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function synthesizeTextSse(content: string, usage?: CompletionsJson["usage"]): string {
  const frames: string[] = [];
  if (usage) {
    frames.push(sseDataFrame({ usage }));
  }
  if (content) {
    frames.push(sseDataFrame({ choices: [{ delta: { content } }] }));
  }
  frames.push("data: [DONE]\n\n");
  return frames.join("");
}

function withSystemHint(messages: ChatMessage[]): ChatMessage[] {
  const next = messages.map((m) => ({ ...m }));
  if (next[0]?.role === "system") {
    const existing = typeof next[0].content === "string" ? next[0].content : "";
    next[0] = {
      ...next[0],
      content: existing ? `${existing}\n\n${WEB_SEARCH_SYSTEM_HINT}` : WEB_SEARCH_SYSTEM_HINT,
    };
    return next;
  }
  return [{ role: "system", content: WEB_SEARCH_SYSTEM_HINT }, ...next];
}

function parseToolArgs(raw: string | undefined): { query: string; max_results?: number } {
  try {
    const parsed = JSON.parse(raw || "{}") as { query?: unknown; max_results?: unknown };
    const query = typeof parsed.query === "string" ? parsed.query : "";
    const maxResults =
      typeof parsed.max_results === "number"
        ? parsed.max_results
        : typeof parsed.max_results === "string"
          ? Number(parsed.max_results)
          : undefined;
    return { query, max_results: Number.isFinite(maxResults) ? maxResults : undefined };
  } catch {
    return { query: "" };
  }
}

function formatSourcesAppendix(hits: WebSearchHit[]): string {
  if (hits.length === 0) return "";
  const lines = hits.map((hit, index) => `[${index + 1}] ${hit.title} — ${hit.url}`);
  return `\n\n---\n**来源**\n${lines.join("\n")}`;
}

function stripWebSearchFlag<T extends Record<string, unknown>>(body: T): Omit<T, "agenticx_web_search"> {
  const { agenticx_web_search: _ignored, ...rest } = body;
  return rest;
}

export function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const content = msg.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  }
  return "";
}

async function callGatewayJson(
  deps: GatewayFetchDeps,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: CompletionsJson }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl(deps.url, {
    method: "POST",
    headers: deps.headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as CompletionsJson;
  return { ok: response.ok, status: response.status, json };
}

async function callGatewayStream(
  deps: GatewayFetchDeps,
  body: Record<string, unknown>,
): Promise<Response> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return fetchImpl(deps.url, {
    method: "POST",
    headers: deps.headers,
    body: JSON.stringify(body),
  });
}

function eventStreamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

async function pipeWithPrefix(upstream: Response, prefixText: string): Promise<Response> {
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "gateway error");
    return new Response(errText, {
      status: upstream.status || 502,
      headers: { "content-type": "application/json" },
    });
  }
  const prefix = synthesizeTextSse(prefixText).replace("data: [DONE]\n\n", "");
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(prefix));
      const reader = upstream.body!.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) controller.enqueue(value);
      }
      controller.close();
    },
  });
  return eventStreamResponse(stream);
}

async function pipeWithSourcesAppendix(upstream: Response, hits: WebSearchHit[]): Promise<Response> {
  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "gateway error");
    return new Response(errText, {
      status: upstream.status || 502,
      headers: { "content-type": "application/json" },
    });
  }
  const appendix = formatSourcesAppendix(hits);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf("\n\n");
        while (idx >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          idx = buffer.indexOf("\n\n");
          const dataLine = frame
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.startsWith("data:"));
          if (!dataLine) {
            controller.enqueue(encoder.encode(`${frame}\n\n`));
            continue;
          }
          const data = dataLine.replace(/^data:\s*/, "");
          if (data === "[DONE]") {
            sawDone = true;
            if (appendix) {
              controller.enqueue(encoder.encode(sseDataFrame({ choices: [{ delta: { content: appendix } }] })));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            continue;
          }
          controller.enqueue(encoder.encode(`${frame}\n\n`));
        }
      }
      if (!sawDone) {
        if (appendix) {
          controller.enqueue(encoder.encode(sseDataFrame({ choices: [{ delta: { content: appendix } }] })));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      }
      controller.close();
    },
  });
  return eventStreamResponse(stream);
}

export async function runWebSearchTurn(
  parsedBody: Record<string, unknown>,
  deps: GatewayFetchDeps,
): Promise<Response> {
  const baseBody = stripWebSearchFlag(parsedBody);
  const originalMessages = Array.isArray(baseBody.messages)
    ? (baseBody.messages as ChatMessage[])
    : [];

  const tenant = deps.loadTenantConfig ? await deps.loadTenantConfig() : null;
  const cfg: WebSearchRuntimeConfig = resolveWebSearchConfig(tenant);

  if (!cfg.enabled) {
    const upstream = await callGatewayStream(deps, {
      ...baseBody,
      stream: true,
      messages: originalMessages,
    });
    return pipeWithPrefix(upstream, ADMIN_DISABLED_HINT);
  }

  const searchFn = deps.executeSearch ?? executeWebSearch;
  let messages = withSystemHint(originalMessages);
  const collectedHits: WebSearchHit[] = [];

  const appendSearchResults = async (
    query: string,
    maxResults: number | undefined,
    toolCallId: string,
  ): Promise<boolean> => {
    const hits = await searchFn(query, maxResults, cfg);
    for (const hit of hits) collectedHits.push(hit);
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      name: "web_search",
      content: formatHits(hits),
    });
    return hits.length > 0;
  };

  try {
    for (let round = 0; round < MAX_SEARCH_ROUNDS; round += 1) {
      const probe = await callGatewayJson(deps, {
        ...baseBody,
        stream: false,
        tools: [WEB_SEARCH_TOOL],
        // First round: user toggled search on — require the tool so models that only
        // "think about searching" (e.g. MiniMax) cannot short-circuit with prose.
        tool_choice: round === 0 ? WEB_SEARCH_TOOL_CHOICE : "auto",
        messages,
      });

      if (!probe.ok) {
        throw new Error(`probe failed: ${probe.status}`);
      }

      const message = probe.json.choices?.[0]?.message;
      if (!message) {
        throw new Error("probe missing message");
      }

      const toolCalls = message.tool_calls ?? [];
      const searchCalls = toolCalls.filter((tc) => (tc.function?.name ?? "") === "web_search");

      if (searchCalls.length === 0) {
        if (collectedHits.length === 0) {
          // Model ignored required tool_choice (or provider stripped tools).
          // Fall back to a server-side search using the last user query — never treat
          // reasoning-only prose as the final answer when the user asked to search.
          const query = extractLastUserQuery(originalMessages);
          if (!query) {
            throw new Error("missing user query for fallback search");
          }
          const fallbackId = `web_search_fallback_${Date.now()}`;
          messages = [
            ...messages,
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: fallbackId,
                  type: "function",
                  function: {
                    name: "web_search",
                    arguments: JSON.stringify({ query }),
                  },
                },
              ],
            },
          ];
          const anyHits = await appendSearchResults(query, undefined, fallbackId);
          if (!anyHits) {
            throw new Error("fallback search returned no hits");
          }
          break;
        }
        break;
      }

      messages = [
        ...messages,
        {
          role: "assistant",
          content: message.content ?? null,
          tool_calls: toolCalls,
        },
      ];

      let anyHits = false;
      for (const call of searchCalls) {
        const args = parseToolArgs(call.function?.arguments);
        const ok = await appendSearchResults(args.query, args.max_results, call.id);
        if (ok) anyHits = true;
      }

      if (!anyHits && collectedHits.length === 0) {
        throw new Error("all searches failed");
      }
    }

    if (collectedHits.length === 0) {
      throw new Error("no search hits");
    }

    const finalUpstream = await callGatewayStream(deps, {
      ...baseBody,
      stream: true,
      tool_choice: "none",
      messages,
    });
    return pipeWithSourcesAppendix(finalUpstream, collectedHits);
  } catch {
    const upstream = await callGatewayStream(deps, {
      ...baseBody,
      stream: true,
      messages: originalMessages,
    });
    return pipeWithPrefix(upstream, UNAVAILABLE_HINT);
  }
}
