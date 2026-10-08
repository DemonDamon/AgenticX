/**
 * 连接器页控制器（市场「连接器」Tab 与设置「连接器」页唯一实现）：
 * 健康态探活、我的连接 SSOT（含网关 REST 连接器）、市场目录条目、握手 / 新建 / 网关 / 未接线弹层。
 * 视图层见 ConnectorsHub；宿主只负责提供本机 MCP 名册与「进入对话」。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import gatewayIcon from "../../../assets/connectors/gateway.svg";
import { MCP_PRIMARY_CONFIG_PATH } from "../../../utils/mcp-remote-config";
import {
  buildGatewayMarketItem,
  GATEWAY_DEFAULT_SERVER_NAME,
  GATEWAY_LOCAL_SERVER_NAME,
  isGatewayInstalled,
} from "../../marketplace/gateway-model";
import { GatewayInstallModal } from "../../marketplace/GatewayInstallModal";
import { buildConnectorSupplyItems, type MarketplaceItem } from "../../marketplace/model";
import type { ConnectorId } from "./connector-catalog";
import { connectorSupplyDisplay } from "./connector-display";
import type { ConnectorHealth } from "./connector-health";
import { CONNECTOR_SUPPLY, GATEWAY_SUPPLY_ID, listCatalogSupply, listWiredSupply } from "./connector-supply";
import type { ConnectorMarketBucket, MyConnectionFilter } from "./connector-buckets";
import { DEFAULT_CONNECTOR_MARKET_BUCKET } from "./connector-buckets";
import { ConnectorsTab } from "./ConnectorsTab";
import { CreateConnectorModal, type CreateConnectorTarget } from "./CreateConnectorModal";
import { useGatewayRestConnectors, type GatewayRestConnector } from "./gateway-rest-connectors";
import {
  buildMyConnectionRows,
  connectedSupplyIds,
  findConnectionForSupply,
  type ConfiguredMcpEntry,
  type MyConnectionRow,
} from "./my-connections-model";

type Health = Exclude<ConnectorHealth, undefined> | "unwired";

export type ConnectorsPane = "market" | "mine";

export type ConnectorsControllerInput = {
  sessionId: string;
  configuredMcpNames: ReadonlySet<string> | readonly string[];
  configuredMcpEntries: readonly ConfiguredMcpEntry[];
  /** 刷新本机 MCP 名册（mcp.json + 状态）。 */
  reloadMcp: () => Promise<void> | void;
  /** 进入对话并预填草稿（宿主负责关设置 / 切主视图）。 */
  startChat: (draft: string) => void;
  /** 新建 / 删除成功后额外通知宿主（如切到连接器 Tab）。 */
  onAfterChange?: () => void;
};

export type ConnectorsController = {
  sessionId: string;
  rows: MyConnectionRow[];
  restConnectors: GatewayRestConnector[];
  healthById: Record<string, Health>;
  accountsById: Record<string, string | undefined>;
  gatewayInstalled: boolean;
  gatewayItem: MarketplaceItem;
  connectorItems: MarketplaceItem[];
  pane: ConnectorsPane;
  setPane: (p: ConnectorsPane) => void;
  marketBucket: ConnectorMarketBucket;
  setMarketBucket: (b: ConnectorMarketBucket) => void;
  mineFilter: MyConnectionFilter;
  setMineFilter: (f: MyConnectionFilter) => void;
  status: { message: string; kind: "info" | "success" | "error" } | null;
  setStatus: (s: ConnectorsController["status"]) => void;
  refresh: () => Promise<void>;
  /** 新建 / 更新完成：提示 + 刷新 + 切到「我的连接」。 */
  onChanged: (message: string) => Promise<void>;
  startChat: (draft: string) => void;
  openHandshake: (id: ConnectorId) => void;
  openCreate: (item: MarketplaceItem) => void;
  openUnwired: (item: MarketplaceItem) => void;
  openGateway: () => void;
  chatWithConnection: (name: string) => void;
  chatWithMarketItem: (item: MarketplaceItem) => void;
  /** 弹层（握手 / 新建 / 网关 / 未接线）；宿主渲染一次即可。 */
  modals: ReactNode;
};

function asNameSet(names: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return names instanceof Set ? names : new Set(names as readonly string[]);
}

