/**
 * 「我的连接」纯函数层：从供给表 + 健康态拼出已连接实例行，并提供 mcp.json 删除合并。
 * 不依赖 React；断开动作由 UI 调现有 logout / disconnectMcp / mcpPutRaw。
 */

import { GATEWAY_DEFAULT_SERVER_NAME } from "../../marketplace/gateway-model";
import type { ConnectorHealth } from "./connector-health";
import {
  CONNECTOR_SUPPLY,
  GATEWAY_SUPPLY_ID,
  listWiredSupply,
  type ConnectorSupplyEntry,
  type ConnectorSupplyKind,
} from "./connector-supply";
import type { ConnectorId } from "./connector-catalog";

export type MyConnectionAction = "native_logout" | "mcp_remove" | "gateway_remove";

export type MyConnectionRow = {
  key: string;
  supplyId: string;
  kind: ConnectorSupplyKind;
  connectorId?: ConnectorId;
  name: string;
  /** 账号或 MCP server 名等次要信息。 */
  detail?: string;
  health: Extract<ConnectorHealth, "connected" | "degraded">;
  action: MyConnectionAction;
  /** 删除 MCP / 网关条目时用的 server 名。 */
  mcpServerName?: string;
  iconSrc?: string;
};

export type BuildMyConnectionsInput = {
  healthByConnectorId: Readonly<Record<string, ConnectorHealth | undefined>>;
  /** native 账号展示（如 GitHub login）。 */
  accountsByConnectorId?: Readonly<Record<string, string | undefined>>;
  /** 本机 mcp.json 已配置的 server 名。 */
  configuredMcpNames: ReadonlySet<string> | readonly string[];
  gatewayInstalled?: boolean;
  supply?: readonly ConnectorSupplyEntry[];
  /** supplyId → 展示名覆盖。 */
  displayNames?: Readonly<Record<string, string>>;
  query?: string;
};

function asNameSet(names: ReadonlySet<string> | readonly string[]): Set<string> {
  if (names instanceof Set) return names;
  return new Set(Array.from(names).map((n) => String(n).trim()).filter(Boolean));
}

function mcpServerForNative(connectorId: ConnectorId): string | undefined {
  if (connectorId === "github" || connectorId === "tapd") return connectorId;
  return undefined;
}

function actionFor(entry: ConnectorSupplyEntry): MyConnectionAction {
  if (entry.kind === "gateway") return "gateway_remove";
  if (entry.connectorId === "tapd") return "mcp_remove";
  if (entry.kind === "native") return "native_logout";
  return "mcp_remove";
}

function matchesQuery(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/**
 * 仅列出真正有会话/配置的实例：native connected|degraded；gateway 已装；
 * 以及 mcp.json 中未归属原生/网关的自定义远程 MCP（「新建连接器」写入）。
 * 不把未接线或完全断开的目录项塞进「我的连接」。
 */
export function buildMyConnectionRows(input: BuildMyConnectionsInput): MyConnectionRow[] {
  const supply = input.supply ?? CONNECTOR_SUPPLY;
  const wired = listWiredSupply(supply);
  const mcpNames = asNameSet(input.configuredMcpNames);
  const gatewayInstalled =
    input.gatewayInstalled ?? mcpNames.has(GATEWAY_DEFAULT_SERVER_NAME);
  const display = input.displayNames ?? {};
  const query = input.query ?? "";
  const rows: MyConnectionRow[] = [];

  for (const entry of wired) {
    if (entry.kind === "gateway") {
      if (!gatewayInstalled) continue;
      const name = display[entry.id] ?? entry.fallbackName;
      if (!matchesQuery(query, name, GATEWAY_DEFAULT_SERVER_NAME)) continue;
      rows.push({
        key: entry.id,
        supplyId: entry.id,
        kind: "gateway",
        name,
        detail: GATEWAY_DEFAULT_SERVER_NAME,
        health: "connected",
        action: actionFor(entry),
        mcpServerName: GATEWAY_DEFAULT_SERVER_NAME,
        iconSrc: entry.iconSrc,
      });
      continue;
    }

    if (entry.kind !== "native" || !entry.connectorId) continue;
    const health = input.healthByConnectorId[entry.connectorId];
    if (health !== "connected" && health !== "degraded") continue;

    const name = display[entry.id] ?? entry.fallbackName;
    const account = input.accountsByConnectorId?.[entry.connectorId];
    const mcpServerName = mcpServerForNative(entry.connectorId);
    const detail = account || mcpServerName;
    if (!matchesQuery(query, name, detail, entry.connectorId)) continue;

    rows.push({
      key: entry.id,
      supplyId: entry.id,
      kind: "native",
      connectorId: entry.connectorId,
      name,
      detail,
      health,
      action: actionFor(entry),
      mcpServerName,
      iconSrc: entry.iconSrc,
    });
  }

  // 已占用的 mcp server 名（原生同步项 / 网关），其余视为用户「新建连接器」自定义远程 MCP。
  const claimedMcp = new Set<string>([GATEWAY_DEFAULT_SERVER_NAME]);
  for (const entry of wired) {
    if (entry.connectorId) {
      const n = mcpServerForNative(entry.connectorId);
      if (n) claimedMcp.add(n);
    }
  }
  for (const r of rows) {
    if (r.mcpServerName) claimedMcp.add(r.mcpServerName);
  }
  for (const name of mcpNames) {
    if (claimedMcp.has(name)) continue;
    if (!matchesQuery(query, name)) continue;
    rows.push({
      key: `mcp:${name}`,
      supplyId: `mcp:${name}`,
      kind: "mcp",
      name,
      detail: name,
      health: "connected",
      action: "mcp_remove",
      mcpServerName: name,
    });
  }

  // Stable order: gateway first, then catalog order from supply, custom MCP last.
  const order = new Map(wired.map((e, i) => [e.id, i]));
  rows.sort((a, b) => {
    const ao = order.has(a.supplyId) ? (order.get(a.supplyId) as number) : 10_000;
    const bo = order.has(b.supplyId) ? (order.get(b.supplyId) as number) : 10_000;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

/** 从 mcp.json 文档删除指定 server（纯函数，不写盘）。 */
export function removeMcpServerFromDocument(
  document: Record<string, unknown>,
  serverName: string,
): { document: Record<string, unknown>; removed: boolean } {
  const name = serverName.trim();
  if (!name) return { document, removed: false };
  const next = { ...document };
  let removed = false;
  const nested = next.mcpServers;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const servers = { ...(nested as Record<string, unknown>) };
    if (Object.prototype.hasOwnProperty.call(servers, name)) {
      delete servers[name];
      next.mcpServers = servers;
      removed = true;
    }
  }
  return { document: next, removed };
}

export function isGatewaySupplyId(id: string): boolean {
  return id === GATEWAY_SUPPLY_ID;
}
