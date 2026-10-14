/**
 * 门户访问网关托管 MCP 的 JSON-RPC 客户端。
 *
 * 只走 `POST /mcp/{server}/streamable-http`。这条传输直接收 JSON-RPC，
 * 响应是 `application/json`，不要求先 `initialize`，也不读写 `Mcp-Session-Id`。
 * `notifications/initialized` 在网关侧会回 202 且无正文，本客户端不发送它。
 */

export type GatewayMcpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type GatewayMcpCallResult = { ok: boolean; text: string };

const RESULT_TEXT_LIMIT = 8000;
const DEFAULT_TIMEOUT_MS = 20_000;

type RpcPost = { status: number; body: unknown; timedOut: boolean };

export function resolveGatewayMcpBase(completionsUrl: string, internalBase?: string | null): string {
  const internal = stripGatewayBase(internalBase ?? "");
  if (internal) return internal;
  return stripGatewayBase(completionsUrl);
}

function stripGatewayBase(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1\/chat\/completions$/, "")
    .replace(/\/+$/, "");
}

export class GatewayMcpClient {
  private readonly gatewayBase: string;
  private readonly serverName: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private nextId = 1;

  constructor(opts: {
    gatewayBase: string;
    serverName: string;
    headers: Record<string, string>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.gatewayBase = opts.gatewayBase.replace(/\/+$/, "");
    this.serverName = opts.serverName;
    this.headers = opts.headers;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs =
      typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
        ? opts.timeoutMs
        : DEFAULT_TIMEOUT_MS;
  }

  async listTools(): Promise<GatewayMcpTool[]> {
    const response = await this.post("tools/list");
    if (response.timedOut) throw new Error("mcp list timeout");
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`mcp list failed: HTTP ${response.status}`);
    }
    if (rpcErrorMessage(response.body)) throw new Error("mcp list failed");
    return readToolList(response.body);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<GatewayMcpCallResult> {
    let response: RpcPost;
    try {
      response = await this.post("tools/call", { name, arguments: args });
    } catch {
      return { ok: false, text: "工具调用失败" };
    }
    if (response.timedOut) return { ok: false, text: "工具调用超时" };
    if (response.status === 403) return { ok: false, text: "无权使用该工具" };
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, text: `工具调用失败（HTTP ${response.status}）` };
    }
    const rpcError = rpcErrorMessage(response.body);
    if (rpcError) return { ok: false, text: clipToolText(rpcError) };
    const result = rpcResult(response.body);
    if (!result) return { ok: false, text: "工具调用失败" };
    const isError = result.isError === true;
    return { ok: !isError, text: clipToolText(textFromContent(result.content)) };
  }

  private endpoint(): string {
    return `${this.gatewayBase}/mcp/${encodeURIComponent(this.serverName)}/streamable-http`;
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === "mcp-session-id" || key.toLowerCase() === "x-mcp-session-id") {
        delete headers[key];
      }
    }
    headers["content-type"] = "application/json";
    headers.accept = "application/json";
    return headers;
  }

  private async post(method: string, params?: Record<string, unknown>): Promise<RpcPost> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: this.requestHeaders(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method,
          ...(params ? { params } : {}),
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      return { status: response.status, body: parseBody(raw), timedOut: false };
    } catch (error) {
      if (isAbortError(error)) return { status: 0, body: null, timedOut: true };
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseBody(raw: string): unknown {
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function rpcResult(body: unknown): { content?: unknown; isError?: unknown } | null {
  if (!body || typeof body !== "object") return null;
  const result = (body as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  return result as { content?: unknown; isError?: unknown };
}

function rpcErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "工具调用失败";
}

function readToolList(body: unknown): GatewayMcpTool[] {
  const result = rpcResult(body);
  const tools = result && "tools" in result ? (result as { tools?: unknown }).tools : undefined;
  if (!Array.isArray(tools)) throw new Error("mcp list failed");
  const out: GatewayMcpTool[] = [];
  for (const item of tools) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; description?: unknown; inputSchema?: unknown };
    if (typeof row.name !== "string" || !row.name.trim()) continue;
    const tool: GatewayMcpTool = { name: row.name, inputSchema: asInputSchema(row.inputSchema) };
    if (typeof row.description === "string") tool.description = row.description;
    out.push(tool);
  }
  return out;
}

function asInputSchema(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asInputSchema(JSON.parse(value) as unknown);
    } catch {
      return { type: "object", properties: {} };
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { type: "object", properties: {} };
}

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const row = block as { type?: unknown; text?: unknown };
    if (row.type === "text" && typeof row.text === "string") parts.push(row.text);
  }
  return parts.join("");
}

function clipToolText(text: string): string {
  if (text.length <= RESULT_TEXT_LIMIT) return text;
  return text.slice(0, RESULT_TEXT_LIMIT);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  return name === "AbortError" || name === "TimeoutError";
}
