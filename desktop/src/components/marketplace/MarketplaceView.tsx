import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import { useAppStore } from "../../store";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";
import { MainViewShell } from "../ds/MainViewShell";
import { FeaturedCards } from "./FeaturedCards";
import { FilterChips } from "./FilterChips";
import { SkillGrid } from "./SkillGrid";
import { PluginGrid } from "./PluginGrid";
import { PluginDetailModal } from "./PluginDetailModal";
import { InstallConfirmBar } from "./InstallConfirmBar";
import {
  buildPluginItems,
  buildSkillItems,
  filterPlugins,
  filterSkills,
  skillFilterTags,
} from "./model";
import { RECOMMENDED_SKILLS } from "../../data/recommended-skills";
import { buildOfficeCliInstallPrompt } from "../../utils/officecli-install-prompt";
import { buildArchscribeInstallPrompt } from "../../utils/archscribe-install-prompt";
import { useMarketplaceData } from "./useMarketplaceData";
import { useSkillInstall } from "./useSkillInstall";
import { ManageView } from "./ManageView";
import { MarketOnboardingModal, MARKET_ONBOARDING_DISMISSED_KEY } from "./MarketOnboardingModal";
import type { FeaturedTarget } from "../../data/marketplace-config";

/** Market content tab: plugins (connectors + curated tools) vs skills. */
export type MarketTab = "plugins" | "skills";

/**
 * Full-screen marketplace view: browse, search, install and use plugins
 * (MCP connectors + curated tools) and skills. Mounted from App when
 * `mainView === "market"`.
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

  const [activeTab, setActiveTab] = useState<MarketTab>("plugins");
  /** 市场内部子视图:主浏览页 vs 已装内容管理页。 */
  const [view, setView] = useState<"market" | "manage">("market");
  const [pluginQuery, setPluginQuery] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [pluginTag, setPluginTag] = useState("all");
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
    () => filterSkills(skillItems, skillTag, skillQuery),
    [skillItems, skillTag, skillQuery],
  );
  const skillTags = useMemo(() => skillFilterTags(skillItems), [skillItems]);

  const pluginItems = useMemo(
    () =>
      buildPluginItems(
        data.mcpEntries,
        RECOMMENDED_SKILLS,
        data.configuredMcpNames,
        data.localSkillNames,
      ),
    [data.mcpEntries, data.configuredMcpNames, data.localSkillNames],
  );
  const filteredPlugins = useMemo(
    () =>
      filterPlugins(
        pluginItems,
        pluginTag === "mcp" || pluginTag === "tool" ? pluginTag : "all",
        pluginQuery,
      ),
    [pluginItems, pluginTag, pluginQuery],
  );

  const query = activeTab === "plugins" ? pluginQuery : skillQuery;
  const setQuery = activeTab === "plugins" ? setPluginQuery : setSkillQuery;

  const onFeaturedPick = useCallback((target: FeaturedTarget) => {
    setActiveTab(target.tab);
    if (target.tab === "skills") setSkillTag(target.tag);
    else setPluginTag(target.tag);
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
          {(["plugins", "skills"] as const).map((tab) => (
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
            placeholder={t(activeTab === "plugins" ? "search.plugins" : "search.skills")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t(activeTab === "plugins" ? "search.plugins" : "search.skills")}
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

        {activeTab === "skills" && statusMessage ? (
          <div
            className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-card px-3 py-2 text-xs leading-relaxed ${statusTone}`}
            role="status"
            aria-live="polite"
          >
            {statusMessage}
          </div>
        ) : null}

        {activeTab === "plugins" && mcpStatus ? (
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

        {activeTab === "skills" && installStatus.queuedKeys.length > 0 ? (
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
            {needsConfirm ? (
              <InstallConfirmBar
                kind={confirmKind}
                busy={installStatus.busy}
                onConfirm={() => void confirm(confirmKind)}
                onCancel={cancelConfirm}
              />
            ) : null}
          </>
        ) : (
          <>
            <FilterChips
              tags={["all", "mcp", "tool"]}
              active={pluginTag}
              onSelect={setPluginTag}
            />
            <PluginGrid
              items={filteredPlugins}
              promptBusy={promptBusy}
              onOpenMcpDetail={(item) => setDetailServerId(item.serverId ?? null)}
              onInstallTool={(item) => onInstallRecommended(item.id)}
              onUseTool={(item) => newMetaTask(t("useDraft", { name: item.name }))}
            />
          </>
        )}
      </div>
      </>
      )}

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
