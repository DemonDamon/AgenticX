/**
 * 市场内嵌的管理视图:已配置的 MCP 插件与本地技能的行式列表,
 * 支持搜索、技能全局开关(禁用/启用)与「体验」回聊天预填。
 * 后端暂无 MCP server 级开关与技能卸载能力,本轮 MCP 行只展示连接状态。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2, MessageSquarePlus, Search, Settings2 } from "lucide-react";
import { buildManageMcpRows, buildManageSkillRows } from "./manage-model";
import type { MarketMcpEntry } from "./model";
import { MarketIcon } from "./MarketIcon";

type Props = {
  onBack: () => void;
  /** 「体验」:回聊天并预填使用草稿。 */
  onUse: (name: string) => void;
  /** 跳到设置页的技能配置(扫描路径等高级能力)。 */
  onOpenAdvancedSettings: () => void;
  /** 市场条目(用于 MCP 行匹配上游 logo)。 */
  mcpEntries: readonly MarketMcpEntry[];
};

type ManageTab = "plugins" | "skills";

export function ManageView({ onBack, onUse, onOpenAdvancedSettings, mcpEntries }: Props) {
  const { t } = useTranslation("marketplace");

  const [tab, setTab] = useState<ManageTab>("plugins");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<Array<{ name: string; description: string; source?: string; globally_disabled?: boolean }>>([]);
  const [servers, setServers] = useState<Array<{ name: string; connected: boolean; tool_count?: number }>>([]);
  const [toggleBusyName, setToggleBusyName] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async () => {
    const [skillsRes, mcpRes] = await Promise.all([
      window.agenticxDesktop.loadSkills().catch(() => null),
      window.agenticxDesktop.loadMcpStatus("").catch(() => null),
    ]);
    setSkills(skillsRes?.ok ? skillsRes.items ?? [] : []);
    setServers(
      mcpRes?.ok && Array.isArray(mcpRes.servers)
        ? mcpRes.servers.map((s) => ({ name: s.name, connected: s.connected, tool_count: s.tool_count }))
        : [],
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const skillRows = useMemo(() => buildManageSkillRows(skills, query), [skills, query]);
  const mcpRows = useMemo(() => buildManageMcpRows(servers, mcpEntries, query), [servers, mcpEntries, query]);

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
      await reload();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setToggleBusyName(null);
    }
  };

  const rows = tab === "skills" ? skillRows.length : mcpRows.length;

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
          {(["plugins", "skills"] as const).map((key) => (
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
              {t(`manageView.tabs.${key}`, { count: key === "skills" ? skills.length : servers.length })}
            </button>
          ))}
        </div>
        <div className="relative w-64 max-w-[45%]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
          <input
            type="text"
            className="w-full rounded-md border border-border bg-surface-card py-1.5 pl-8 pr-3 text-[13px] text-text-primary outline-none transition placeholder:text-text-faint focus:border-accent"
            placeholder={t(tab === "plugins" ? "manageView.searchPlugins" : "manageView.searchSkills")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t(tab === "plugins" ? "manageView.searchPlugins" : "manageView.searchSkills")}
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
