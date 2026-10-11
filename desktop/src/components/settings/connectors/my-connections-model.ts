/**
 * 「我的连接」纯函数层：从供给表 + 健康态拼出已连接实例行，并提供 mcp.json 删除合并。
 * 不依赖 React；断开动作由 UI 调现有 logout / disconnectMcp / mcpPutRaw。
 *
 * 这是连接实例的唯一真相源（SSOT）：市场「我的连接」、设置页、市场卡片已连接态、
 * 对话输入框的连接器弹层都调用 buildMyConnectionRows，保证同一连接器只出现一次：
 * - 同模板 + 同凭证（或未打标的同 URL + 同凭证）的多个 mcp.json 条目折叠为一行；
 * - 模板指向已连接的原生连接器时并入原生行（native / mcp.json 不重复列）；
 * - 展示名重复时追加序号，杜绝两行同名。
 */

import { GATEWAY_DEFAULT_SERVER_NAME, GATEWAY_LOCAL_SERVER_NAME } from "../../marketplace/gateway-model";
import databaseIcon from "../../../assets/connectors/database.svg";
import restApiIcon from "../../../assets/connectors/rest-api.svg";
import {
  extractRemoteMcpServerConfig,
  isConnectorMcpEntry,
  mcpCredentialFingerprint,
  mcpRemoteHostLabel,
  normalizeMcpUrlForCompare,
  readAgenticxConnectorMeta,
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
import type { GatewayRestConnector } from "./gateway-rest-connectors";

export type MyConnectionAction = "native_logout" | "mcp_remove" | "gateway_remove" | "rest_remove";

/** 连接器形态（展示用标签 / 图标）：MCP Server、网关 REST API、数据库直连。 */
export type ConnectorShape = "mcp" | "rest" | "database";

const DB_TYPE_LABELS: Record<string, string> = {
  mysql: "MySQL",
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  sqlite: "SQLite",
};

export function dbTypeLabel(dbType?: string): string {
  const k = String(dbType ?? "").trim().toLowerCase();
  return DB_TYPE_LABELS[k] ?? (k ? k.toUpperCase() : "");
}

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
  /** 折叠进本行的全部 mcp.json server 名（删除时一并移除，避免残留重复）。 */
  mcpServerNames?: string[];
  /** 模板创建的实例：来源模板 id。 */
  templateId?: string;
  iconSrc?: string;
  /** 自定义实例的形态（缺省视为 MCP）。 */
  connectorKind?: ConnectorShape;
  /** connectorKind=database：数据库类型与是否只读。 */
  dbType?: string;
  readOnly?: boolean;
  /** connectorKind=rest：网关里的连接器 id（删除时注销它）。 */
  restConnectorId?: string;
  /** 已知的描述（如 REST 连接器登记时的说明）；缺省由视图层按供给目录取。 */
  description?: string;
  /** mcp.json `oauth: true`：标准 MCP OAuth（未授权时 health=degraded → 待授权）。 */
  oauth?: boolean;
};

/** 本机已配置 MCP 的精简元数据，用于「我的连接」自定义远程过滤。 */
export type ConfiguredMcpEntry = {
  name: string;
  url?: string;
  command?: string;
  transport?: string;
  /** mcp.json `_agenticx.source`（若可读）。 */
  agenticxSource?: string;
  /** mcp.json `_agenticx.templateId`：来源模板。 */
  templateId?: string;
  /** mcp.json `_agenticx.displayName`：用户可读名。 */
  displayName?: string;
  /** headers 凭证指纹（不可逆，仅判重）。 */
  credentialFingerprint?: string;
  /** mcp.json `_agenticx.kind`（如 database）。 */
  connectorKind?: string;
  /** mcp.json `_agenticx.dbType`。 */
  dbType?: string;
  /** mcp.json `_agenticx.createdVia`（连接器助手创建为 chat）。 */
  createdVia?: string;
  /** 数据库连接器：未开启写操作即只读。 */
  readOnly?: boolean;
  /** mcp.json `oauth: true`：走标准 MCP OAuth 2.1（令牌在本机 oauth 目录，不在 mcp.json）。 */
  oauth?: boolean;
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
  /** 本机网关里对话新建的 REST 连接器（每个一行，删除 = 网关注销）。 */
  restConnectors?: readonly GatewayRestConnector[];
  supply?: readonly ConnectorSupplyEntry[];
  /** supplyId → 展示名覆盖。 */
  displayNames?: Readonly<Record<string, string>>;
  /**
   * MCP OAuth 授权态（server 名 → 是否已有令牌，来自主进程 mcpOauthState）。
   * 缺省（未知 / 旧主进程）时 OAuth 条目按已连接展示，不误报待授权。
   */
  oauthAuthorized?: Readonly<Record<string, boolean>>;
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
    const meta = readAgenticxConnectorMeta(row);
    const remote = extractRemoteMcpServerConfig(row);
    const fp = mcpCredentialFingerprint(remote?.headers);
    const env = row.env && typeof row.env === "object" && !Array.isArray(row.env) ? (row.env as Record<string, unknown>) : {};
    const isDb = meta.kind === "database";
    out.push({
      name: trimmed,
      url: typeof row.url === "string" ? row.url : undefined,
      command: typeof row.command === "string" ? row.command : undefined,
      transport: typeof row.transport === "string" ? row.transport : undefined,
      agenticxSource: readAgenticxMcpSource(row),
      ...(meta.templateId ? { templateId: meta.templateId } : {}),
      ...(meta.displayName ? { displayName: meta.displayName } : {}),
      ...(fp ? { credentialFingerprint: fp } : {}),
      ...(meta.kind ? { connectorKind: meta.kind } : {}),
      ...(meta.dbType ? { dbType: meta.dbType } : {}),
      ...(meta.createdVia ? { createdVia: meta.createdVia } : {}),
      ...(row.oauth === true ? { oauth: true } : {}),
      ...(isDb ? { readOnly: !["1", "true", "yes"].includes(String(env.AGX_DB_ALLOW_WRITES ?? "").toLowerCase()) } : {}),
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
        templateId: e.templateId || prev.templateId,
        displayName: e.displayName || prev.displayName,
        credentialFingerprint: e.credentialFingerprint || prev.credentialFingerprint,
        connectorKind: e.connectorKind || prev.connectorKind,
        dbType: e.dbType || prev.dbType,
        createdVia: e.createdVia || prev.createdVia,
        readOnly: e.readOnly ?? prev.readOnly,
        ...(e.oauth || prev.oauth ? { oauth: true } : {}),
      });
    }
  }
  return Array.from(map.values());
}

