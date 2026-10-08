/**
 * 连接器页分桶（纯函数，市场与设置页共用）：
 * - 连接市场 chips：推荐 / 官方 / 企业；
 * - 我的连接 chips：全部 / 自定义连接；
 * - 我的连接卡片：来源徽章（官方 / 企业 / 自定义）、形态（MCP / REST API / 数据库）、状态。
 */

import type { MarketplaceItem } from "../../marketplace/model";
import { connectorMarketSource, findSupplyById, type ConnectorSupplyEntry } from "./connector-supply";
import type { MyConnectionRow } from "./my-connections-model";

export const CONNECTOR_MARKET_BUCKETS = ["recommended", "official", "enterprise"] as const;
export type ConnectorMarketBucket = (typeof CONNECTOR_MARKET_BUCKETS)[number];
export const DEFAULT_CONNECTOR_MARKET_BUCKET: ConnectorMarketBucket = "recommended";

export const MY_CONNECTION_FILTERS = ["all", "custom"] as const;
export type MyConnectionFilter = (typeof MY_CONNECTION_FILTERS)[number];

/** 「推荐」无精选命中时回退：官方已接线前 N 个。 */
const RECOMMENDED_FALLBACK_LIMIT = 8;

function itemSource(item: MarketplaceItem): "official" | "enterprise" {
  if (item.marketSource) return item.marketSource;
  return item.gateway || item.supplyKind === "gateway" ? "enterprise" : "official";
}

/** 连接市场条目（连接器 + 网关精选卡）按 chip 过滤；保持输入顺序（推荐按精选表顺序）。 */
export function filterConnectorMarketItems(
  items: readonly MarketplaceItem[],
  bucket: ConnectorMarketBucket,
  recommendedOrder: readonly string[] = [],
): MarketplaceItem[] {
  const connectorLike = items.filter((it) => it.kind === "connector" || it.gateway === true);
  if (bucket === "official" || bucket === "enterprise") {
    return connectorLike.filter((it) => itemSource(it) === bucket);
  }
  const picked = connectorLike.filter((it) => it.recommended);
  if (picked.length > 0) {
    if (recommendedOrder.length === 0) return picked;
    const rank = (it: MarketplaceItem) => {
      const id = it.gateway && !it.supplyId ? "gateway:connector-runtime" : (it.supplyId ?? "");
      const i = recommendedOrder.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...picked].sort((a, b) => rank(a) - rank(b));
  }
  return connectorLike
    .filter((it) => itemSource(it) === "official" && it.wired !== false)
    .slice(0, RECOMMENDED_FALLBACK_LIMIT);
}

/** 每个 chip 的条目数（chips 上不展示数字，但用于空态与测试）。 */
export function countConnectorMarketBuckets(
  items: readonly MarketplaceItem[],
): Record<ConnectorMarketBucket, number> {
  return {
    recommended: filterConnectorMarketItems(items, "recommended").length,
    official: filterConnectorMarketItems(items, "official").length,
    enterprise: filterConnectorMarketItems(items, "enterprise").length,
  };
}

export type ConnectionSource = "official" | "enterprise" | "custom";
export type ConnectionShapeLabel = "mcp" | "rest" | "database" | null;
export type ConnectionStatus = "connected" | "needs_credential" | "needs_auth" | "invalid";

/**
 * 实例来源：原生 → 官方；网关本身 → 企业；模板实例 → 模板来源；
 * 对话/自定义新建的 MCP、REST、数据库（含 AK/SK、OAuth）→ 自定义。
 */
export function connectionRowSource(
  row: MyConnectionRow,
  supply?: readonly ConnectorSupplyEntry[],
): ConnectionSource {
  if (row.connectorKind === "rest" || row.connectorKind === "database") return "custom";
  if (row.kind === "native") return "official";
  if (row.kind === "gateway") return "enterprise";
  if (row.templateId) {
    const tpl = findSupplyById(row.templateId, supply);
    if (tpl) return connectorMarketSource(tpl);
  }
  return "custom";
}

export function isCustomConnectionRow(row: MyConnectionRow, supply?: readonly ConnectorSupplyEntry[]): boolean {
  return connectionRowSource(row, supply) === "custom";
}

export function filterMyConnectionRows(
  rows: readonly MyConnectionRow[],
  filter: MyConnectionFilter,
  supply?: readonly ConnectorSupplyEntry[],
): MyConnectionRow[] {
  if (filter === "all") return [...rows];
  return rows.filter((r) => isCustomConnectionRow(r, supply));
}

/** 形态标签：只给自定义实例标（官方/企业实例形态对用户无意义）。 */
export function connectionRowShape(row: MyConnectionRow, supply?: readonly ConnectorSupplyEntry[]): ConnectionShapeLabel {
  if (row.connectorKind === "rest") return "rest";
  if (row.connectorKind === "database") return "database";
  if (row.kind === "mcp" && connectionRowSource(row, supply) === "custom") return "mcp";
  return null;
}

/** 卡片状态：已连接 / 待填凭证（REST 无凭证）/ 失效（需重新授权）。 */
export function connectionRowStatus(row: MyConnectionRow): ConnectionStatus {
  if (row.health === "connected") return "connected";
  // 标准 MCP OAuth：未授权 → 待授权（非「失效」）。
  if (row.oauth) return "needs_auth";
  return row.connectorKind === "rest" ? "needs_credential" : "invalid";
}
