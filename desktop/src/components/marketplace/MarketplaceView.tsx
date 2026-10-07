import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import { useAppStore } from "../../store";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";
import { MainViewShell } from "../ds/MainViewShell";
import { FeaturedCards } from "./FeaturedCards";
import { FeaturedCategoryCards } from "./FeaturedCategoryCards";
import { FilterChips } from "./FilterChips";
import { SkillGrid } from "./SkillGrid";
import { UnifiedGrid } from "./UnifiedGrid";
import { PluginDetailModal } from "./PluginDetailModal";
import { InstallConfirmBar } from "./InstallConfirmBar";
import {
  ALL_CATEGORIES,
  buildSkillItems,
  buildUnifiedItems,
  CATEGORY_META,
  filterSkills,
  filterUnifiedItems,
  skillFilterTags,
  buildConnectorSupplyItems,
  tabToKindFilter,
  type MarketCategory,
  type MarketTab,
  type MarketplaceItem,
} from "./model";
import {
  CONNECTOR_SUPPLY,
  GATEWAY_SUPPLY_ID,
  listCatalogSupply,
  listWiredSupply,
} from "../settings/connectors/connector-supply";
import gatewayIcon from "../../assets/connectors/gateway.svg";
import { RECOMMENDED_SKILLS } from "../../data/recommended-skills";
import { getSkillsForPlugin } from "../../data/plugin-skill-bundles";
import { buildOfficeCliInstallPrompt } from "../../utils/officecli-install-prompt";
import { buildArchscribeInstallPrompt } from "../../utils/archscribe-install-prompt";
import { useMarketplaceData } from "./useMarketplaceData";
import { useSkillInstall } from "./useSkillInstall";
import { ManageView } from "./ManageView";
import { MarketOnboardingModal, MARKET_ONBOARDING_DISMISSED_KEY } from "./MarketOnboardingModal";
import { GatewayInstallModal } from "./GatewayInstallModal";
import { buildGatewayMarketItem, isGatewayInstalled } from "./gateway-model";
import { CONNECTOR_GATEWAY } from "../../data/connector-gateway";
import { ConnectorsTab } from "../settings/connectors/ConnectorsTab";
import type { ConnectorId } from "../settings/connectors/connector-catalog";
import { MyConnectionsPanel } from "../settings/connectors/MyConnectionsPanel";
import { CreateConnectorModal, type CreateConnectorTarget } from "../settings/connectors/CreateConnectorModal";
import { buildMyConnectionRows } from "../settings/connectors/my-connections-model";
import { MCP_PRIMARY_CONFIG_PATH } from "../../utils/mcp-remote-config";

/** 市场顶栏 Tab:全部 + 连接器(一等) + MCP/技能/专家/指令。 */
const MARKET_TABS: readonly MarketTab[] = ["all", "connectors", "mcp", "skills", "agents", "commands"];

/**
 * Full-screen marketplace view: browse, search, install and use every kind of
 * extension (MCP connectors, skills, agents, commands) in one place.
 * Mounted from App when `mainView === "market"`.
 */
