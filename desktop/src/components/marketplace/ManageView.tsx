/**
 * 市场内嵌的管理视图:已配置的 MCP 插件、本地技能、数字专家与指令的行式列表,
 * 支持搜索、技能全局开关、指令内置开关/删除与「体验」回聊天预填。
 * 专家编辑跳画廊、自定义指令编辑跳设置页;MCP 行展示连接状态。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, MessageSquarePlus, Pencil, Search, Settings2, Trash2 } from "lucide-react";
import {
  buildManageAgentRows,
  buildManageCommandRows,
  buildManageMcpRows,
  buildManageSkillRows,
  buildAuthRows,
  findUnmatchedServerNames,
  matchServerLogoEntry,
  type ManageAgentRowInput,
  type ManageAuthServerInput,
  type ManageCommandRowInput,
  type ManageSkillRowInput,
} from "./manage-model";
import { extractMcpServerNames, type MarketMcpEntry } from "./model";
import { pickGradientFor } from "./icon-model";
import { MarketIcon } from "./MarketIcon";
import { useAppStore } from "../../store";
import {
  deleteCommand,
  fetchCommands,
  setBuiltinEnabled,
  type BuiltinCommand,
  type StoredCommand,
} from "../../services/commandsApi";

type Props = {
  onBack: () => void;
  /** 「体验」:回聊天并预填使用草稿。 */
  onUse: (name: string) => void;
  /** 跳到设置页的技能配置(扫描路径等高级能力)。 */
  onOpenAdvancedSettings: () => void;
  /** 专家编辑:跳数字专家画廊。 */
  onEditAgent: () => void;
  /** 自定义指令编辑:跳设置页指令配置。 */
  onEditCommands: () => void;
  /** 市场条目(用于 MCP 行匹配上游 logo)。 */
  mcpEntries: readonly MarketMcpEntry[];
  /** 市场视图已拉过的技能列表:有则首屏直出,后台再静默刷新。 */
  initialSkills?: readonly ManageSkillRowInput[];
};

type ManageTab = "mcp" | "skills" | "agents" | "commands" | "auth";

