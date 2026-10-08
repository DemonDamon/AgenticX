/**
 * 连接器页（唯一视图实现）：顶部「连接市场 | 我的连接」两个 Tab，右侧搜索 +「新建连接器」。
 * - 连接市场：chips「推荐 / 官方 / 企业」（默认推荐），卡片复用市场 UnifiedGrid；
 * - 我的连接：chips「全部 / 自定义连接」，Comate 风格 2 列卡片（MyConnectionsGrid）。
 * 市场「连接器」Tab 与设置「连接器」页都渲染本组件；数据与弹层来自 useConnectorsController。
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { FilterChips } from "../../marketplace/FilterChips";
import { UnifiedGrid } from "../../marketplace/UnifiedGrid";
import { filterUnifiedItems } from "../../marketplace/model";
import type { ConnectorId } from "./connector-catalog";
import {
  CONNECTOR_MARKET_BUCKETS,
  filterConnectorMarketItems,
  filterMyConnectionRows,
  MY_CONNECTION_FILTERS,
  type ConnectorMarketBucket,
  type MyConnectionFilter,
} from "./connector-buckets";
import { RECOMMENDED_SUPPLY_IDS } from "./connector-supply";
import { MyConnectionsGrid } from "./MyConnectionsGrid";
import type { MyConnectionRow } from "./my-connections-model";
import { NewConnectorButton } from "./NewConnectorButton";
import type { ConnectorsController, ConnectorsPane } from "./useConnectorsController";

type Props = {
  ctl: ConnectorsController;
  /** 宿主顶栏已有搜索时传入（受控）；缺省则本组件在 Tab 行右侧渲染搜索框。 */
  query?: string;
  /** 宿主顶栏已有「新建连接器」时置 false。 */
  showNewButton?: boolean;
  className?: string;
};

function matchesRow(row: MyConnectionRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [row.name, row.detail, row.mcpServerName, row.dbType].some((f) => (f ?? "").toLowerCase().includes(needle));
}

export function ConnectorsHub({ ctl, query, showNewButton = true, className = "" }: Props) {
  const { t } = useTranslation("marketplace");
  const [ownQuery, setOwnQuery] = useState("");
  const q = query ?? ownQuery;

  const marketItems = useMemo(() => {
    const all = filterUnifiedItems([ctl.gatewayItem, ...ctl.connectorItems], "connector", q);
    return filterConnectorMarketItems(all, ctl.marketBucket, RECOMMENDED_SUPPLY_IDS);
  }, [ctl.gatewayItem, ctl.connectorItems, ctl.marketBucket, q]);

  const mineRows = useMemo(
    () => filterMyConnectionRows(ctl.rows.filter((r) => matchesRow(r, q)), ctl.mineFilter),
    [ctl.rows, ctl.mineFilter, q],
  );

  const tabs: { id: ConnectorsPane; label: string }[] = [
    { id: "market", label: t("connectors.hub.tabs.market") },
    { id: "mine", label: t("connectors.hub.tabs.mine") },
  ];

  return (
    <div className={`space-y-4 ${className}`} data-connectors-hub={ctl.pane}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div role="tablist" aria-label={t("connectors.hub.title")} className="flex items-center gap-5">
          {tabs.map((tab) => {
            const active = ctl.pane === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-connectors-tab={tab.id}
                className={`-mb-px border-b-2 px-0.5 pb-2 pt-1 text-[14px] transition-colors ${
                  active
                    ? "border-[rgb(var(--theme-color-rgb,59,130,246))] font-semibold text-text-strong"
                    : "border-transparent text-text-muted hover:text-text-strong"
                }`}
                onClick={() => ctl.setPane(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="mb-2 flex min-w-0 items-center gap-2">
          {query === undefined ? (
            <div className="relative w-56 max-w-[40vw]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface-card py-1.5 pl-8 pr-3 text-[13px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
                placeholder={t("connectors.hub.searchPlaceholder")}
                aria-label={t("connectors.hub.searchPlaceholder")}
                value={ownQuery}
                onChange={(e) => setOwnQuery(e.target.value)}
              />
            </div>
          ) : null}
          {showNewButton ? (
            <NewConnectorButton
              connections={ctl.rows}
              onFromChat={(draft) => ctl.startChat(draft)}
              onOpenHandshake={(id: ConnectorId) => ctl.openHandshake(id)}
              onUseConnection={ctl.chatWithConnection}
              onChanged={ctl.onChanged}
            />
          ) : null}
        </div>
      </div>

      {ctl.status ? (
        <div
          className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-card px-3 py-2 text-xs leading-relaxed ${
            ctl.status.kind === "error"
              ? "text-rose-400"
              : ctl.status.kind === "success"
                ? "text-emerald-400"
                : "text-text-muted"
          }`}
          role="status"
          aria-live="polite"
        >
          {ctl.status.message}
        </div>
      ) : null}

      {ctl.pane === "market" ? (
        <>
          <FilterChips
            tags={CONNECTOR_MARKET_BUCKETS}
            active={ctl.marketBucket}
            onSelect={(tag) => ctl.setMarketBucket(tag as ConnectorMarketBucket)}
            labels={{
              recommended: t("connectors.hub.marketChips.recommended"),
              official: t("connectors.hub.marketChips.official"),
              enterprise: t("connectors.hub.marketChips.enterprise"),
            }}
            ariaLabel={t("connectors.hub.tabs.market")}
          />
          {marketItems.length === 0 ? (
            <div className="py-14 text-center text-sm text-text-faint" data-connectors-empty="market">
              {t("connectors.hub.emptyMarket")}
            </div>
          ) : (
            <UnifiedGrid
              items={marketItems}
              promptBusy={false}
              onOpenMcpDetail={(item) => {
                if (item.gateway) ctl.openGateway();
              }}
              onInstallSkill={() => undefined}
              onUse={ctl.chatWithMarketItem}
              onConnectNative={(item) => {
                if (item.connectorId) ctl.openHandshake(item.connectorId as ConnectorId);
              }}
              onCreateConnector={ctl.openCreate}
              onUnwiredConnector={ctl.openUnwired}
              onUseConnector={ctl.chatWithMarketItem}
            />
          )}
        </>
      ) : (
        <>
          <FilterChips
            tags={MY_CONNECTION_FILTERS}
            active={ctl.mineFilter}
            onSelect={(tag) => ctl.setMineFilter(tag as MyConnectionFilter)}
            labels={{
              all: t("connectors.hub.mineChips.all"),
              custom: t("connectors.hub.mineChips.custom"),
            }}
            ariaLabel={t("connectors.hub.tabs.mine")}
          />
          <MyConnectionsGrid
            ctl={ctl}
            rows={mineRows}
            emptyText={
              q.trim()
                ? t("connectors.hub.emptySearch")
                : ctl.mineFilter === "custom"
                  ? t("connectors.hub.emptyMineCustom")
                  : t("connectors.hub.emptyMineAll")
            }
          />
        </>
      )}
    </div>
  );
}