export function MarketplaceView() {
  const { t } = useTranslation("marketplace");
  const { t: ts } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const openSettings = useAppStore((s) => s.openSettings);
  const sessionId = useAppStore((s) => s.sessionId);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const panes = useAppStore((s) => s.panes);
  const addPane = useAppStore((s) => s.addPane);
  const setForwardAutoReply = useAppStore((s) => s.setForwardAutoReply);
  const setMainView = useAppStore((s) => s.setMainView);
  const { newMetaTask, deliverExpertInstruction } = usePaneNavigation();

  const data = useMarketplaceData();
  const reloadSkills = data.reloadSkills;
  const { status: installStatus, install, confirm, cancelConfirm } = useSkillInstall(reloadSkills);

  const [activeTab, setActiveTab] = useState<MarketTab>("all");
  /** 市场内部子视图:主浏览页 vs 已装内容管理页。 */
  const [view, setView] = useState<"market" | "manage">("market");
  const [query, setQuery] = useState("");
  const [skillTag, setSkillTag] = useState("all");
  /** 场景分类筛选(全部 / 具体分类);仅 MCP 与技能 tab 生效。 */
  const [categoryFilter, setCategoryFilter] = useState<MarketCategory | "all">("all");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptMsg, setPromptMsg] = useState("");
  const [detailServerId, setDetailServerId] = useState<string | null>(null);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [unwiredSheet, setUnwiredSheet] = useState<MarketplaceItem | null>(null);
  const [createConnectorTarget, setCreateConnectorTarget] = useState<CreateConnectorTarget | null>(null);
  /** 市场直开握手：不经过设置墙网格。 */
  const [handshakeConnectorId, setHandshakeConnectorId] = useState<ConnectorId | null>(null);
  const [handshakeSeq, setHandshakeSeq] = useState(0);
  /** 连接器 Tab 子视图：浏览市场 | 我的连接。 */
  const [connectorsPane, setConnectorsPane] = useState<"browse" | "mine">("browse");
  /** 与设置页同源的健康态（native + MCP 探活 SSOT）。 */
  const [connectorHealthById, setConnectorHealthById] = useState<
    Record<string, "connected" | "degraded" | "disconnected" | "unwired">
  >({});
  const [connectorAccountsById, setConnectorAccountsById] = useState<
    Record<string, string | undefined>
  >({});
  const [mcpInstalling, setMcpInstalling] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<{ message: string; kind: "info" | "success" | "error" } | null>(
    null,
  );
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return !window.localStorage.getItem(MARKET_ONBOARDING_DISMISSED_KEY);
    } catch {
      return false;
    }
  });

  const skillItems = useMemo(
    () => buildSkillItems(RECOMMENDED_SKILLS, data.registryItems, data.localSkillNames, data.localMarketSkills),
    [data.registryItems, data.localSkillNames, data.localMarketSkills],
  );
  const filteredSkills = useMemo(
    () => filterSkills(skillItems, skillTag, query),
    [skillItems, skillTag, query],
  );
  const skillTags = useMemo(() => skillFilterTags(skillItems), [skillItems]);

  /** 连接器网关精选卡:置顶于统一条目之首,文案走 i18n,已装态按本机名册判定。 */
  const gatewayItem = useMemo(
    () =>
      buildGatewayMarketItem({
        name: t("gateway.name"),
        description: t("gateway.cardDesc"),
        provider: t("gateway.provider"),
        installed: isGatewayInstalled(data.configuredMcpNames, CONNECTOR_GATEWAY.serverName),
        iconSrc: gatewayIcon,
      }),
    [t, data.configuredMcpNames],
  );

  const effectiveSessionId = useMemo(() => {
    const pane = panes.find((p) => p.id === activePaneId);
    return String(pane?.sessionId ?? sessionId ?? "").trim();
  }, [panes, activePaneId, sessionId]);

  /** 拉取与设置页同一套健康态（GitHub 含 MCP PAT 探活），供市场卡片 SSOT。 */
  const refreshConnectorHealth = useCallback(async () => {
    const wiredNatives = listWiredSupply().filter((e) => e.kind === "native" && e.connectorId);
    const next: Record<string, "connected" | "degraded" | "disconnected" | "unwired"> = {};
    const accounts: Record<string, string | undefined> = {};
    await Promise.all(
      wiredNatives.map(async (e) => {
        const id = e.connectorId!;
        if (id === "tapd") {
          try {
            const res = await window.agenticxDesktop.loadMcpStatus(effectiveSessionId || "");
            const server = res?.ok
              ? (res.servers ?? []).find((s) => s.name === "tapd")
              : undefined;
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
    setConnectorHealthById(next);
    setConnectorAccountsById(accounts);
  }, [effectiveSessionId]);

  useEffect(() => {
    void refreshConnectorHealth();
  }, [refreshConnectorHealth]);

  /** 全量连接器目录（wired + unwired stubs）；网关精选卡单独置顶。 */
  const connectorItems = useMemo(() => {
    const entries = listCatalogSupply().filter((e) => e.id !== GATEWAY_SUPPLY_ID);
    const display: Record<string, { name?: string; description?: string }> = {};
    for (const e of entries) {
      if (e.connectorId) {
        display[e.id] = {
          name: ts(`connectors.catalog.${e.connectorId}.name`, { defaultValue: e.fallbackName }),
          description: ts(`connectors.catalog.${e.connectorId}.description`, {
            defaultValue: e.fallbackDescription,
          }),
        };
      } else {
        const supplyKey = e.id.replace(/^stub:/, "");
        display[e.id] = {
          name: t(`connectors.supply.${supplyKey}.name`, { defaultValue: e.fallbackName }),
          description: t(`connectors.supply.${supplyKey}.description`, {
            defaultValue: e.fallbackDescription,
          }),
        };
      }
    }
    return buildConnectorSupplyItems(entries, {
      wiredOnly: false,
      display,
      healthByConnectorId: connectorHealthById,
    });
  }, [t, ts, connectorHealthById]);

  /** 统一条目:网关精选(置顶) + 原生连接器 + MCP/技能/专家/指令。 */
  const unifiedItems = useMemo(
    () =>
      [
        gatewayItem,
        ...connectorItems,
        ...buildUnifiedItems(
          data.mcpEntries,
          skillItems,
          data.agents,
          data.commands,
          data.configuredMcpNames,
        ),
      ],
    [gatewayItem, connectorItems, data.mcpEntries, skillItems, data.agents, data.commands, data.configuredMcpNames],
  );

  const connectorDisplayNames = useMemo(() => {
    const display: Record<string, string> = {};
    for (const e of CONNECTOR_SUPPLY) {
      if (e.kind === "gateway") {
        display[e.id] = t("gateway.name");
        continue;
      }
      if (!e.connectorId) continue;
      display[e.id] = ts(`connectors.catalog.${e.connectorId}.name`, { defaultValue: e.fallbackName });
    }
    return display;
  }, [t, ts]);

  const myConnectionRows = useMemo(
    () =>
      buildMyConnectionRows({
        healthByConnectorId: connectorHealthById,
        accountsByConnectorId: connectorAccountsById,
        configuredMcpNames: data.configuredMcpNames,
        configuredMcpEntries: data.configuredMcpEntries,
        gatewayInstalled: isGatewayInstalled(data.configuredMcpNames, CONNECTOR_GATEWAY.serverName),
        displayNames: connectorDisplayNames,
        query: connectorsPane === "mine" ? query : "",
      }),
    [
      connectorHealthById,
      connectorAccountsById,
      data.configuredMcpNames,
      data.configuredMcpEntries,
      connectorDisplayNames,
      connectorsPane,
      query,
    ],
  );
  const filteredUnified = useMemo(
    () => filterUnifiedItems(unifiedItems, tabToKindFilter(activeTab), query, categoryFilter),
    [unifiedItems, activeTab, query, categoryFilter],
  );

  const onFeaturedPick = useCallback((target: { tab: MarketTab; tag: string }) => {
    setActiveTab(target.tab);
    if (target.tab === "skills") setSkillTag(target.tag);
  }, []);

  /** 点击精选分类大卡:切到全部 tab 并预选该场景分类。 */
  const onPickCategory = useCallback((category: MarketCategory) => {
    setActiveTab("all");
    setCategoryFilter(category);
  }, []);

  /** 推荐位安装:把安装指引交给 Meta-Agent 在新会话里执行(与设置页链路一致)。 */
  const runInstallPromptInMetaAgent = async (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    setPromptMsg("");
    setPromptBusy(true);
    try {
      const created = await window.agenticxDesktop.createSession({});
      if (!created.ok || !created.session_id) {
        setPromptMsg(created.error ?? ts("skills.createMetaFailed"));
        return;
      }
      const sid = created.session_id;
      const paneId = addPane(null, "Near", sid);
      // 用户主动发起的安装回合:不继承转发回复的静默默认值,保持首条指令可见。
      setForwardAutoReply({
        paneId,
        sessionId: sid,
        text,
        suppressUserEcho: false,
        skipUserHistory: false,
      });
      setMainView("chat");
    } catch (e) {
      setPromptMsg(String(e));
    } finally {
      setPromptBusy(false);
    }
  };

  const onInstallRecommended = useCallback(
    (itemId: string | undefined) => {
      const prompt =
        itemId === "officecli"
          ? buildOfficeCliInstallPrompt()
          : itemId === "archscribe"
            ? buildArchscribeInstallPrompt()
            : "";
      if (!prompt.trim()) return;
      void runInstallPromptInMetaAgent(prompt);
    },
    // runInstallPromptInMetaAgent 每渲染重建,此处仅读 store action 与纯函数,安全。
    [addPane, setForwardAutoReply, setMainView, ts],
  );

  /** 统一卡片安装分派:registry 技能走扫描安装链路,推荐位走 Meta-Agent 提示词。 */
  const installUnifiedItem = useCallback(
    (item: MarketplaceItem) => {
      if (item.origin === "registry") {
        void install({ source: item.source ?? "", name: item.name });
      } else {
        onInstallRecommended(item.id);
      }
    },
    [install, onInstallRecommended],
  );

  /** 统一卡片「使用」:专家直达其专属对话预填;其余走 Meta 草稿模板。 */
  const useUnifiedItem = useCallback(
    (item: MarketplaceItem) => {
      if (item.kind === "agent" && item.avatarId) {
        deliverExpertInstruction(item.avatarId, item.name, t("useDraftAgentDirect", { name: item.name }));
      } else if (item.kind === "agent") {
        newMetaTask(t("useDraftAgent", { name: item.name }));
      } else if (item.kind === "command") newMetaTask(t("useDraftCommand", { name: item.name }));
      else newMetaTask(t("useDraft", { name: item.name }));
    },
    [newMetaTask, deliverExpertInstruction, t],
  );

  /** 插件详情浮层里安装配套技能:registry 走扫描安装,推荐位走 Meta-Agent 提示词。 */
  const onInstallBundledSkill = useCallback(
    (skill: { kind: "registry" | "recommended"; source?: string; name?: string; id?: string }) => {
      if (skill.kind === "registry" && skill.source && skill.name) {
        void install({ source: skill.source, name: skill.name });
      } else if (skill.kind === "recommended" && skill.id) {
        onInstallRecommended(skill.id);
      }
    },
    [install, onInstallRecommended],
  );

  /** MCP 安装:详情浮层确认后执行,成功后刷新本机名册(与设置页链路一致),
   *  并自动安装该插件配套的、尚未安装的技能(registry 走扫描安装,推荐位走 Meta-Agent)。 */
  const installMcp = async (serverId: string, env: Record<string, string>): Promise<boolean> => {
    setMcpInstalling(true);
    setMcpStatus({ message: ts("mcp.installingNamed", { id: serverId }), kind: "info" });
    try {
      const res = await window.agenticxDesktop.mcpMarketplaceInstall({ serverId, env });
      if (!res.ok) {
        setMcpStatus({
          message: ts("mcp.installFailedReason", {
            reason: res.error ?? ts("commonSettings.unknownError"),
          }),
          kind: "error",
        });
        return false;
      }
      const installedNames = [...(res.installed ?? []), ...(res.updated ?? [])];
      setMcpStatus({
        message: ts("mcp.installOk", { label: installedNames.join("、") || serverId }),
        kind: "success",
      });
      await data.reloadMcpStatus();
      // 安装成功后,自动安装配套技能(逐个、失败不阻塞)。
      await installBundledSkillsForServers(installedNames);
      return true;
    } catch (err) {
      setMcpStatus({
        message: ts("mcp.installFailedReason", { reason: String(err) }),
        kind: "error",
      });
      return false;
    } finally {
      setMcpInstalling(false);
    }
  };

  /** 按 server 名查找配套技能,安装尚未安装的项;单个失败不阻断其余。 */
  const installBundledSkillsForServers = useCallback(
    async (serverNames: string[]) => {
      const seen = new Set<string>();
      for (const name of serverNames) {
        for (const s of getSkillsForPlugin(name)) {
          const key = s.kind === "registry" ? `${s.source}:${s.name}` : `rec:${s.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const alreadyInstalled =
            s.kind === "registry" ? data.localSkillNames.has(s.name) : data.localSkillNames.has(s.id);
          if (alreadyInstalled) continue;
          try {
            if (s.kind === "registry") {
              await install({ source: s.source, name: s.name });
            } else {
              onInstallRecommended(s.id);
            }
          } catch {
            /* 单个配套技能安装失败不阻断 MCP 安装结果 */
          }
        }
      }
    },
    [data.localSkillNames, install, onInstallRecommended],
  );

  const statusMessage = promptMsg || installStatus.message;
  const statusTone =
    promptMsg || installStatus.messageKind === "error"
      ? "text-rose-400"
      : installStatus.messageKind === "success"
        ? "text-emerald-400"
        : "text-text-muted";
  const needsConfirm = installStatus.needsConfirmNonHigh || installStatus.needsConfirmHigh;
  const confirmKind = installStatus.needsConfirmHigh ? "high" : "non_high";

  return (
    <MainViewShell>
      {view === "manage" ? (
        <ManageView
          onBack={() => setView("market")}
          onUse={(name) => newMetaTask(t("useDraft", { name }))}
          onOpenAdvancedSettings={() => openSettings("skills")}
          onEditAgent={() => setMainView("avatars")}
          onEditCommands={() => openSettings("commands")}
          mcpEntries={data.mcpEntries}
          initialSkills={data.skillItems}
        />
      ) : (
      <>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text-strong">{t("title")}</h2>
          <p className="mt-1 text-sm text-text-muted">{t("subtitle")}</p>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
          onClick={() => setView("manage")}
        >
          <Settings2 className="h-3.5 w-3.5" />
          {t("manage")}
        </button>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t("title")}
          className="flex items-center gap-1 rounded-lg border border-border bg-surface-card p-1"
        >
          {MARKET_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`rounded-md px-3 py-1.5 text-[13px] leading-none transition-colors ${
                activeTab === tab
                  ? "bg-surface-card-strong font-medium text-text-strong"
                  : "text-text-muted hover:text-text-strong"
              }`}
              onClick={() => {
                setActiveTab(tab);
                setCategoryFilter("all");
                if (tab !== "connectors") setConnectorsPane("browse");
              }}
            >
              {t(`tabs.${tab}`)}
            </button>
          ))}
        </div>
        <div className="relative w-64 max-w-[45%]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            type="text"
            className="w-full rounded-md border border-border bg-surface-card py-1.5 pl-8 pr-3 text-[13px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
            placeholder={t(`search.${activeTab}`)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t(`search.${activeTab}`)}
          />
        </div>
      </div>

      <div className="space-y-5">
        {activeTab === "connectors" ? (
          <div
            role="tablist"
            aria-label={t("connectors.myConnections")}
            className="flex items-center gap-1 rounded-lg border border-border bg-surface-panel p-0.5 w-fit"
          >
            <button
              type="button"
              role="tab"
              aria-selected={connectorsPane === "browse"}
              className={`rounded-md px-2.5 py-1 text-[12px] transition ${
                connectorsPane === "browse"
                  ? "bg-surface-card font-medium text-text-strong"
                  : "text-text-muted hover:text-text-strong"
              }`}
              onClick={() => setConnectorsPane("browse")}
            >
              {t("connectors.browse")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={connectorsPane === "mine"}
              className={`rounded-md px-2.5 py-1 text-[12px] transition ${
                connectorsPane === "mine"
                  ? "bg-surface-card font-medium text-text-strong"
                  : "text-text-muted hover:text-text-strong"
              }`}
              onClick={() => setConnectorsPane("mine")}
            >
              {t("connectors.myConnectionsCount", { count: myConnectionRows.length })}
            </button>
          </div>
        ) : null}

        <FeaturedCards onPick={onFeaturedPick} />

        {(activeTab === "all" || activeTab === "mcp" || activeTab === "skills") ? (
          <FeaturedCategoryCards items={unifiedItems} onPickCategory={onPickCategory} />
        ) : null}

        {(activeTab === "all" || activeTab === "mcp" || activeTab === "skills") ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                categoryFilter === "all"
                  ? "bg-btnPrimary text-btnPrimary-text"
                  : "bg-surface-card text-text-muted hover:bg-surface-hover"
              }`}
              onClick={() => setCategoryFilter("all")}
            >
              {t("filters.all")}
            </button>
            {ALL_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  categoryFilter === cat
                    ? "bg-btnPrimary text-btnPrimary-text"
                    : "bg-surface-card text-text-muted hover:bg-surface-hover"
                }`}
                onClick={() => setCategoryFilter(cat)}
              >
                {CATEGORY_META[cat].label}
              </button>
            ))}
          </div>
        ) : null}

        {data.loadError ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
            <span className="min-w-0 break-words">{t("loadFailed")}</span>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-500/40 px-2 py-1 transition hover:bg-rose-500/20"
              onClick={() => void data.reload()}
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              {tc("retry")}
            </button>
          </div>
        ) : null}

        {(activeTab === "skills" || activeTab === "all") && statusMessage ? (
          <div
            className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-card px-3 py-2 text-xs leading-relaxed ${statusTone}`}
            role="status"
            aria-live="polite"
          >
            {statusMessage}
          </div>
        ) : null}

        {(activeTab === "mcp" || activeTab === "all") && mcpStatus ? (
          <div
            className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-card px-3 py-2 text-xs leading-relaxed ${
              mcpStatus.kind === "error"
                ? "text-rose-400"
                : mcpStatus.kind === "success"
                  ? "text-emerald-400"
                  : "text-text-muted"
            }`}
            role="status"
            aria-live="polite"
          >
            {mcpStatus.message}
          </div>
        ) : null}

        {(activeTab === "skills" || activeTab === "all") && installStatus.queuedKeys.length > 0 ? (
          <div className="text-[11px] text-text-faint">
            {t("installQueue", { count: installStatus.queuedKeys.length })}
          </div>
        ) : null}

        {/* 有可展示条目(含本地连接器供给)时不整页挡「加载中」;仅在对应 tab 仍空时转圈。 */}
        {data.loading &&
        ((activeTab === "skills" && filteredSkills.length === 0) ||
          (activeTab !== "skills" && filteredUnified.length === 0)) ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-faint">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : activeTab === "skills" ? (
          <>
            <FilterChips tags={skillTags} active={skillTag} onSelect={setSkillTag} />
            <SkillGrid
              items={filteredSkills}
              installingKey={installStatus.installingKey}
              queuedKeys={installStatus.queuedKeys}
              promptBusy={promptBusy}
              onInstallRegistry={(item) =>
                void install({ source: item.source ?? "", name: item.name })
              }
              onInstallRecommended={(item) => onInstallRecommended(item.id)}
              onUse={(item) => newMetaTask(t("useDraft", { name: item.name }))}
            />
          </>
        ) : activeTab === "connectors" && connectorsPane === "mine" ? (
          <MyConnectionsPanel
            sessionId={effectiveSessionId || ""}
            healthByConnectorId={connectorHealthById}
            accountsByConnectorId={connectorAccountsById}
            configuredMcpNames={Array.from(data.configuredMcpNames)}
            configuredMcpEntries={data.configuredMcpEntries}
            gatewayInstalled={isGatewayInstalled(
              data.configuredMcpNames,
              CONNECTOR_GATEWAY.serverName,
            )}
            displayNames={connectorDisplayNames}
            query={query}
            onChanged={() => {
              void data.reloadMcpStatus();
              void refreshConnectorHealth();
            }}
            onOpenHandshake={(id) => {
              setHandshakeConnectorId(id);
              setHandshakeSeq((n) => n + 1);
            }}
          />
        ) : (
          <UnifiedGrid
            items={filteredUnified}
            installingKey={installStatus.installingKey}
            queuedKeys={installStatus.queuedKeys}
            promptBusy={promptBusy}
            onOpenMcpDetail={(item) => {
              // 网关精选卡走专属安装弹层(本地直写),其余 MCP 走上游详情浮层。
              if (item.gateway) setGatewayOpen(true);
              else setDetailServerId(item.serverId ?? null);
            }}
            onInstallSkill={installUnifiedItem}
            onUse={useUnifiedItem}
            onConnectNative={(item) => {
              // 直开与设置页 openConnector 同一握手弹层，跳过设置墙网格。
              const id = item.connectorId as ConnectorId | undefined;
              if (!id) return;
              setHandshakeConnectorId(id);
              setHandshakeSeq((n) => n + 1);
            }}
            onCreateConnector={(item) => {
              setCreateConnectorTarget({
                name: item.name,
                authType: item.authType ?? "custom_credential",
                description: item.description,
                iconSrc: item.iconSrc,
                supplyId: item.supplyId ?? item.id,
              });
            }}
            onUnwiredConnector={(item) => setUnwiredSheet(item)}
          />
        )}
      </div>
      </>
      )}

      {(activeTab === "skills" || activeTab === "all") && needsConfirm && view === "market" ? (
        <InstallConfirmBar
          kind={confirmKind}
          busy={installStatus.busy}
          onConfirm={() => void confirm(confirmKind)}
          onCancel={cancelConfirm}
        />
      ) : null}

      <PluginDetailModal
        serverId={detailServerId}
        installing={mcpInstalling}
        onClose={() => setDetailServerId(null)}
        onInstall={installMcp}
        installedSkillNames={Array.from(data.localSkillNames)}
        onInstallSkill={onInstallBundledSkill}
      />

      <GatewayInstallModal
        open={gatewayOpen}
        configPath={MCP_PRIMARY_CONFIG_PATH}
        installed={isGatewayInstalled(data.configuredMcpNames, CONNECTOR_GATEWAY.serverName)}
        onClose={() => setGatewayOpen(false)}
        onInstalled={async (message) => {
          setGatewayOpen(false);
          setMcpStatus({ message, kind: "success" });
          await data.reloadMcpStatus();
        }}
      />

      <MarketOnboardingModal
        open={onboardingOpen}
        onDismiss={() => {
          try {
            window.localStorage.setItem(MARKET_ONBOARDING_DISMISSED_KEY, "1");
          } catch {
            /* 存不进去也不阻塞关闭 */
          }
          setOnboardingOpen(false);
        }}
      />


      {handshakeConnectorId ? (
        <ConnectorsTab
          sessionId={effectiveSessionId}
          tapdConnected={Boolean((connectorHealthById.tapd === "connected"))}
          onRefreshMcp={async () => {
            await data.reloadMcpStatus();
            await refreshConnectorHealth();
          }}
          autoOpenId={handshakeConnectorId}
          autoOpenSeq={handshakeSeq}
          presentation="handshake-only"
          onHandshakeDismiss={() => setHandshakeConnectorId(null)}
          onConnectionChange={() => {
            void refreshConnectorHealth();
          }}
        />
      ) : null}

      <CreateConnectorModal
        open={Boolean(createConnectorTarget)}
        target={createConnectorTarget}
        configPath={MCP_PRIMARY_CONFIG_PATH}
        onClose={() => setCreateConnectorTarget(null)}
        onCreated={async ({ serverName }) => {
          setMcpStatus({
            message: t("connectors.create.success", { name: serverName }),
            kind: "success",
          });
          await data.reloadMcpStatus();
          await refreshConnectorHealth();
          setConnectorsPane("mine");
          setActiveTab("connectors");
        }}
      />

      {unwiredSheet ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unwired-connector-title"
          onClick={() => setUnwiredSheet(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-surface-panel p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="unwired-connector-title" className="text-sm font-semibold text-text-strong">
              {t("connectors.unwiredTitle", { name: unwiredSheet.name })}
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-text-muted">
              {t("connectors.unwiredBody")}
            </p>
            <p className="mt-2 text-[11px] text-text-faint">
              {t("connectors.unwiredHint", {
                auth: unwiredSheet.authType ?? "custom_credential",
              })}
            </p>
            <p className="mt-1 text-[11px] text-text-faint">
              {t(`connectors.authFormHint.${unwiredSheet.authFormHint ?? "token"}`, {
                defaultValue: t("connectors.authFormHint.token"),
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted hover:bg-surface-hover"
                onClick={() => setUnwiredSheet(null)}
              >
                {t("connectors.unwiredClose")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </MainViewShell>
  );
}