export function useConnectorsController(input: ConnectorsControllerInput): ConnectorsController {
  const { t } = useTranslation("marketplace");
  const { t: ts } = useTranslation("settings");
  const { sessionId, configuredMcpEntries, reloadMcp, startChat, onAfterChange } = input;
  const nameSet = useMemo(() => asNameSet(input.configuredMcpNames), [input.configuredMcpNames]);

  const [healthById, setHealthById] = useState<Record<string, Health>>({});
  const [accountsById, setAccountsById] = useState<Record<string, string | undefined>>({});
  const [pane, setPane] = useState<ConnectorsPane>("market");
  const [marketBucket, setMarketBucket] = useState<ConnectorMarketBucket>(DEFAULT_CONNECTOR_MARKET_BUCKET);
  const [mineFilter, setMineFilter] = useState<MyConnectionFilter>("all");
  const [status, setStatus] = useState<ConnectorsController["status"]>(null);
  const [handshakeId, setHandshakeId] = useState<ConnectorId | null>(null);
  const [handshakeSeq, setHandshakeSeq] = useState(0);
  const [createTarget, setCreateTarget] = useState<CreateConnectorTarget | null>(null);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [unwired, setUnwired] = useState<MarketplaceItem | null>(null);

  const gatewayInstalled = isGatewayInstalled(nameSet, GATEWAY_DEFAULT_SERVER_NAME);
  const gatewayPresent = gatewayInstalled || nameSet.has(GATEWAY_LOCAL_SERVER_NAME);
  const { connectors: restConnectors, reload: reloadRest } = useGatewayRestConnectors(gatewayPresent, nameSet.size);

  /** 原生健康态（GitHub 含 MCP PAT 探活；TAPD 走 MCP 状态）。 */
  const refreshHealth = useCallback(async () => {
    const wiredNatives = listWiredSupply().filter((e) => e.kind === "native" && e.connectorId);
    const next: Record<string, Health> = {};
    const accounts: Record<string, string | undefined> = {};
    await Promise.all(
      wiredNatives.map(async (e) => {
        const id = e.connectorId!;
        if (id === "tapd") {
          try {
            const res = await window.agenticxDesktop.loadMcpStatus(sessionId || "");
            const server = res?.ok ? (res.servers ?? []).find((s) => s.name === "tapd") : undefined;
            next[id] = server?.connected ? "connected" : "disconnected";
          } catch {
            next[id] = "disconnected";
          }
          return;
        }
        try {
          const res = await window.agenticxDesktop.nativeConnectorStatus(id);
          if (res?.health === "connected" || res?.health === "degraded" || res?.health === "disconnected") {
            next[id] = res.health;
          } else {
            next[id] = res?.connected ? "connected" : "disconnected";
          }
          if (res?.account) accounts[id] = res.account;
        } catch {
          next[id] = "disconnected";
        }
      }),
    );
    setHealthById(next);
    setAccountsById(accounts);
  }, [sessionId]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const refresh = useCallback(async () => {
    await reloadMcp();
    await refreshHealth();
    reloadRest();
  }, [reloadMcp, refreshHealth, reloadRest]);

  const displayNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const e of CONNECTOR_SUPPLY) out[e.id] = connectorSupplyDisplay(e).name;
    return out;
    // t：语言切换时重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, ts]);

  const rows = useMemo(
    () =>
      buildMyConnectionRows({
        healthByConnectorId: healthById as Record<string, ConnectorHealth | undefined>,
        accountsByConnectorId: accountsById,
        configuredMcpNames: nameSet,
        configuredMcpEntries,
        gatewayInstalled,
        restConnectors,
        displayNames,
      }),
    [healthById, accountsById, nameSet, configuredMcpEntries, gatewayInstalled, restConnectors, displayNames],
  );
  const instanceSupplyIds = useMemo(() => connectedSupplyIds(rows), [rows]);

  const gatewayItem = useMemo(
    () =>
      buildGatewayMarketItem({
        name: t("gateway.name"),
        description: t("gateway.cardDesc"),
        provider: t("gateway.provider"),
        installed: gatewayInstalled,
        iconSrc: gatewayIcon,
      }),
    [t, gatewayInstalled],
  );

  const connectorItems = useMemo(() => {
    const entries = listCatalogSupply().filter((e) => e.id !== GATEWAY_SUPPLY_ID);
    const display: Record<string, { name?: string; description?: string }> = {};
    for (const e of entries) display[e.id] = connectorSupplyDisplay(e);
    return buildConnectorSupplyItems(entries, {
      wiredOnly: false,
      display,
      healthByConnectorId: healthById,
      instanceSupplyIds,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, ts, healthById, instanceSupplyIds]);

  const chatWithConnection = useCallback(
    (name: string) => startChat(t("connectors.useDraft", { name })),
    [startChat, t],
  );

  const onChanged = useCallback(
    async (message: string) => {
      setStatus({ message, kind: "success" });
      await refresh();
      setPane("mine");
      onAfterChange?.();
    },
    [refresh, onAfterChange],
  );

  const openHandshake = useCallback((id: ConnectorId) => {
    setHandshakeId(id);
    setHandshakeSeq((n) => n + 1);
  }, []);

  const openCreate = useCallback((item: MarketplaceItem) => {
    setCreateTarget({
      name: item.name,
      authType: item.authType ?? "custom_credential",
      description: item.description,
      iconSrc: item.iconSrc,
      supplyId: item.supplyId ?? item.id,
    });
  }, []);

  const chatWithMarketItem = useCallback(
    (item: MarketplaceItem) => chatWithConnection(findConnectionForSupply(rows, item.supplyId)?.name ?? item.name),
    [rows, chatWithConnection],
  );

  const modals = (
    <>
      {handshakeId ? (
        <ConnectorsTab
          sessionId={sessionId}
          tapdConnected={healthById.tapd === "connected"}
          onRefreshMcp={async () => {
            await refresh();
          }}
          autoOpenId={handshakeId}
          autoOpenSeq={handshakeSeq}
          presentation="handshake-only"
          onHandshakeDismiss={() => setHandshakeId(null)}
          onConnectionChange={() => {
            void refresh();
          }}
        />
      ) : null}

      <CreateConnectorModal
        open={Boolean(createTarget)}
        target={createTarget}
        configPath={MCP_PRIMARY_CONFIG_PATH}
        existingConnection={(() => {
          const row = findConnectionForSupply(rows, createTarget?.supplyId);
          return row ? { name: row.name } : null;
        })()}
        onUseExisting={(name) => {
          setCreateTarget(null);
          chatWithConnection(name);
        }}
        onClose={() => setCreateTarget(null)}
        onCreated={async ({ displayName, updated, reused }) => {
          await onChanged(
            reused
              ? t("connectors.create.reused", { name: displayName })
              : updated
                ? t("connectors.create.updated", { name: displayName })
                : t("connectors.create.success", { name: displayName }),
          );
        }}
      />

      <GatewayInstallModal
        open={gatewayOpen}
        configPath={MCP_PRIMARY_CONFIG_PATH}
        installed={gatewayInstalled}
        onClose={() => setGatewayOpen(false)}
        onInstalled={async (message) => {
          setGatewayOpen(false);
          await onChanged(message);
        }}
      />

      {unwired ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unwired-connector-title"
          onClick={() => setUnwired(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-surface-panel p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="unwired-connector-title" className="text-sm font-semibold text-text-strong">
              {t("connectors.unwiredTitle", { name: unwired.name })}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">{t("connectors.unwiredBody")}</p>
            <p className="mt-2 text-[11px] text-text-faint">
              {t("connectors.unwiredHint", { auth: unwired.authType ?? "custom_credential" })}
            </p>
            <p className="mt-1 text-[11px] text-text-faint">
              {t(`connectors.authFormHint.${unwired.authFormHint ?? "token"}`, {
                defaultValue: t("connectors.authFormHint.token"),
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover"
                onClick={() => setUnwired(null)}
              >
                {t("connectors.unwiredClose")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return {
    sessionId,
    rows,
    restConnectors,
    healthById,
    accountsById,
    gatewayInstalled,
    gatewayItem,
    connectorItems,
    pane,
    setPane,
    marketBucket,
    setMarketBucket,
    mineFilter,
    setMineFilter,
    status,
    setStatus,
    refresh,
    onChanged,
    startChat,
    openHandshake,
    openCreate,
    openUnwired: setUnwired,
    openGateway: () => setGatewayOpen(true),
    chatWithConnection,
    chatWithMarketItem,
    modals,
  };
}
