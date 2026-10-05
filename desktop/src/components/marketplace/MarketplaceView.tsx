import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import { useAppStore } from "../../store";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";
import { MainViewShell } from "../ds/MainViewShell";
import { FeaturedCards } from "./FeaturedCards";
import { FilterChips } from "./FilterChips";
import { SkillGrid } from "./SkillGrid";
import { UnifiedGrid } from "./UnifiedGrid";
import { PluginDetailModal } from "./PluginDetailModal";
import { InstallConfirmBar } from "./InstallConfirmBar";
import {
  buildSkillItems,
  buildUnifiedItems,
  filterSkills,
  filterUnifiedItems,
  skillFilterTags,
  tabToKindFilter,
  type MarketTab,
  type MarketplaceItem,
} from "./model";
import { RECOMMENDED_SKILLS } from "../../data/recommended-skills";
import { buildOfficeCliInstallPrompt } from "../../utils/officecli-install-prompt";
import { buildArchscribeInstallPrompt } from "../../utils/archscribe-install-prompt";
import { useMarketplaceData } from "./useMarketplaceData";
import { useSkillInstall } from "./useSkillInstall";
import { ManageView } from "./ManageView";
import { MarketOnboardingModal, MARKET_ONBOARDING_DISMISSED_KEY } from "./MarketOnboardingModal";

/** 市场顶栏五 Tab:全部混排统一卡片,MCP/技能/专家/指令按 kind 分域浏览。 */
const MARKET_TABS: readonly MarketTab[] = ["all", "mcp", "skills", "agents", "commands"];

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
  const addPane = useAppStore((s) => s.addPane);
  const setForwardAutoReply = useAppStore((s) => s.setForwardAutoReply);
  const setMainView = useAppStore((s) => s.setMainView);
  const { newMetaTask } = usePaneNavigation();

  const data = useMarketplaceData();
  const reloadSkills = data.reloadSkills;
  const { status: installStatus, install, confirm, cancelConfirm } = useSkillInstall(reloadSkills);

  const [activeTab, setActiveTab] = useState<MarketTab>("all");
  /** 市场内部子视图:主浏览页 vs 已装内容管理页。 */
  const [view, setView] = useState<"market" | "manage">("market");
  const [query, setQuery] = useState("");
  const [skillTag, setSkillTag] = useState("all");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptMsg, setPromptMsg] = useState("");
  const [detailServerId, setDetailServerId] = useState<string | null>(null);
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

  /** 统一条目:连接器 + 技能 + 专家 + 指令(专家/指令数据源后续接入)。 */
  const unifiedItems = useMemo(
    () =>
      buildUnifiedItems(
        data.mcpEntries,
        skillItems,
        [],
        [],
        data.configuredMcpNames,
      ),
    [data.mcpEntries, skillItems, data.configuredMcpNames],
  );
  const filteredUnified = useMemo(
    () => filterUnifiedItems(unifiedItems, tabToKindFilter(activeTab), query),
    [unifiedItems, activeTab, query],
  );

  const onFeaturedPick = useCallback((target: { tab: MarketTab; tag: string }) => {
    setActiveTab(target.tab);
    if (target.tab === "skills") setSkillTag(target.tag);
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

  /** 统一卡片「使用」:按 kind 选草稿模板回聊天预填。 */
  const useUnifiedItem = useCallback(
    (item: MarketplaceItem) => {
      if (item.kind === "agent") newMetaTask(t("useDraftAgent", { name: item.name }));
      else if (item.kind === "command") newMetaTask(t("useDraftCommand", { name: item.name }));
      else newMetaTask(t("useDraft", { name: item.name }));
    },
    [newMetaTask, t],
  );

  /** MCP 安装:详情浮层确认后执行,成功后刷新本机名册(与设置页链路一致)。 */
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
              onClick={() => setActiveTab(tab)}
            >
              {t(`tabs.${tab}`)}
            </button>
          ))}
        </div>
        <div className="relative w-64 max-w-[45%]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            type="text"
            className="w-full rounded-md border border-border bg-surface-card py-1.5 pl-8 pr-3 text-[13px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-accent"
            placeholder={t(`search.${activeTab}`)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t(`search.${activeTab}`)}
          />
        </div>
      </div>

      <div className="space-y-5">
        <FeaturedCards onPick={onFeaturedPick} />

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

        {data.loading ? (
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
        ) : (
          <UnifiedGrid
            items={filteredUnified}
            installingKey={installStatus.installingKey}
            queuedKeys={installStatus.queuedKeys}
            promptBusy={promptBusy}
            onOpenMcpDetail={(item) => setDetailServerId(item.serverId ?? null)}
            onInstallSkill={installUnifiedItem}
            onUse={useUnifiedItem}
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
    </MainViewShell>
  );
}
