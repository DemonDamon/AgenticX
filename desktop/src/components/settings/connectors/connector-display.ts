/**
 * 供给条目展示名 / 描述（i18n）：市场卡片、模板列表、「我的连接」共用同一套取名规则。
 */

import { i18n } from "../../../i18n/i18n";
import type { ConnectorSupplyEntry } from "./connector-supply";

export function connectorSupplyDisplay(
  entry: Pick<ConnectorSupplyEntry, "id" | "kind" | "connectorId" | "fallbackName" | "fallbackDescription">,
): { name: string; description: string } {
  if (entry.kind === "gateway") {
    return {
      name: String(i18n.t("gateway.name", { ns: "marketplace", defaultValue: entry.fallbackName })),
      description: String(
        i18n.t("gateway.cardDesc", { ns: "marketplace", defaultValue: entry.fallbackDescription }),
      ),
    };
  }
  if (entry.connectorId) {
    return {
      name: String(
        i18n.t(`connectors.catalog.${entry.connectorId}.name`, {
          ns: "settings",
          defaultValue: entry.fallbackName,
        }),
      ),
      description: String(
        i18n.t(`connectors.catalog.${entry.connectorId}.description`, {
          ns: "settings",
          defaultValue: entry.fallbackDescription,
        }),
      ),
    };
  }
  const key = entry.id.replace(/^stub:/, "");
  return {
    name: String(
      i18n.t(`connectors.supply.${key}.name`, { ns: "marketplace", defaultValue: entry.fallbackName }),
    ),
    description: String(
      i18n.t(`connectors.supply.${key}.description`, {
        ns: "marketplace",
        defaultValue: entry.fallbackDescription,
      }),
    ),
  };
}
