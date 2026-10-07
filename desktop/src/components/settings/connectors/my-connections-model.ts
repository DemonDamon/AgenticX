/**
 * 「我的连接」纯函数层：从供给表 + 健康态拼出已连接实例行，并提供 mcp.json 删除合并。
 * 不依赖 React；断开动作由 UI 调现有 logout / disconnectMcp / mcpPutRaw。
 */

import { GATEWAY_DEFAULT_SERVER_NAME } from "../../marketplace/gateway-model";
import {
  isCustomConnectorMcpEntry,
  mcpRemoteHostLabel,
  readAgenticxMcpSource,
  type McpJsonDocument,
  getMcpServersMap,
} from "../../../utils/mcp-remote-config";
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

/** 本机已配置 MCP 的精简元数据，用于「我的连接」自定义远程过滤。 */
export type ConfiguredMcpEntry = {
  name: string;
  url?: string;
  command?: string;
  transport?: string;
  /** mcp.json `_agenticx.source`（若可读）。 */
  agenticxSource?: string;
};

export type BuildMyConnectionsInput = {
  healthByConnectorId: Readonly<Record<string, ConnectorHealth | undefined>>;
  /** native 账号展示（如 GitHub login）。 */
  accountsByConnectorId?: Readonly<Record<string, string | undefined>>;
  /** 本机 mcp.json / 合并状态中的 server 名。 */
  configuredMcpNames: ReadonlySet<string> | readonly string[];
  /**
   * 可选：与 configuredMcpNames 对应的元数据。
   * 有则仅把 connector 来源 / URL 远程算作自定义连接；无元数据的名字不会出现在「我的连接」。
   */
  configuredMcpEntries?: readonly ConfiguredMcpEntry[];
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

/** 从 loadMcpStatus servers 投影为 ConfiguredMcpEntry。 */
export function configuredMcpEntriesFromStatus(
  servers: ReadonlyArray<{
    name?: string;
    url?: string;
    command?: string;
    transport?: string;
  }>,
): ConfiguredMcpEntry[] {
  const out: ConfiguredMcpEntry[] = [];
  for (const s of servers) {
    const name = String(s?.name ?? "").trim();
    if (!name) continue;
    out.push({
      name,
      url: typeof s.url === "string" ? s.url : undefined,
      command: typeof s.command === "string" ? s.command : undefined,
      transport: typeof s.transport === "string" ? s.transport : undefined,
    });
  }
  return out;
}

/** 从 mcp.json 文档投影；带上 `_agenticx.source`。 */
export function configuredMcpEntriesFromDocument(doc: McpJsonDocument): ConfiguredMcpEntry[] {
  const servers = getMcpServersMap(doc);
  const out: ConfiguredMcpEntry[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      out.push({ name: trimmed });
      continue;
    }
    const row = raw as Record<string, unknown>;
    out.push({
      name: trimmed,
      url: typeof row.url === "string" ? row.url : undefined,
      command: typeof row.command === "string" ? row.command : undefined,
      transport: typeof row.transport === "string" ? row.transport : undefined,
      agenticxSource: readAgenticxMcpSource(row),
    });
  }
  return out;
}

/** 按 name 合并；后写覆盖先写的同名字段（非空优先由 merge 逻辑处理）。 */
export function mergeConfiguredMcpEntries(
  ...groups: Array<readonly ConfiguredMcpEntry[] | undefined>
): ConfiguredMcpEntry[] {
  const map = new Map<string, ConfiguredMcpEntry>();
  for (const group of groups) {
    if (!group) continue;
    for (const e of group) {
      const name = String(e.name ?? "").trim();
      if (!name) continue;
      const prev = map.get(name);
      if (!prev) {
        map.set(name, { ...e, name });
        continue;
      }
      map.set(name, {
        name,
        url: e.url || prev.url,
        command: e.command || prev.command,
        transport: e.transport || prev.transport,
        agenticxSource: e.agenticxSource || prev.agenticxSource,
      });
    }
  }
  return Array.from(map.values());
}

/**
 * 仅列出真正有会话/配置的实例：native connected|degraded；gateway 已装；
 * 以及「新建连接器」写入的自定义远程 MCP（带 `_agenticx.source=connector`，
 * 或未打标但具备 http(s) URL 的远程；不含 marketplace/stdio 合并项）。
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

  const entryByName = new Map<string, ConfiguredMcpEntry>();
  for (const e of input.configuredMcpEntries ?? []) {
    const name = String(e.name ?? "").trim();
    if (!name) continue;
    entryByName.set(name, { ...e, name });
  }

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

  // 已占用的 mcp server 名（原生同步项 / 网关）；其余仅在确认为自定义远程时展示。
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
    const meta = entryByName.get(name);
    // 无元数据或非自定义远程（stdio / marketplace）→ 不进「我的连接」
    if (!meta || !isCustomConnectorMcpEntry(meta)) continue;
    if (!matchesQuery(query, name, meta.url, mcpRemoteHostLabel(meta.url))) continue;
    const host = mcpRemoteHostLabel(meta.url);
    rows.push({
      key: `mcp:${name}`,
      supplyId: `mcp:${name}`,
      kind: "mcp",
      name,
      detail: host || name,
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