/**
 * 仅列出真正有会话/配置的连接器实例：native connected|degraded；gateway 已装（含其 REST 连接器）；
 * 以及 mcp.json 中的连接器实例（见 {@link isConnectorMcpEntry}：模板实例、连接器助手创建的 MCP / 数据库）。
 * 通用 MCP Server（手动 / 导入 / 市场安装 / 旧「新建自定义 MCP」）不是连接器，只在 MCP 页展示。
 * 不把未接线或完全断开的目录项塞进「我的连接」。
 */
export function buildMyConnectionRows(input: BuildMyConnectionsInput): MyConnectionRow[] {
  const supply = input.supply ?? CONNECTOR_SUPPLY;
  const wired = listWiredSupply(supply);
  const mcpNames = asNameSet(input.configuredMcpNames);
  const gatewayInstalled =
    input.gatewayInstalled ??
    (mcpNames.has(GATEWAY_DEFAULT_SERVER_NAME) || mcpNames.has(GATEWAY_LOCAL_SERVER_NAME));
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
  const claimedMcp = new Set<string>([GATEWAY_DEFAULT_SERVER_NAME, GATEWAY_LOCAL_SERVER_NAME]);
  for (const entry of wired) {
    if (entry.connectorId) {
      const n = mcpServerForNative(entry.connectorId);
      if (n) claimedMcp.add(n);
    }
  }
  for (const r of rows) {
    if (r.mcpServerName) claimedMcp.add(r.mcpServerName);
  }
  const supplyById = new Map(supply.map((e) => [e.id, e]));
  const rowBySupplyId = new Map(rows.map((r) => [r.supplyId, r]));
  /** 已在线的原生 / 网关供给（与 query 无关），其模板实例不再单列。 */
  const liveSupplyIds = new Set(
    wired
      .filter((e) => {
        if (e.kind === "gateway") return gatewayInstalled;
        if (!e.connectorId) return false;
        const h = input.healthByConnectorId[e.connectorId];
        return h === "connected" || h === "degraded";
      })
      .map((e) => e.id),
  );
  /** 折叠键 → 行：同模板同凭证 / 同端点同凭证只保留一行。 */
  const customByGroup = new Map<string, MyConnectionRow>();
  const customRows: MyConnectionRow[] = [];
  for (const name of mcpNames) {
    if (claimedMcp.has(name)) continue;
    const meta = entryByName.get(name);
    // 无元数据或通用 MCP Server → 不进「我的连接」（在 MCP 页展示）
    if (!meta || !isConnectorMcpEntry(meta)) continue;
    const tpl = meta.templateId ? supplyById.get(meta.templateId) : undefined;
    // 模板即已连接的原生/网关连接器 → 并入原生行，不重复列。
    if (tpl && liveSupplyIds.has(tpl.id)) {
      const nativeRow = rowBySupplyId.get(tpl.id);
      if (nativeRow) {
        nativeRow.mcpServerNames = Array.from(
          new Set([
            ...(nativeRow.mcpServerNames ?? (nativeRow.mcpServerName ? [nativeRow.mcpServerName] : [])),
            name,
          ]),
        );
      }
      continue;
    }
    const fp = meta.credentialFingerprint ?? "";
    const isDb = meta.connectorKind === "database";
    const groupKey = isDb
      ? `db:${name}`
      : meta.templateId
        ? `tpl:${meta.templateId}|${fp}`
        : `url:${normalizeMcpUrlForCompare(meta.url) || `name:${name}`}|${fp}`;
    const dup = customByGroup.get(groupKey);
    if (dup) {
      dup.mcpServerNames = [...(dup.mcpServerNames ?? []), name];
      continue;
    }
    const host = mcpRemoteHostLabel(meta.url);
    const tplName = tpl ? display[tpl.id] ?? tpl.fallbackName : undefined;
    const row: MyConnectionRow = {
      key: `mcp:${name}`,
      supplyId: meta.templateId ?? `mcp:${name}`,
      kind: "mcp",
      name: meta.displayName || tplName || name,
      detail: isDb ? dbTypeLabel(meta.dbType) || name : host || name,
      health: meta.oauth && input.oauthAuthorized && !input.oauthAuthorized[name] ? "degraded" : "connected",
      ...(meta.oauth ? { oauth: true } : {}),
      action: "mcp_remove",
      mcpServerName: name,
      mcpServerNames: [name],
      ...(meta.templateId && !isDb ? { templateId: meta.templateId } : {}),
      ...(tpl?.iconSrc ? { iconSrc: tpl.iconSrc } : {}),
      ...(isDb
        ? { connectorKind: "database" as const, iconSrc: databaseIcon, dbType: meta.dbType, readOnly: meta.readOnly ?? true }
        : {}),
    };
    customByGroup.set(groupKey, row);
    customRows.push(row);
  }
  for (const row of customRows) {
    const meta = entryByName.get(row.mcpServerName ?? "");
    const tplName = row.templateId ? display[row.templateId] ?? supplyById.get(row.templateId)?.fallbackName : undefined;
    if (
      !matchesQuery(
        query,
        row.name,
        row.mcpServerName,
        meta?.url,
        mcpRemoteHostLabel(meta?.url),
        tplName,
      )
    ) {
      continue;
    }
    rows.push(row);
  }

  // 网关 REST 连接器：每个一行；对话里经网关 MCP 使用，所以开关绑定网关 server。
  const gatewayServer = mcpNames.has(GATEWAY_LOCAL_SERVER_NAME) ? GATEWAY_LOCAL_SERVER_NAME : GATEWAY_DEFAULT_SERVER_NAME;
  const seenRest = new Set<string>();
  for (const rc of input.restConnectors ?? []) {
    const id = String(rc.id ?? "").trim();
    if (!id || seenRest.has(id)) continue;
    seenRest.add(id);
    const host = mcpRemoteHostLabel(rc.baseUrl);
    if (!matchesQuery(query, rc.name, id, rc.baseUrl, host)) continue;
    rows.push({
      key: `rest:${id}`,
      supplyId: `rest:${id}`,
      kind: "gateway",
      name: rc.name || id,
      detail: host || id,
      health: rc.hasCredential ? "connected" : "degraded",
      action: "rest_remove",
      mcpServerName: gatewayServer,
      connectorKind: "rest",
      restConnectorId: id,
      ...(rc.description ? { description: rc.description } : {}),
      iconSrc: restApiIcon,
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
  return dedupeRowNames(rows);
}

/** 同名行追加序号（「轻流的连接器」「轻流的连接器 (2)」），保证展示名唯一。 */
function dedupeRowNames(rows: MyConnectionRow[]): MyConnectionRow[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const k = row.name.trim().toLowerCase();
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return n === 1 ? row : { ...row, name: `${row.name} (${n})` };
  });
}

/** 已有实例的模板 / 供给 id 集合（市场卡片「已连接」与「新建」去重共用）。 */
export function connectedSupplyIds(rows: readonly MyConnectionRow[]): Set<string> {
  return new Set(rows.map((r) => r.supplyId));
}

/** 某模板 / 供给的已有实例（去重后至多一行；多凭证时取第一行）。 */
export function findConnectionForSupply(
  rows: readonly MyConnectionRow[],
  supplyId: string | undefined,
): MyConnectionRow | undefined {
  if (!supplyId) return undefined;
  return rows.find((r) => r.supplyId === supplyId);
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

/**
 * 通用 MCP Server 名（不是连接器）：插件市场 MCP 页「已添加」展示用。
 * 排除网关、原生连接器同步的 server（github / tapd）与 {@link isConnectorMcpEntry} 认定的连接器实例。
 */
export function listPlainMcpServerNames(
  configuredMcpNames: ReadonlySet<string> | readonly string[],
  configuredMcpEntries: readonly ConfiguredMcpEntry[] = [],
): string[] {
  const byName = new Map<string, ConfiguredMcpEntry>();
  for (const e of configuredMcpEntries) {
    const name = String(e.name ?? "").trim();
    if (name) byName.set(name, e);
  }
  const claimed = new Set<string>([GATEWAY_DEFAULT_SERVER_NAME, GATEWAY_LOCAL_SERVER_NAME]);
  for (const e of listWiredSupply(CONNECTOR_SUPPLY)) {
    const n = e.connectorId ? mcpServerForNative(e.connectorId) : undefined;
    if (n) claimed.add(n);
  }
  const out = new Set<string>();
  for (const raw of [...asNameSet(configuredMcpNames), ...byName.keys()]) {
    const name = String(raw).trim();
    if (!name || claimed.has(name)) continue;
    const meta = byName.get(name);
    if (meta && isConnectorMcpEntry(meta)) continue;
    out.add(name);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}
