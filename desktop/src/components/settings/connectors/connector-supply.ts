/**
 * 连接器供给表（Task B）：统一声明 native | mcp | gateway 条目与握手类型。
 * 市场「连接器」Tab 与设置墙共用：只把 wired=true 的条目当作可操作卡片；
 * 未接线项默认隐藏，开启「显示尚未接入」后点开只展示说明，不伪造已连接。
 */

import { CONNECTORS, type ConnectorId } from "./connector-catalog";
import { nativeConnectorAvailability } from "../../../../electron/native-connectors-core";

/** 与网关/计划对齐的四种握手。 */
export type ConnectorAuthType = "none" | "api_key" | "custom_credential" | "oauth2";

export type ConnectorSupplyKind = "native" | "mcp" | "gateway";

export type ConnectorSupplyEntry = {
  id: string;
  kind: ConnectorSupplyKind;
  /** 原生目录 id；kind=native 时必填。 */
  connectorId?: ConnectorId;
  auth: ConnectorAuthType;
  /** 本机是否已有真实接线路径（CLI / 安装弹层 / 网关）。 */
  wired: boolean;
  /** i18n key 后缀或固定展示名；市场层用 settings.connectors.catalog.* 或 marketplace.gateway。 */
  nameKey?: string;
  /** 静态中文名兜底（测试与无 i18n 场景）。 */
  fallbackName: string;
  fallbackDescription: string;
  iconSrc?: string;
};

/** 原生握手对照（实施时对照表，不整表伪造 SaaS）。 */
const NATIVE_AUTH: Partial<Record<ConnectorId, ConnectorAuthType>> = {
  "tencent-meeting": "oauth2",
  tapd: "api_key",
  github: "oauth2",
  feishu: "oauth2",
  wecom: "none",
  qqmail: "oauth2",
  gmail: "oauth2",
  notion: "oauth2",
  slack: "oauth2",
  gdrive: "oauth2",
  airtable: "api_key",
  supabase: "api_key",
  bigquery: "oauth2",
};

/** 网关精选供给（安装走 GatewayInstallModal）。 */
export const GATEWAY_SUPPLY_ID = "gateway:connector-runtime";

function nativeEntries(): ConnectorSupplyEntry[] {
  return CONNECTORS.map((c) => {
    const wired = nativeConnectorAvailability(c.id) === "available";
    return {
      id: `native:${c.id}`,
      kind: "native" as const,
      connectorId: c.id,
      auth: NATIVE_AUTH[c.id] ?? "custom_credential",
      wired,
      fallbackName: c.name,
      fallbackDescription: c.description,
      iconSrc: c.iconSrc,
    };
  });
}

export const CONNECTOR_SUPPLY: readonly ConnectorSupplyEntry[] = [
  {
    id: GATEWAY_SUPPLY_ID,
    kind: "gateway",
    auth: "none",
    wired: true,
    fallbackName: "连接器网关",
    fallbackDescription: "搜索即用的动作目录；凭据留在网关侧。",
  },
  ...nativeEntries(),
];

/** 默认市场可见：仅已接线供给。 */
export function listWiredSupply(
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): ConnectorSupplyEntry[] {
  return supply.filter((e) => e.wired);
}

/** 尚未接入（有目录占位但无真实路径）。 */
export function listUnwiredSupply(
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): ConnectorSupplyEntry[] {
  return supply.filter((e) => !e.wired);
}

export function findSupplyById(
  id: string,
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): ConnectorSupplyEntry | undefined {
  return supply.find((e) => e.id === id);
}
