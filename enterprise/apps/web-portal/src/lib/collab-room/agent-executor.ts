import type { EnterpriseAgent } from "@agenticx/iam-core";
import {
  GatewayMcpClient,
  resolveGatewayMcpBase,
  type GatewayMcpCallResult,
  type GatewayMcpTool,
} from "../gateway-mcp-client";
import { requestMetaReply } from "./meta-reply";

export const MAX_TOOL_ROUNDS = 6;
export const TOOL_NAME_MAX = 64;

export type AgentStep = { tool: string; server: string; ok: boolean; durationMs: number };

export type CloudPromptMessage = { role: "system" | "user" | "assistant"; content: string };

type LoopMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

type ChatTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

type BoundTool = { server: string; tool: string; client: GatewayMcpClient };

type ParsedToolCall = { id: string; name: string; arguments: string };

const LIMIT_NUDGE = "工具调用已达上限。请仅根据已有工具结果直接回答，不要再调用工具。";
const INVALID_ARGS = "参数不是合法 JSON";
const UNKNOWN_TOOL = "未知工具";

export function encodeGatewayToolName(serverName: string, toolName: string): string {
  const server = sanitizeToolPart(serverName, "server");
  const tool = sanitizeToolPart(toolName, "tool");
  const sep = "__";
  const combined = `${server}${sep}${tool}`;
  if (combined.length <= TOOL_NAME_MAX) return combined;
  const budget = TOOL_NAME_MAX - sep.length;
  let serverBudget = Math.min(server.length, Math.ceil(budget / 2));
  let toolBudget = budget - serverBudget;
  if (toolBudget > tool.length) {
    toolBudget = tool.length;
    serverBudget = Math.min(server.length, budget - toolBudget);
  }
  if (serverBudget < 1) serverBudget = 1;
  if (toolBudget < 1) {
    toolBudget = 1;
    serverBudget = Math.min(server.length, budget - toolBudget);
  }
  return `${server.slice(0, serverBudget)}${sep}${tool.slice(0, toolBudget)}`.slice(0, TOOL_NAME_MAX);
}

export async function runCloudAgentLoop(params: {
  agent: EnterpriseAgent;
  messages: CloudPromptMessage[];
  modelHeaders: Record<string, string>;
  model: string;
  mcpServers: Array<{ id: string; name: string }>;
  deps?: {
    fetchImpl?: typeof fetch;
    gatewayCompletionsUrl?: string;
    gatewayMcpBase?: string;
    requestReply?: typeof requestMetaReply;
  };
}): Promise<{ content: string; steps: AgentStep[] }> {
  if (params.agent.runtime !== "cloud") {
    throw new Error(`unsupported agent runtime: ${params.agent.runtime}`);
  }
  const fetchImpl = params.deps?.fetchImpl ?? fetch;
  const completionsUrl =
    params.deps?.gatewayCompletionsUrl ??
    process.env.GATEWAY_COMPLETIONS_URL ??
    "http://127.0.0.1:8088/v1/chat/completions";
  const gatewayBase =
    params.deps?.gatewayMcpBase?.trim() ||
    resolveGatewayMcpBase(completionsUrl, process.env.GATEWAY_INTERNAL_BASE_URL);
  const reply = params.deps?.requestReply ?? requestMetaReply;
  const { tools, registry } = await collectTools(params.mcpServers, gatewayBase, params.modelHeaders, fetchImpl);
  if (tools.length === 0) {
    const content = await reply(params.messages, {
      gatewayUrl: completionsUrl,
      model: params.model,
      fetchImpl,
      headers: headersForStep(params.modelHeaders, initialTraceStep(params.modelHeaders)),
    });
    return { content, steps: [] };
  }

  const messages: LoopMessage[] = params.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const steps: AgentStep[] = [];
  let step = initialTraceStep(params.modelHeaders);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const turn = await completeTurn({
      completionsUrl,
      fetchImpl,
      headers: params.modelHeaders,
      model: params.model,
      messages,
      tools,
      step,
    });
    step += 1;
    if (turn.toolCalls.length === 0) {
      return { content: finishContent(turn.content), steps };
    }
    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });
    for (const call of turn.toolCalls) {
      const outcome = await runToolCall(call, registry);
      steps.push(outcome.step);
      messages.push({ role: "tool", content: outcome.text, tool_call_id: call.id });
    }
  }

  messages.push({ role: "system", content: LIMIT_NUDGE });
  const finalTurn = await completeTurn({
    completionsUrl,
    fetchImpl,
    headers: params.modelHeaders,
    model: params.model,
    messages,
    step,
  });
  return { content: finishContent(finalTurn.content), steps };
}

