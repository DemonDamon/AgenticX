/**
 * 连接器网关纯函数层:URL 规范化、MCP server 配置构建、
 * mcp.json 合并写入与市场精选卡条目。不依赖 React / bridge,便于单测;
 * 弹层编排(读写配置文件、拉起 sidecar、刷新名册)见 GatewayInstallModal。
 */

import {
  buildRemoteMcpServerPayload,
  getMcpServersMap,
  parseMcpJsonDocument,
  setMcpServersMap,
} from "../../utils/mcp-remote-config";
import { isMcpInstalled, type MarketplaceItem } from "./model";

/** 网关安装形态:内置 sidecar 一键装 vs 自建(填 URL + 可选 token)。 */
export type GatewayFormMode = "builtin" | "self";

/**
 * 安装弹层表单:
 * - builtin 形态 url/token 由 sidecar 就绪信息动态填充(见 buildBuiltinGatewayForm);
 * - self 形态由用户填写。
 */
export type GatewayForm = {
  mode: GatewayFormMode;
  url: string;
  token: string;
  serverName: string;
};

/** 默认写入 mcp.json 的 server 名(已装判定与覆盖提示都按它匹配)。 */
export const GATEWAY_DEFAULT_SERVER_NAME = "connector-runtime";

/** 市场精选卡的 serverId 特例标记(区别于上游市场条目,详情走网关弹层)。 */
export const GATEWAY_MARKET_SERVER_ID = "connector-runtime-gateway";

/** 由 sidecar 就绪信息构建内置形态表单(url 指向本机 /mcp 端点)。 */
export function buildBuiltinGatewayForm(port: number, runtimeToken: string): GatewayForm {
  return {
    mode: "builtin",
    url: `http://127.0.0.1:${port}/mcp`,
    token: runtimeToken,
    serverName: GATEWAY_DEFAULT_SERVER_NAME,
  };
}

/**
 * 规范化网关端点 URL:
 * - 去首尾空白与尾部斜杠;无协议默认补 https://;
 * - 仅接受 http(s);路径为空或仅 / 时补 /mcp 后缀(网关端点约定);
 * - 无法解析返回 null。
 */
export function normalizeGatewayUrl(raw: string): string | null {
  let candidate = String(raw ?? "").trim();
  if (!candidate) return null;
  while (candidate.endsWith("/")) candidate = candidate.slice(0, -1);
  if (!candidate) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) candidate = `https://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.pathname || parsed.pathname === "/") parsed.pathname = "/mcp";
  return parsed.toString();
}

/** 解析表单里的 server 名:去空白,空则回落默认名。 */
export function resolveGatewayServerName(form: GatewayForm): string {
  const trimmed = String(form.serverName ?? "").trim();
  return trimmed || GATEWAY_DEFAULT_SERVER_NAME;
}

export type GatewayServerConfigResult =
  | { ok: true; serverName: string; config: Record<string, unknown> }
  | { ok: false; error: "invalid_url" };

/**
 * 构建单 server 的 mcpServers 配置(streamable-http)。
 * token 非空才写入 Authorization header;复用设置页的 payload 构建器保持格式一致。
 */
export function buildGatewayServerConfig(form: GatewayForm): GatewayServerConfigResult {
  const url = normalizeGatewayUrl(form.url);
  if (!url) return { ok: false, error: "invalid_url" };
  const token = String(form.token ?? "").trim();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return {
    ok: true,
    serverName: resolveGatewayServerName(form),
    config: buildRemoteMcpServerPayload(url, headers),
  };
}

export type ApplyGatewayResult =
  | { ok: true; text: string; serverName: string; existed: boolean }
  | { ok: false; error: "invalid_url" | "invalid_json" };

/**
 * 把网关 server 条目合并进当前 mcp.json 文本:
 * 保留既有 server 与其他顶层键,同名覆盖(existed 标记),输出带尾换行的格式化 JSON。
 */
export function applyGatewayToMcpJson(text: string, form: GatewayForm): ApplyGatewayResult {
  let doc: ReturnType<typeof parseMcpJsonDocument>;
  try {
    doc = parseMcpJsonDocument(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const built = buildGatewayServerConfig(form);
  if (!built.ok) return built;
  const servers = getMcpServersMap(doc);
  const existed = Object.prototype.hasOwnProperty.call(servers, built.serverName);
  servers[built.serverName] = built.config;
  return {
    ok: true,
    serverName: built.serverName,
    existed,
    text: `${JSON.stringify(setMcpServersMap(doc, servers), null, 2)}\n`,
  };
}

/** 网关已装判定:按 server 名与本机名册做大小写不敏感匹配(复用市场 isMcpInstalled)。 */
export function isGatewayInstalled(
  configured: ReadonlySet<string>,
  serverName: string = GATEWAY_DEFAULT_SERVER_NAME,
): boolean {
  return isMcpInstalled([serverName], configured);
}

/** 精选卡展示输入(文案由视图层经 i18n 传入,保持本层纯净)。 */
export type GatewayMarketItemDisplay = {
  name: string;
  description: string;
  provider?: string;
  installed: boolean;
  iconSrc?: string;
};

/** 市场精选卡条目:kind=mcp + gateway 特例标记,安装/查看走网关弹层而非上游详情。 */
export function buildGatewayMarketItem(display: GatewayMarketItemDisplay): MarketplaceItem {
  return {
    key: `mcp:${GATEWAY_MARKET_SERVER_ID}`,
    kind: "mcp",
    name: display.name,
    description: display.description,
    installed: display.installed,
    provider: display.provider,
    serverId: GATEWAY_MARKET_SERVER_ID,
    gateway: true,
    iconSrc: display.iconSrc,
  };
}
