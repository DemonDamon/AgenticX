/**
 * Portal BFF web-search turn: server-side search first, then stream a grounded answer.
 *
 * Why not OpenAI tools probe for MiniMax-class models:
 * - Many providers ignore tool_choice / emit prose or proprietary XML (minimax:tool_call)
 * - User toggle already means "must search"; waiting on model tool_calls is brittle
 */

import { stripEmptyAssistantMessages } from "../chat-completion-sanitize";
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
        max_results: { type: "integer", description: "返回结果条数，1-50，默认 50" },
      },
      required: ["query"],
    },
  },
} as const;

export const WEB_SEARCH_SYSTEM_HINT =
  "系统已完成联网搜索，并将结果附在下方。请严格基于这些结果作答；事实句末用 [N] 标注来源编号。" +
  "禁止声称无法联网；禁止输出任何工具调用 XML/标签（包括 minimax:tool_call、<invoke>、tool_call 等）。";

/** @deprecated Kept for tests / compatibility; search-first path does not probe tools. */
export const WEB_SEARCH_TOOL_CHOICE = {
  type: "function",
  function: { name: "web_search" },
} as const;

const ADMIN_DISABLED_HINT = "> 管理员已关闭联网搜索。\n\n";
const UNAVAILABLE_HINT = "> 联网搜索暂不可用，以下回答基于模型已有知识。\n\n";

type ChatMessage = {
  role: string;
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
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

export function synthesizeTextSse(
  content: string,
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  },
): string {
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

/** Keep search keywords short — full document dumps make DDG challenge / return empty. */
export const MAX_WEB_SEARCH_QUERY_CHARS = 240;

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; text?: unknown };
    if (row.type === "text" && typeof row.text === "string" && row.text.trim()) {
      parts.push(row.text.trim());
    }
  }
  return parts.join("\n").trim();
}

/**
 * Strip portal-injected attachment bodies (`--- 附件: name ---…`) so web search
 * uses the user's short question (e.g. 「总结一下」), not the whole parsed file.
 */
export function sanitizeWebSearchQuery(raw: string, maxChars = MAX_WEB_SEARCH_QUERY_CHARS): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const attachIdx = text.search(/\n---\s*附件\s*[:：]/);
  if (attachIdx >= 0) {
    text = text.slice(0, attachIdx).trim();
  } else if (/^---\s*附件\s*[:：]/.test(text)) {
    // User sent attachment-only turn — fall back to filename line if present.
    const nameMatch = text.match(/^---\s*附件\s*[:：]\s*(.+?)\s*---/);
    text = nameMatch?.[1]?.trim() || "";
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd();
}

export function extractLastUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== "user") continue;
    const text = textFromMessageContent(msg.content);
    if (text) return sanitizeWebSearchQuery(text);
  }
  return "";
}

function stripWebSearchFlag<T extends Record<string, unknown>>(body: T): Omit<T, "agenticx_web_search"> {
  const { agenticx_web_search: _ignored, ...rest } = body;
  return rest;
}

/** Structured SSE frame (not mixed into delta.content). */
export function formatWebSearchSourcesSse(hits: WebSearchHit[]): string {
  const payload = hits.map((hit) => ({
    title: hit.title,
    url: hit.url,
    snippet: hit.snippet,
  }));
  return sseDataFrame({ agenticx_web_search_sources: payload });
}

export function withSearchContext(messages: ChatMessage[], hits: WebSearchHit[]): ChatMessage[] {
  const resultsBlock =
    `${WEB_SEARCH_SYSTEM_HINT}\n\n--- 联网搜索结果 ---\n${formatHits(hits)}\n--- 搜索结果结束 ---`;
  const next = messages.map((m) => ({ ...m }));
  if (next[0]?.role === "system") {
    const existing = typeof next[0].content === "string" ? next[0].content : "";
    next[0] = {
      ...next[0],
      content: existing ? `${existing}\n\n${resultsBlock}` : resultsBlock,
    };
    return next;
  }
  return [{ role: "system", content: resultsBlock }, ...next];
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
  const sourcesFrame = hits.length > 0 ? formatWebSearchSourcesSse(hits) : "";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // Emit sources BEFORE answer tokens so the client can render the entry row /
      // citation pills during streaming — and so trailers are not lost if a client
      // historically stopped reading on finish_reason=stop.
      if (sourcesFrame) {
        controller.enqueue(encoder.encode(sourcesFrame));
      }
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
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            continue;
          }
          controller.enqueue(encoder.encode(`${frame}\n\n`));
        }
      }
      if (!sawDone) {
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
  const originalMessages = stripEmptyAssistantMessages(
    Array.isArray(baseBody.messages) ? (baseBody.messages as ChatMessage[]) : [],
  );

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
  const query = extractLastUserQuery(originalMessages);

  try {
    if (!query) {
      throw new Error("missing user query for web search");
    }

    const hits = await searchFn(query, undefined, cfg);
    if (hits.length === 0) {
      throw new Error("search returned no hits");
    }

    // Strip tools from the final completion — MiniMax may otherwise dump XML tool calls.
    const { tools: _tools, tool_choice: _toolChoice, ...rest } = baseBody;
    const messages = withSearchContext(originalMessages, hits);
    const finalUpstream = await callGatewayStream(deps, {
      ...rest,
      stream: true,
      messages,
    });
    return pipeWithSourcesAppendix(finalUpstream, hits);
  } catch (error) {
    console.warn("[web-search] turn failed, degrading:", error instanceof Error ? error.message : error);
    const { tools: _tools, tool_choice: _toolChoice, ...rest } = baseBody;
    const upstream = await callGatewayStream(deps, {
      ...rest,
      stream: true,
      messages: originalMessages,
    });
    return pipeWithPrefix(upstream, UNAVAILABLE_HINT);
  }
}