async function collectTools(
  servers: Array<{ id: string; name: string }>,
  gatewayBase: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ tools: ChatTool[]; registry: Map<string, BoundTool> }> {
  const tools: ChatTool[] = [];
  const registry = new Map<string, BoundTool>();
  const used = new Set<string>();
  for (const server of servers) {
    const name = server.name.trim();
    if (!name) {
      console.warn("room.agent.mcp_missing", { id: server.id });
      continue;
    }
    const client = new GatewayMcpClient({
      gatewayBase,
      serverName: name,
      headers,
      fetchImpl,
    });
    let listed: GatewayMcpTool[];
    try {
      listed = await client.listTools();
    } catch (error) {
      console.warn("room.agent.mcp_list_failed", {
        id: server.id,
        server: name,
        error: error instanceof Error ? error.message : "list failed",
      });
      continue;
    }
    for (const tool of listed) {
      const encoded = uniqueToolName(encodeGatewayToolName(name, tool.name), used);
      registry.set(encoded, { server: name, tool: tool.name, client });
      tools.push({
        type: "function",
        function: {
          name: encoded,
          description: tool.description ?? "",
          parameters: tool.inputSchema,
        },
      });
    }
  }
  return { tools, registry };
}

async function runToolCall(
  call: ParsedToolCall,
  registry: Map<string, BoundTool>,
): Promise<{ step: AgentStep; text: string }> {
  const bound = registry.get(call.name);
  const started = Date.now();
  let result: GatewayMcpCallResult;
  if (!bound) {
    result = { ok: false, text: UNKNOWN_TOOL };
  } else {
    const parsed = parseToolArguments(call.arguments);
    if (!parsed.ok) {
      result = { ok: false, text: INVALID_ARGS };
    } else {
      result = await bound.client.callTool(bound.tool, parsed.value);
    }
  }
  return {
    text: result.text,
    step: {
      tool: bound?.tool ?? call.name,
      server: bound?.server ?? "",
      ok: result.ok,
      durationMs: Math.max(0, Date.now() - started),
    },
  };
}

async function completeTurn(input: {
  completionsUrl: string;
  fetchImpl: typeof fetch;
  headers: Record<string, string>;
  model: string;
  messages: LoopMessage[];
  tools?: ChatTool[];
  step: number;
}): Promise<{ content: string; toolCalls: ParsedToolCall[] }> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream: false,
    messages: input.messages.map(toWireMessage),
  };
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools;
    body.tool_choice = "auto";
  }
  const response = await input.fetchImpl(input.completionsUrl, {
    method: "POST",
    headers: headersForStep(input.headers, input.step),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`gateway status ${response.status}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }>;
  };
  const message = payload.choices?.[0]?.message;
  return {
    content: messageText(message?.content),
    toolCalls: parseToolCalls(message?.tool_calls),
  };
}

function toWireMessage(message: LoopMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: message.role, content: message.content };
  if (message.tool_calls && message.tool_calls.length > 0) wire.tool_calls = message.tool_calls;
  if (message.tool_call_id) wire.tool_call_id = message.tool_call_id;
  return wire;
}

function parseToolCalls(raw: unknown): ParsedToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ParsedToolCall[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const row = item as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = typeof row.function?.name === "string" ? row.function.name.trim() : "";
    if (!name) return;
    const id = typeof row.id === "string" && row.id.trim() ? row.id : `call_${index + 1}`;
    const args = row.function?.arguments;
    let argumentsText = "";
    if (typeof args === "string") argumentsText = args;
    else if (args && typeof args === "object") argumentsText = JSON.stringify(args);
    calls.push({ id, name, arguments: argumentsText });
  });
  return calls;
}

function parseToolArguments(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  const text = raw.trim();
  if (!text) return { ok: true, value: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const row = part as { type?: unknown; text?: unknown };
    if (row.type === "text" && typeof row.text === "string") parts.push(row.text);
  }
  return parts.join("");
}

function finishContent(raw: string): string {
  if (!raw.trim()) throw new Error("empty gateway content");
  const stripped = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return stripped || raw.trim();
}

function headersForStep(headers: Record<string, string>, step: number): Record<string, string> {
  return {
    ...headers,
    "content-type": "application/json",
    "x-agenticx-trace-step": String(step),
  };
}

function initialTraceStep(headers: Record<string, string>): number {
  const raw = headers["x-agenticx-trace-step"] ?? headers["X-Agenticx-Trace-Step"];
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 1;
}

function sanitizeToolPart(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+/g, "").replace(/_+$/g, "");
  return cleaned.slice(0, TOOL_NAME_MAX) || fallback;
}

function uniqueToolName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let n = 2; n < 10000; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, TOOL_NAME_MAX - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  return base;
}