export function ManageView({
  onBack,
  onUse,
  onOpenAdvancedSettings,
  onEditAgent,
  onEditCommands,
  mcpEntries,
  initialSkills,
}: Props) {
  const { t } = useTranslation("marketplace");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);

  const [tab, setTab] = useState<ManageTab>("mcp");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!initialSkills || initialSkills.length === 0);
  const [skills, setSkills] = useState<ManageSkillRowInput[]>(() => (initialSkills ? [...initialSkills] : []));
  const [servers, setServers] = useState<ManageAuthServerInput[]>([]);
  const [agents, setAgents] = useState<ManageAgentRowInput[]>([]);
  const [builtinCommands, setBuiltinCommands] = useState<BuiltinCommand[]>([]);
  const [customCommands, setCustomCommands] = useState<StoredCommand[]>([]);
  /** logo 索引:市场过滤条目 + 后台拉的全量市场列表(含未认证/非托管条目)。 */
  const [logoEntries, setLogoEntries] = useState<MarketMcpEntry[]>(() => [...mcpEntries]);
  const [toggleBusyName, setToggleBusyName] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  /** 指令删除行内二次确认:待确认的行 key。 */
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);

  const reloadSkills = useCallback(async () => {
    const res = await window.agenticxDesktop.loadSkills().catch(() => null);
    if (res?.ok) setSkills(res.items ?? []);
  }, []);

  const reloadServers = useCallback(async () => {
    const res = await window.agenticxDesktop.loadMcpStatus("").catch(() => null);
    const base =
      res?.ok && Array.isArray(res.servers)
        ? res.servers.map((s) => ({ name: s.name, connected: s.connected, tool_count: s.tool_count }))
        : [];
    // 从 mcp.json 读取各 server 的 env/headers,用于应用授权 tab 判定凭证状态。
    let envMap: Record<string, { env?: Record<string, string>; headers?: Record<string, string> }> = {};
    try {
      const raw = await window.agenticxDesktop.mcpGetRaw({}).catch(() => null);
      if (raw?.ok && raw.text) {
        const parsed = JSON.parse(raw.text) as { mcpServers?: Record<string, { env?: Record<string, string>; headers?: Record<string, string> }> };
        envMap = parsed.mcpServers ?? {};
      }
    } catch {
      /* mcp.json 读取失败降级为无凭证信息 */
    }
    setServers(
      base.map((s) => {
        const cfg = envMap[s.name] ?? {};
        return { ...s, env: cfg.env, headers: cfg.headers };
      }),
    );
  }, []);

  const reloadAgents = useCallback(async () => {
    const res = await window.agenticxDesktop.listAvatars().catch(() => null);
    if (res?.ok) setAgents(res.avatars ?? []);
  }, []);

  const reloadCommands = useCallback(async () => {
    if (!apiBase) return;
    try {
      const loaded = await fetchCommands(apiBase, apiToken, "global");
      setBuiltinCommands(loaded.builtins);
      setCustomCommands(loaded.commands);
    } catch {
      /* 指令加载失败降级为空列表 */
    }
  }, [apiBase, apiToken]);

  /** 按名搜索市场并拉详情,富化出候选条目(server 名 + 上游 logo)。 */
  const searchLogoCandidates = useCallback(async (serverName: string): Promise<MarketMcpEntry[]> => {
    const res = await window.agenticxDesktop
      .mcpMarketplaceList({ search: serverName, page: 1, pageSize: 5 })
      .catch(() => null);
    if (!res?.ok || !Array.isArray(res.items)) return [];
    const raws = (res.items as Array<Record<string, unknown>>)
      .filter((raw) => String(raw.logo_url ?? "").trim() && String(raw.id ?? "").trim())
      .slice(0, 3);
    const candidates: MarketMcpEntry[] = [];
    for (const raw of raws) {
      const serverId = String(raw.id);
      try {
        const detail = await window.agenticxDesktop.mcpMarketplaceDetail({ serverId });
        const item = (detail?.item as Record<string, unknown> | undefined) ?? undefined;
        const names = extractMcpServerNames(item);
        const logo = String(item?.logo_url ?? raw.logo_url ?? "").trim();
        if (names.length > 0 && logo) {
          candidates.push({
            serverId,
            name: String(raw.chinese_name || raw.name || serverId),
            description: "",
            serverNames: names,
            logoUrl: logo,
          });
        }
      } catch {
        /* 单条失败跳过 */
      }
    }
    return candidates;
  }, []);

  useEffect(() => {
    if (loading) {
      void Promise.all([reloadSkills(), reloadServers(), reloadAgents(), reloadCommands()]).finally(() =>
        setLoading(false),
      );
    } else {
      // 首屏已直出,各路后台刷新到最新即可。
      void reloadSkills();
      void reloadServers();
      void reloadAgents();
      void reloadCommands();
    }
    // 后台按名搜索市场,为没有 logo 匹配的 MCP 行补上游 logo(不挡首屏,静默失败)。
    void (async () => {
      const status = await window.agenticxDesktop.loadMcpStatus("").catch(() => null);
      if (!status?.ok || !Array.isArray(status.servers)) return;
      const unmatched = findUnmatchedServerNames(
        status.servers.map((s) => ({ name: s.name })),
        mcpEntries,
      ).slice(0, 8);
      const found = await Promise.all(
        unmatched.map(async (name) => {
          const candidates = await searchLogoCandidates(name);
          return matchServerLogoEntry(name, candidates);
        }),
      );
      const hits = found.filter((e): e is MarketMcpEntry => Boolean(e));
      if (hits.length === 0) return;
      setLogoEntries((prev) => {
        const merged = [...prev];
        for (const e of hits) {
          if (!merged.some((x) => x.serverId === e.serverId)) merged.push(e);
        }
        return merged;
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skillRows = useMemo(() => buildManageSkillRows(skills, query), [skills, query]);
  const mcpRows = useMemo(() => buildManageMcpRows(servers, logoEntries, query), [servers, logoEntries, query]);
  const agentRows = useMemo(() => buildManageAgentRows(agents, query), [agents, query]);
  const commandRows = useMemo(
    () =>
      buildManageCommandRows(
        [
          ...builtinCommands.map((b) => ({ ...b, builtin: true })),
          ...customCommands.map((c) => ({ ...c, builtin: false, scope: "global" })),
        ],
        query,
      ),
    [builtinCommands, customCommands, query],
  );
  const authRows = useMemo(() => buildAuthRows(servers, logoEntries, query), [servers, logoEntries, query]);

  /** 技能全局开关:读当前 settings,整体回写 disabledSkills(PUT 会失效列表缓存)。 */
  const toggleSkill = async (name: string, disabled: boolean) => {
    setToggleBusyName(name);
    setMsg("");
    try {
      const settings = await window.agenticxDesktop.getSkillSettings();
      if (!settings.ok) {
        setMsg(settings.error ?? t("manageView.toggleFailed", { name }));
        return;
      }
      const next = new Set((settings.disabled_skills ?? []).map((s) => s.trim()).filter(Boolean));
      if (disabled) next.delete(name);
      else next.add(name);
      const res = await window.agenticxDesktop.putSkillSettings({
        presetPaths: (settings.preset_paths ?? []).map((p) => ({ id: p.id, enabled: p.enabled })),
        customPaths: settings.custom_paths ?? [],
        preferredSources: settings.preferred_sources ?? {},
        disabledSkills: Array.from(next),
      });
      if (!res.ok) {
        setMsg(res.error ?? t("manageView.toggleFailed", { name }));
        return;
      }
      await reloadSkills();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setToggleBusyName(null);
    }
  };

  /** 内置指令开关:PUT 后端 builtin 启停态,成功后刷新列表。 */
  const toggleBuiltinCommand = async (name: string, enabled: boolean) => {
    setToggleBusyName(name);
    setMsg("");
    try {
      await setBuiltinEnabled(apiBase, apiToken, name, enabled);
      await reloadCommands();
    } catch (e) {
      setMsg(t("manageView.toggleCommandFailed", { name }));
    } finally {
      setToggleBusyName(null);
    }
  };

  /** 自定义指令删除:行内二次确认后调 DELETE,成功后刷新列表。 */
  const removeCustomCommand = async (commandId: string, name: string) => {
    setToggleBusyName(name);
    setPendingDeleteKey(null);
    setMsg("");
    try {
      await deleteCommand(apiBase, apiToken, commandId, "global");
      await reloadCommands();
    } catch (e) {
      setMsg(t("manageView.deleteCommandFailed", { name }));
    } finally {
      setToggleBusyName(null);
    }
  };

  const tabCounts: Record<ManageTab, number> = {
    mcp: servers.length,
    skills: skills.length,
    agents: agents.length,
    commands: builtinCommands.length + customCommands.length,
    auth: authRows.length,
  };
  const rows =
    tab === "skills"
      ? skillRows.length
      : tab === "agents"
        ? agentRows.length
        : tab === "commands"
          ? commandRows.length
          : tab === "auth"
            ? authRows.length
            : mcpRows.length;

  return (
    <div>
      <button
        type="button"
        className="mb-4 inline-flex items-center gap-1 text-xs text-text-faint transition hover:text-text-strong"
        onClick={onBack}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        {t("manageView.back")}
      </button>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-text-strong">{t("manageView.title")}</h2>
          <p className="mt-1 text-sm text-text-muted">{t("manageView.subtitle")}</p>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
          onClick={onOpenAdvancedSettings}
        >
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          {t("manageView.advancedSettings")}
        </button>
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label={t("manageView.title")}
          className="flex items-center gap-1 rounded-lg border border-border bg-surface-card p-1"
        >
          {(["mcp", "skills", "agents", "commands", "auth"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`rounded-md px-3 py-1.5 text-[13px] leading-none transition-colors ${
                tab === key
                  ? "bg-surface-card-strong font-medium text-text-strong"
                  : "text-text-muted hover:text-text-strong"
              }`}
              onClick={() => setTab(key)}
            >
              {t(`manageView.tabs.${key}`, { count: tabCounts[key] })}
            </button>
          ))}
        </div>
        <div className="relative w-64 max-w-[45%]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            type="text"
            className="w-full rounded-md border border-border bg-surface-card py-1.5 pl-8 pr-3 text-[13px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
            placeholder={t(`manageView.search.${tab}`)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t(`manageView.search.${tab}`)}
          />
        </div>
      </div>

      {msg ? (
        <div className="mb-3 whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-rose-400" role="status">
          {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t("loading")}
        </div>
      ) : rows === 0 ? (
        <div className="py-14 text-center">
          <div className="text-sm text-text-muted">{t("manageView.empty")}</div>
          <div className="mt-1 text-xs text-text-faint">{t("empty.desc")}</div>
        </div>
      ) : (
        <div className="space-y-2" data-manage-tab={tab}>
          {tab === "skills"
            ? skillRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3 transition-colors hover:bg-surface-hover/40"
                  data-manage-skill={row.name}
                >
                  <MarketIcon name={row.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[13px] font-semibold text-text-strong">{row.name}</span>
                      <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                        {row.source || t("filters.thirdParty")}
                      </span>
                    </div>
                    {row.description ? (
                      <p className="mt-0.5 line-clamp-1 text-[12px] text-text-muted">{row.description}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                    title={t("manageView.tryIt")}
                    onClick={() => onUse(row.name)}
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                    {t("manageView.tryIt")}
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!row.disabled}
                    aria-label={t(row.disabled ? "manageView.enableSkill" : "manageView.disableSkill", { name: row.name })}
                    disabled={toggleBusyName === row.name}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                      row.disabled ? "bg-surface-hover" : "bg-emerald-500"
                    }`}
                    onClick={() => void toggleSkill(row.name, row.disabled)}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        row.disabled ? "left-0.5" : "left-[18px]"
                      }`}
                    />
                  </button>
                </div>
              ))
            : tab === "agents"
              ? agentRows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3 transition-colors hover:bg-surface-hover/40"
                    data-manage-agent={row.name}
                  >
                    {row.avatarUrl ? (
                      <img
                        src={row.avatarUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-xl object-cover border border-border"
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${pickGradientFor(
                          row.name,
                        )} text-sm font-semibold text-white shadow-sm border border-border`}
                      >
                        {row.name.slice(0, 1)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-text-strong">{row.name}</span>
                        <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                          {t("manageView.agentKind")}
                        </span>
                      </div>
                      {row.description ? (
                        <p className="mt-0.5 line-clamp-1 text-[12px] text-text-muted">{row.description}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                      title={t("manageView.tryIt")}
                      onClick={() => onUse(row.name)}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                      {t("manageView.tryIt")}
                    </button>
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                      title={t("manageView.editAgent")}
                      onClick={onEditAgent}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      {t("manageView.edit")}
                    </button>
                  </div>
                ))
              : tab === "commands"
                ? commandRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3 transition-colors hover:bg-surface-hover/40"
                      data-manage-command={row.name}
                    >
                      <span className="font-mono text-[13px] font-semibold text-text-strong">/{row.name}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                            {t(row.builtin ? "manageView.commandBuiltin" : "manageView.commandCustom")}
                          </span>
                        </div>
                        {row.description ? (
                          <p className="mt-0.5 line-clamp-1 text-[12px] text-text-muted">{row.description}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                        title={t("manageView.tryIt")}
                        onClick={() => onUse(row.name)}
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                        {t("manageView.tryIt")}
                      </button>
                      {row.builtin ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={row.enabled}
                          aria-label={t(row.enabled ? "manageView.disableCommand" : "manageView.enableCommand", { name: row.name })}
                          disabled={toggleBusyName === row.name}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                            row.enabled ? "bg-emerald-500" : "bg-surface-hover"
                          }`}
                          onClick={() => void toggleBuiltinCommand(row.name, !row.enabled)}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                              row.enabled ? "left-[18px]" : "left-0.5"
                            }`}
                          />
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                            title={t("manageView.editCommand")}
                            onClick={onEditCommands}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            {t("manageView.edit")}
                          </button>
                          <button
                            type="button"
                            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1.5 text-xs transition disabled:opacity-40 ${
                              pendingDeleteKey === row.key
                                ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                                : "border-border text-text-muted hover:bg-surface-hover hover:text-text-strong"
                            }`}
                            disabled={toggleBusyName === row.name}
                            title={t("manageView.deleteCommand")}
                            onClick={() => {
                              if (pendingDeleteKey === row.key && row.commandId) {
                                void removeCustomCommand(row.commandId, row.name);
                              } else {
                                setPendingDeleteKey(row.key);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            {pendingDeleteKey === row.key
                              ? t("manageView.confirmDelete")
                              : t("manageView.delete")}
                          </button>
                        </>
                      )}
                    </div>
                  ))
                : tab === "auth"
                  ? authRows.map((row) => (
                      <div
                        key={row.key}
                        className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3 transition-colors hover:bg-surface-hover/40"
                        data-manage-auth={row.name}
                      >
                        <MarketIcon name={row.name} logoUrl={row.logoUrl} />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-[13px] font-semibold text-text-strong">{row.name}</span>
                            <span
                              className={`shrink-0 rounded-full border px-1.5 text-[10px] ${
                                row.connected
                                  ? "border-emerald-500/40 text-emerald-400"
                                  : "border-border text-text-faint"
                              }`}
                            >
                              {row.connected ? t("manageView.connected") : t("manageView.disconnected")}
                            </span>
                            {!row.hasCredentials ? (
                              <span className="shrink-0 rounded-full border border-amber-500/40 px-1.5 text-[10px] text-amber-400">
                                {t("manageView.authNoCredential")}
                              </span>
                            ) : null}
                          </div>
                          {row.description ? (
                            <p className="mt-0.5 line-clamp-1 text-[12px] text-text-muted">{row.description}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                          title={t("manageView.authReconnect")}
                          onClick={onOpenAdvancedSettings}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          {t("manageView.authReconnect")}
                        </button>
                      </div>
                    ))
                  : mcpRows.map((row) => (
                    <div
                      key={row.key}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3 transition-colors hover:bg-surface-hover/40"
                      data-manage-mcp={row.name}
                    >
                      <MarketIcon name={row.name} logoUrl={row.logoUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[13px] font-semibold text-text-strong">{row.name}</span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                              row.connected
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                : "border-border bg-surface-panel text-text-faint"
                            }`}
                          >
                            {t(row.connected ? "manageView.connected" : "manageView.disconnected")}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[12px] text-text-muted">
                          {t("manageView.toolCount", { count: row.toolCount })}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                        title={t("manageView.tryIt")}
                        onClick={() => onUse(row.name)}
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                        {t("manageView.tryIt")}
                      </button>
                    </div>
                  ))}
        </div>
      )}
    </div>
  );
}
