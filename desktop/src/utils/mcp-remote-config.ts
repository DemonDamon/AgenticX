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

/** 「新建连接器」写入 `_agenticx` 的可选元数据（不含密钥）。 */
export type AgenticxConnectorMeta = {
  /** 来源模板（CONNECTOR_SUPPLY.id，如 `stub:qingflow`）；用于同模板去重。 */
  templateId?: string;
  /** 用户可读名（server 名可能是 slug / hash）。 */
  displayName?: string;
  /** 连接器形态：缺省为 MCP；对话新建的数据库直连为 `database`。 */
  kind?: string;
  /** kind=database 时的数据库类型（mysql / postgresql / sqlite）。 */
  dbType?: string;
  /** 创建途径：连接器助手 connector_manage 写 `chat`。 */
  createdVia?: string;
  /** 凭证位置（与 Python connectors_store 对齐）：query 时密钥在 URL 查询参数 `authQuery`。 */
  authStyle?: string;
  authQuery?: string;
  /** authStyle=header 时的自定义请求头名（如 `x-api-key`）。 */
  authHeader?: string;
  /** authStyle=headers 时的多自定义头名（Comate 双字段凭证）。 */
  authHeaders?: string[];
};

/** Stamp a remote MCP payload as created via Near「新建连接器」. */
export function withAgenticxConnectorSource(
  config: Record<string, unknown>,
  meta?: AgenticxConnectorMeta,
): Record<string, unknown> {
  const prev = config[AGENTICX_MCP_META_KEY];
  const prevObj =
    prev && typeof prev === "object" && !Array.isArray(prev)
      ? (prev as Record<string, unknown>)
      : {};
  const extra: Record<string, unknown> = {};
  const templateId = String(meta?.templateId ?? "").trim();
  const displayName = String(meta?.displayName ?? "").trim();
  if (templateId) extra.templateId = templateId;
  if (displayName) extra.displayName = displayName;
  const authStyle = String(meta?.authStyle ?? "").trim();
  const authQuery = String(meta?.authQuery ?? "").trim();
  if (authStyle) extra.authStyle = authStyle;
  if (authStyle === "query" && authQuery) extra.authQuery = authQuery;
  const authHeader = String(meta?.authHeader ?? "").trim();
  if (authStyle === "header" && authHeader) extra.authHeader = authHeader;
  const authHeaders = (meta?.authHeaders ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);
  if (authStyle === "headers" && authHeaders.length > 0) extra.authHeaders = authHeaders;
  return {
    ...config,
    [AGENTICX_MCP_META_KEY]: { ...prevObj, ...extra, source: AGENTICX_MCP_SOURCE_CONNECTOR },
  };
}

/** 读取 `_agenticx` 中的模板 / 展示名元数据。 */
export function readAgenticxConnectorMeta(raw: unknown): AgenticxConnectorMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const meta = (raw as Record<string, unknown>)[AGENTICX_MCP_META_KEY];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const m = meta as Record<string, unknown>;
  const out: AgenticxConnectorMeta = {};
  if (typeof m.templateId === "string" && m.templateId.trim()) out.templateId = m.templateId.trim();
  if (typeof m.displayName === "string" && m.displayName.trim()) out.displayName = m.displayName.trim();
  if (typeof m.kind === "string" && m.kind.trim()) out.kind = m.kind.trim();
  if (typeof m.dbType === "string" && m.dbType.trim()) out.dbType = m.dbType.trim();
  if (typeof m.createdVia === "string" && m.createdVia.trim()) out.createdVia = m.createdVia.trim();
  return out;
}

/** URL 比较用归一化：小写 host、去尾斜杠、去默认协议差异。 */
export function normalizeMcpUrlForCompare(url?: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

/**
 * 凭证指纹（不可逆短 hash，只用于「同一凭证 / 同一身份」判重，不用于鉴权）。
 * 取 Authorization / *token* / *key* 类 header 值；无凭证返回空串。
 */
export function mcpCredentialFingerprint(headers?: Record<string, unknown> | null): string {
  if (!headers || typeof headers !== "object") return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const key = k.trim().toLowerCase();
    if (key === "authorization" || /token|key|secret/.test(key)) {
      parts.push(`${key}=${v.trim()}`);
    }
  }
  if (parts.length === 0) return "";
  parts.sort();
  const input = parts.join("\n");
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) | 0;
    h2 = ((h2 << 5) + h2 + c * 31) | 0;
  }
  return `fp-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export function readAgenticxMcpSource(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const meta = (raw as Record<string, unknown>)[AGENTICX_MCP_META_KEY];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const source = (meta as Record<string, unknown>).source;
  return typeof source === "string" && source.trim() ? source.trim() : undefined;
}

/**
 * 去重候选：打过 `source=connector` 标的条目，或任意 http(s) 远程（含通用 MCP）。
 * 只用于「同端点 + 同凭证 / 同名」判重（避免重复建同一连接），**不**决定是否展示为连接器——
 * 展示口径见 {@link isConnectorMcpEntry}。Stdio（command/args）返回 false。
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

/**
 * mcp.json 条目是否算「连接器」（进「我的连接」/ 对话连接器弹层 / 市场已连接态）：
 * - 来自连接器目录模板的实例（`_agenticx.templateId`，含模板背后的 MCP / CLI）；
 * - 连接器助手 connector_manage 显式创建的（`source=connector` 且 `createdVia` 或 `kind=database`）。
 * 通用 MCP Server（手动添加 / 导入 / 市场安装 / 旧「新建自定义 MCP」打过 source 标的）都不算，
 * 只在 MCP 页展示。原生连接器与网关（含 REST）由各自的供给行处理，不经此判断。
 */
export function isConnectorMcpEntry(entry: {
  agenticxSource?: string;
  templateId?: string;
  connectorKind?: string;
  createdVia?: string;
}): boolean {
  if (String(entry.templateId ?? "").trim()) return true;
  if (entry.agenticxSource !== AGENTICX_MCP_SOURCE_CONNECTOR) return false;
  return entry.connectorKind === "database" || Boolean(String(entry.createdVia ?? "").trim());
}

/** Raw mcp.json entry variant of {@link isConnectorMcpEntry}. */
export function isConnectorMcpConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const meta = readAgenticxConnectorMeta(raw);
  return isConnectorMcpEntry({
    agenticxSource: readAgenticxMcpSource(raw),
    templateId: meta.templateId,
    connectorKind: meta.kind,
    createdVia: meta.createdVia,
  });
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
