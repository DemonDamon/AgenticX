/** Helpers for reading/writing remote MCP entries in mcp.json (no secrets in localStorage). */

/** 主 MCP 配置路径(设置页、市场本地直写共用的单一来源)。 */
export const MCP_PRIMARY_CONFIG_PATH = "~/.agenticx/mcp.json";

export type McpJsonDocument = Record<string, unknown> & {
  mcpServers?: Record<string, unknown>;
};

export type RemoteMcpServerConfig = {
  url: string;
  headers: Record<string, string>;
  timeout?: number;
};

export function parseMcpJsonDocument(text: string): McpJsonDocument {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置文件必须是 JSON 对象");
  }
  return parsed as McpJsonDocument;
}

export function getMcpServersMap(doc: McpJsonDocument): Record<string, unknown> {
  const nested = doc.mcpServers;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>) };
  }
  return {};
}

export function setMcpServersMap(doc: McpJsonDocument, servers: Record<string, unknown>): McpJsonDocument {
  return { ...doc, mcpServers: servers };
}

export function extractRemoteMcpServerConfig(raw: unknown): RemoteMcpServerConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (!url) return null;
  const headers: Record<string, string> = {};
  if (row.headers && typeof row.headers === "object" && !Array.isArray(row.headers)) {
    for (const [k, v] of Object.entries(row.headers as Record<string, unknown>)) {
      if (typeof v === "string" && k.trim()) headers[k.trim()] = v;
    }
  }
  const timeout =
    typeof row.timeout === "number" && Number.isFinite(row.timeout) ? row.timeout : undefined;
  return { url, headers, timeout };
}

export function buildRemoteMcpServerPayload(
  url: string,
  headers: Record<string, string>,
  timeout?: number,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { url: url.trim() };
  const cleanedHeaders = Object.fromEntries(
    Object.entries(headers)
      .map(([k, v]) => [k.trim(), v] as const)
      .filter(([k, v]) => k && v),
  );
  if (Object.keys(cleanedHeaders).length > 0) {
    payload.headers = cleanedHeaders;
  }
  if (timeout !== undefined && Number.isFinite(timeout) && timeout > 0) {
    payload.timeout = timeout;
  }
  return payload;
}

export const AGENTICX_MCP_META_KEY = "_agenticx" as const;
export const AGENTICX_MCP_SOURCE_CONNECTOR = "connector" as const;

/** Stamp a remote MCP payload as created via Near「新建连接器」. */
export function withAgenticxConnectorSource(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const prev = config[AGENTICX_MCP_META_KEY];
  const prevObj =
    prev && typeof prev === "object" && !Array.isArray(prev)
      ? (prev as Record<string, unknown>)
      : {};
  return {
    ...config,
    [AGENTICX_MCP_META_KEY]: { ...prevObj, source: AGENTICX_MCP_SOURCE_CONNECTOR },
  };
}

export function readAgenticxMcpSource(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const meta = (raw as Record<string, unknown>)[AGENTICX_MCP_META_KEY];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const source = (meta as Record<string, unknown>).source;
  return typeof source === "string" && source.trim() ? source.trim() : undefined;
}

/**
 * True for「新建连接器」tagged entries, or untagged http(s) URL remotes (migration).
 * Stdio marketplace / Cursor/`extra_search_paths` imports (command/args) return false.
 */
export function isCustomConnectorMcpConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  if (readAgenticxMcpSource(row) === AGENTICX_MCP_SOURCE_CONNECTOR) return true;
  const command = typeof row.command === "string" ? row.command.trim() : "";
  if (command) return false;
  const url = typeof row.url === "string" ? row.url.trim() : "";
  return Boolean(url && /^https?:\/\//i.test(url));
}

/** Status-row / entry-shaped variant of {@link isCustomConnectorMcpConfig}. */
export function isCustomConnectorMcpEntry(entry: {
  url?: string;
  command?: string;
  transport?: string;
  agenticxSource?: string;
}): boolean {
  if (entry.agenticxSource === AGENTICX_MCP_SOURCE_CONNECTOR) return true;
  const command = String(entry.command ?? "").trim();
  if (command) return false;
  const url = String(entry.url ?? "").trim();
  if (url && /^https?:\/\//i.test(url)) return true;
  const transport = String(entry.transport ?? "").trim();
  return transport === "sse" || transport === "streamable_http";
}

export function mcpTransportBadgeLabel(transport?: string): string {
  if (transport === "sse") return "SSE";
  if (transport === "streamable_http") return "Streamable HTTP";
  return "stdio";
}

export function mcpRemoteHostLabel(url?: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).host;
  } catch {
    return raw.length > 48 ? `${raw.slice(0, 45)}…` : raw;
  }
}

export function headerKeysOnly(headers: Record<string, string>): string[] {
  return Object.keys(headers).filter(Boolean).sort();
}
