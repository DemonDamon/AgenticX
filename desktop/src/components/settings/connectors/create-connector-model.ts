/**
 * 「新建连接器」纯函数：CTA 路由、表单校验、mcp.json 合并载荷。
 * 不依赖 React；持久化由 CreateConnectorModal 调 mcpGetRaw/mcpPutRaw。
 */

import type { ConnectorAuthType } from "./connector-supply";
import { authFormFields, supportsCreateConnectorForm } from "./connector-supply";
import {
  buildRemoteMcpServerPayload,
  getMcpServersMap,
  parseMcpJsonDocument,
  setMcpServersMap,
  withAgenticxConnectorSource,
  type McpJsonDocument,
} from "../../../utils/mcp-remote-config";

export type ConnectorConnectAction = "handshake" | "gateway" | "create_form" | "unwired_sheet";

export type CreateConnectorFormValues = {
  name: string;
  url: string;
  apiKey: string;
  token: string;
};

export type CreateConnectorFormErrors = Partial<Record<keyof CreateConnectorFormValues | "form", string>>;

/** 市场卡片 → Connect CTA 行为。 */
export function resolveConnectorConnectAction(item: {
  kind?: string;
  wired?: boolean;
  gateway?: boolean;
  connectorId?: string;
  authType?: ConnectorAuthType;
}): ConnectorConnectAction {
  if (item.gateway) return "gateway";
  if (item.wired && item.connectorId) return "handshake";
  if (item.wired === false && supportsCreateConnectorForm(item.authType)) return "create_form";
  if (item.wired === false) return "unwired_sheet";
  // wired 无 connectorId（罕见）：仍尝试表单
  if (supportsCreateConnectorForm(item.authType)) return "create_form";
  return "unwired_sheet";
}

/** mcp.json server 名：小写、连字符、去非法字符；纯中文等回退到稳定 hash。 */
export function sanitizeConnectorServerName(raw: string): string {
  const input = String(raw ?? "").trim();
  const base = input
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (base) return base.slice(0, 64);
  if (!input) return "";
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `connector-${Math.abs(h).toString(36)}`.slice(0, 64);
}

export function validateCreateConnectorForm(
  auth: ConnectorAuthType,
  values: CreateConnectorFormValues,
): CreateConnectorFormErrors {
  const fields = new Set(authFormFields(auth));
  const errors: CreateConnectorFormErrors = {};
  const name = values.name.trim();
  if (fields.has("name") && !name) errors.name = "required_name";
  else if (name && !sanitizeConnectorServerName(name)) errors.name = "invalid_name";

  if (fields.has("url")) {
    const url = values.url.trim();
    if (!url) errors.url = "required_url";
    else {
      try {
        const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        if (u.protocol !== "http:" && u.protocol !== "https:") errors.url = "invalid_url";
      } catch {
        errors.url = "invalid_url";
      }
    }
  }
  if (fields.has("api_key") && !values.apiKey.trim()) errors.apiKey = "required_api_key";
  if (fields.has("token") && !values.token.trim()) errors.token = "required_token";
  return errors;
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return t;
  return `https://${t}`;
}

/** 按 auth 组装远程 MCP server 配置（headers 含密钥，勿日志）。 */
export function buildCreateConnectorServerConfig(
  auth: ConnectorAuthType,
  values: CreateConnectorFormValues,
): { serverName: string; config: Record<string, unknown> } {
  const serverName = sanitizeConnectorServerName(values.name);
  const url = normalizeUrl(values.url);
  const headers: Record<string, string> = {};
  if (auth === "api_key" && values.apiKey.trim()) {
    headers.Authorization = `Bearer ${values.apiKey.trim()}`;
  }
  if (auth === "custom_credential" && values.token.trim()) {
    headers.Authorization = `Bearer ${values.token.trim()}`;
  }
  return {
    serverName,
    config: withAgenticxConnectorSource(buildRemoteMcpServerPayload(url, headers)),
  };
}

export type ApplyCreateConnectorResult =
  | { ok: true; text: string; serverName: string; existed: boolean }
  | { ok: false; error: "invalid_json" | "duplicate" | "invalid_form"; errors?: CreateConnectorFormErrors };

/** 合并进 mcp.json 文本；同名默认拒绝（避免静默覆盖）。 */
export function applyCreateConnectorToMcpJson(
  text: string,
  auth: ConnectorAuthType,
  values: CreateConnectorFormValues,
  opts?: { overwrite?: boolean },
): ApplyCreateConnectorResult {
  const errors = validateCreateConnectorForm(auth, values);
  if (Object.keys(errors).length > 0) return { ok: false, error: "invalid_form", errors };
  let doc: McpJsonDocument;
  try {
    doc = parseMcpJsonDocument(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const { serverName, config } = buildCreateConnectorServerConfig(auth, values);
  const servers = getMcpServersMap(doc);
  const existed = Object.prototype.hasOwnProperty.call(servers, serverName);
  if (existed && !opts?.overwrite) return { ok: false, error: "duplicate" };
  servers[serverName] = config;
  return {
    ok: true,
    serverName,
    existed,
    text: `${JSON.stringify(setMcpServersMap(doc, servers), null, 2)}\n`,
  };
}
