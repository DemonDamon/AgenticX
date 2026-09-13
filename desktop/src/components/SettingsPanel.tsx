import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import {
  chatUrlTransform,
  normalizeChatMarkdownContent,
  settingsMarkdownComponents,
  settingsRemarkPlugins,
} from "./messages/markdown-components";
import {
  Settings2,
  Cpu,
  Plug,
  Link2,
  Bookmark,
  Sparkles,
  Globe,
  Plus,
  Trash2,
  Wrench,
  Loader2,
  ChevronRight,
  ChevronDown,
  User,
  Activity,
  RefreshCw,
  SquarePen,
  Star,
  CircleMinus,
  CheckCircle2,
  Compass,
  Eye,
  EyeOff,
  History,
  ExternalLink,
  FolderOpen,
  Library,
  Mic,
  Network,
  Database,
  X,
  TriangleAlert,
  ShieldCheck,
} from "lucide-react";
import { Panel } from "./ds/Panel";
import {
  SETTINGS_HINT_CLASS,
  SETTINGS_INTRO_CLASS,
  SETTINGS_LABEL_CLASS,
  SETTINGS_NAV_ITEM_CLASS,
  SETTINGS_PAGE_TITLE_CLASS,
  SETTINGS_PANEL_TITLE_CLASS,
} from "./ds/settings-typography";
import { SettingsDropdown } from "./ds/SettingsDropdown";
import { Modal } from "./ds/Modal";
import { HoverTip } from "./ds/HoverTip";
import { ClampToFitText } from "./ds/ClampToFitText";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Avatar, ChatPane, ChatStyle, GroupChat, McpServer } from "../store";
import { useAppStore } from "../store";
import type { AppLocale } from "../i18n/locales";
import { UNRESTRICTED_CAPABILITY_LOCKS } from "../utils/enterprise-capability-policy";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import {
  RECOMMENDED_SKILLS,
  type RecommendedSkillTier,
} from "../data/recommended-skills";
import { buildArchscribeInstallPrompt } from "../utils/archscribe-install-prompt";
import { buildOfficeCliInstallPrompt } from "../utils/officecli-install-prompt";
import { buildSkillHubAgentInstallPrompt } from "../utils/skillhub-install-prompt";
import { filterAndRankSkills } from "../utils/skill-search";
import { shouldDisableMcpToggle } from "../utils/mcp-toggle-state";
import { ForwardPicker, type ForwardConfirmPayload } from "./ForwardPicker";
import { QrConnectModal } from "./QrConnectModal";
import { AutomationTab } from "./automation/AutomationTab";
import { AutomationTaskIcon } from "./icons/AutomationTaskIcon";
import { SkillPuzzleIcon } from "./icons/SkillPuzzleIcon";
import { PendingProposalsList } from "./settings/skills/PendingProposalsList";
import {
  RuntimeConfigSection,
  RUNTIME_DEFAULT_TASKSPACES,
  RUNTIME_MAX_TASKSPACES,
  RUNTIME_MAX_TOOL_ROUNDS,
  RUNTIME_MIN_TASKSPACES,
  RUNTIME_MIN_TOOL_ROUNDS,
} from "./automation/RuntimeConfigSection";
import { ToolSearchConfigSection } from "./automation/ToolSearchConfigSection";
import {
  StallNudgeConfigSection,
  type StallNudgeConfig,
} from "./automation/StallNudgeConfigSection";
import {
  UnattendedConfigSection,
  type UnattendedConfig,
} from "./automation/UnattendedConfigSection";
import {
  TokenBudgetConfigSection,
  normalizeTokenBudgetConfig,
  type TokenBudgetConfig,
} from "./automation/TokenBudgetConfigSection";
import { AccountTab } from "./AccountTab";
import { KnowledgeSettings, type KnowledgeSettingsHandle } from "./settings/knowledge/KnowledgeSettings";
import { DataSourcesSettings } from "./settings/datasources/DataSourcesSettings";
import { MemoryGraphExplorer } from "./memory/MemoryGraphExplorer";
import { TurnArchiveSettingsPanel } from "./memory/TurnArchiveSettingsPanel";
import { formatModelOptionLabel } from "../utils/model-display";
import {
  getProviderDisplayName,
  getProviderBrandColor,
  getProviderBrandTextColor,
  getProviderInitials,
  isOllamaLikeProvider,
  isProviderDeletable,
  isProviderDisplayNameEditable,
  makeCustomOllamaProviderId,
  makeCustomOpenAIProviderId,
  normalizeProviderBaseUrlForSave,
  previewProviderApiEndpoint,
  type ProviderInterfaceKind,
} from "../utils/provider-display";
import { PROVIDER_ICON_MAP } from "../utils/provider-icons";
import { normalizeProviderEntry } from "../utils/model-options";
import { classifyModelKind, isEmbeddingModelKind } from "../utils/model-kind";
import type { SettingsTab } from "../settings-tab";
import type { MCPDiscoveryHit } from "./settings/mcp/MCPDiscoveryPanel";
import { MCPMarketplacePanel } from "./settings/mcp/MCPMarketplacePanel";
import { MCPJsonEditorModal } from "./settings/mcp/MCPJsonEditorModal";
import { McpRemoteServerModal } from "./settings/mcp/McpRemoteServerModal";
import { McpRemoteServerDetail } from "./settings/mcp/McpRemoteServerDetail";
import { McpGatewayImportPanel } from "./settings/mcp/McpGatewayImportPanel";
import { ConnectorsTab } from "./settings/connectors/ConnectorsTab";
import { mcpRemoteHostLabel, mcpTransportBadgeLabel } from "../utils/mcp-remote-config";
import { WebSearchSettingsPanel, SuggestedQuestionsSettingsPanel } from "./settings/WebSearchSettingsPanel";
import {
  VoiceSettingsPanel,
  type VoiceSettingsPanelHandle,
} from "./settings/voice/VoiceSettingsPanel";
import {
  clampSettingsPanelSize,
  loadSettingsPanelSize,
  saveSettingsPanelSize,
  type SettingsPanelSize,
} from "../utils/settings-panel-size";
import {
  clampSettingsNavWidth,
  loadSettingsNavWidth,
  saveSettingsNavWidth,
} from "../utils/settings-nav-width";
import { useScrollbarOnScroll } from "../hooks/useScrollbarOnScroll";
import {
  formatBackendChipLabel,
  getBackendScope,
  getConnectionModeSync,
  readScopedLocalStorage,
  writeScopedLocalStorage,
} from "../utils/backend-scope";
import type { RunMode } from "../constants/confirm-strategy-options";
import type { SettingsFocus } from "../settings-tab";
import {
  SecurityCenterTab,
  type SecurityCenterTabHandle,
} from "./settings/security/SecurityCenterTab";
import { useTrinityConfig } from "./settings/trinity-config";
export type { SettingsTab } from "../settings-tab";
export { useTrinityConfig } from "./settings/trinity-config";

const MCP_MARKETPLACE_ID_MAP_KEY = "agenticx:mcp:marketplaceIdToNames";

function settingsMsgLooksFail(msg: string): boolean {
  return /失败|fail/i.test(msg);
}

function settingsMsgLooksNotFound(msg: string): boolean {
  return /未找到|not found/i.test(msg);
}

function settingsMsgLooksHighRisk(msg: string): boolean {
  return /高危|high.?risk/i.test(msg);
}

function RemoteBackendHintBanner({ kind = "local-only" }: { kind?: "synced" | "local-only" }) {
  const { t } = useTranslation("settings");
  const mode = getConnectionModeSync();
  if (mode !== "remote") return null;
  const host = getBackendScope();
  const hostLabel = formatBackendChipLabel(host, "remote");
  const bannerPath = {
    mode: <strong className="text-text-muted" />,
    host: <strong className="text-text-muted" />,
    path: <code className="text-[10px] text-text-muted" />,
  };
  if (kind === "synced") {
    return (
      <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs leading-relaxed text-text-subtle">
        <p>
          <Trans t={t} i18nKey="remoteBanner.synced" values={{ hostLabel }} components={bannerPath} />
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs leading-relaxed text-text-subtle">
      <p>
        <Trans t={t} i18nKey="remoteBanner.localOnlyP1" values={{ hostLabel }} components={bannerPath} />
      </p>
      <p className="mt-1.5 text-text-faint">
        <Trans t={t} i18nKey="remoteBanner.localOnlyP2" components={{ path: <code className="text-[10px]" /> }} />
      </p>
    </div>
  );
}

export type FavoriteForwardContext = {
  sourceSessionId: string;
  content: string;
  role?: string;
};

const ALL_PROVIDERS = [
  "openai", "anthropic", "volcengine", "bailian",
  "zhipu", "qianfan", "minimax", "kimi", "deepseek", "ollama",
] as const;

/** LiteLLM routes: show optional drop_params toggle for strict OpenAI-compatible gateways. */
const DROP_PARAMS_CAPABLE_PROVIDERS = new Set<string>(["openai", "anthropic", "ollama"]);

type ProviderEntry = {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
  enabled: boolean;
  dropParams: boolean;
  /** 自定义服务厂商展示名（写入 config display_name） */
  displayName?: string;
  /** 自定义厂商接口范式：OpenAI 兼容或 Ollama 原生 */
  interface?: ProviderInterfaceKind;
};

/** 至少填写了密钥或自定义 API 地址之一，才视为已配置（与「留空使用默认」的隐式地址区分）。 */
function providerCredentialed(e: Pick<ProviderEntry, "apiKey" | "baseUrl"> | undefined): boolean {
  if (!e) return false;
  return !!(e.apiKey ?? "").trim() || !!(e.baseUrl ?? "").trim();
}

function providerEffectiveOn(e: ProviderEntry | undefined): boolean {
  if (!e) return false;
  return e.enabled !== false && providerCredentialed(e);
}

function isLikelyLocalImagePath(raw: string): boolean {
  const value = String(raw || "").trim();
  if (!value) return false;
  // Vite build assets look like "/assets/xxx.svg"; those should be used directly in <img src>.
  if (value.startsWith("/assets/")) return false;
  if (value.startsWith("file://")) return true;
  if (value.startsWith("/")) return true;
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function providerEntryFromSaved(saved: Partial<ProviderEntry> | undefined): ProviderEntry {
  if (saved != null && typeof saved !== "object") {
    return {
      apiKey: "",
      baseUrl: "",
      model: "",
      models: [],
      enabled: false,
      dropParams: false,
    };
  }
  const raw = (saved ?? {}) as Partial<ProviderEntry> & { display_name?: string };
  const apiKey = String(saved?.apiKey ?? "");
  const baseUrl = String(saved?.baseUrl ?? "");
  const cred = providerCredentialed({ apiKey, baseUrl });
  const models = saved?.models;
  const dn = raw.displayName?.trim() || raw.display_name?.trim();
  const iface =
    saved?.interface === "openai" || saved?.interface === "ollama"
      ? saved.interface
      : undefined;
  return {
    apiKey,
    baseUrl,
    model: String(saved?.model ?? ""),
    models: Array.isArray(models) ? models : [],
    enabled: cred && saved?.enabled !== false,
    dropParams: saved?.dropParams === true,
    displayName: dn || undefined,
    interface: iface,
  };
}

function cloneProviderDraftMap(draft: Record<string, ProviderEntry>): Record<string, ProviderEntry> {
  const out: Record<string, ProviderEntry> = {};
  for (const [name, entry] of Object.entries(draft)) {
    out[name] = { ...entry, models: [...entry.models] };
  }
  return out;
}

function normalizeProviderDraftForCompare(
  draft: Record<string, ProviderEntry>,
): Record<string, ProviderEntry> {
  const normalized: Record<string, ProviderEntry> = {};
  for (const [name, entry] of Object.entries(draft)) {
    normalized[name] = normalizeProviderEntry({
      ...entry,
      baseUrl: normalizeProviderBaseUrlForSave(name, entry.baseUrl, entry),
    });
  }
  return normalized;
}

function providerEntryConfigsEqual(a: ProviderEntry, b: ProviderEntry): boolean {
  return (
    a.apiKey === b.apiKey
    && a.baseUrl === b.baseUrl
    && a.model === b.model
    && a.enabled === b.enabled
    && a.dropParams === b.dropParams
    && (a.displayName ?? "") === (b.displayName ?? "")
    && (a.interface ?? "") === (b.interface ?? "")
    && a.models.length === b.models.length
    && a.models.every((model, index) => model === b.models[index])
  );
}

function providerDraftMapsEqual(
  a: Record<string, ProviderEntry>,
  b: Record<string, ProviderEntry>,
): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key, index) => {
    if (key !== keysB[index]) return false;
    return providerEntryConfigsEqual(a[key]!, b[key]!);
  });
}

const MCP_PRIMARY_CONFIG_PATH = "~/.agenticx/mcp.json";
const BUNDLED_DEFAULT_MCP_NAMES_FALLBACK = ["browser-use", "firecrawl"] as const;

/** 与后端 `connection_state` 对齐；缺省时按 connected 推断（兼容旧 Studio） */
function resolveMcpRowPresentation(server: McpServer, t: TFunction): {
  dotClass: string;
  statusLine: string;
  detail?: string;
} {
  const st =
    server.connection_state || (server.connected ? "healthy" : "disconnected");
  if (st === "error") {
    return {
      dotClass: "bg-rose-500",
      statusLine: t("mcp.errorStillConnected"),
      detail: server.error_detail?.trim(),
    };
  }
  if (st === "healthy") {
    const n = server.tool_count ?? 0;
    return {
      dotClass: "bg-emerald-400",
      statusLine: n > 0 ? t("mcp.connectedTools", { count: n }) : t("mcp.connected"),
    };
  }
  return {
    dotClass: "bg-zinc-500",
    statusLine: t("mcp.disconnected"),
  };
}

type EmailPresetId = "qq" | "163" | "gmail" | "outlook" | "custom";

type EmailSettingsForm = {
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  from_email: string;
  default_to_email: string;
};

type ToolStatusItem = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  version?: string;
  install_command?: string;
  auto_installable?: boolean;
};

type ToolInstallState = {
  requestId: string;
  percent: number;
  phase: string;
  message: string;
  error?: string;
};

type SkillItem = {
  skill_id?: string;
  name: string;
  description: string;
  location: string;
  base_dir?: string;
  source?: string;
  tag?: string;
  icon?: string;
  content_hash?: string;
  conflict_count?: number;
  variants?: Array<{
    skill_id?: string;
    source?: string;
    base_dir?: string;
    location?: string;
    content_hash?: string;
  }>;
};

type SkillScanPresetRow = {
  id: string;
  label: string;
  path: string;
  enabled: boolean;
};

function normalizedPath(path?: string): string {
  return String(path ?? "").replace(/\\/g, "/").toLowerCase();
}

function inferSourceFromBaseDir(baseDir?: string): string | null {
  const p = normalizedPath(baseDir);
  if (!p) return null;
  if (p.includes("/agenticx/skills/")) return "builtin";
  if (p.includes("/.agenticx/skills/registry/")) return "registry";
  if (p.includes("/.agenticx/skills/bundles/")) return "bundle";
  if (p.includes("/.cursor/skills/")) return "cursor";
  if (p.includes("/.claude/skills/")) return "claude";
  if (p.includes("/.agents/skills/")) return "agents";
  if (p.includes("/.agent/skills/")) return "agent_global";
  return null;
}

function effectiveSkillSource(skill: SkillItem): string {
  const raw = String(skill.source ?? "").trim();
  if (raw && raw !== "unknown" && raw !== "custom") return raw;
  const inferred = inferSourceFromBaseDir(skill.base_dir);
  if (inferred) return inferred;
  return raw || "custom";
}

function effectiveSkillLocation(skill: SkillItem): "project" | "global" {
  const src = effectiveSkillSource(skill);
  if (["cursor", "claude", "agents", "agent_global", "skillhub", "registry", "bundle"].includes(src)) {
    return "global";
  }
  return skill.location === "project" ? "project" : "global";
}

function skillSourceBadge(source: string | undefined, t: TFunction): { label: string; className: string } {
  const base = "shrink-0 rounded-full border px-1.5 text-[10px]";
  switch (source) {
    case "builtin":
      return { label: t("skills.sourceBuiltin"), className: `${base} border-zinc-500/30 bg-zinc-500/10 text-zinc-400` };
    case "cursor":
      return { label: "Cursor", className: `${base} border-sky-500/30 bg-sky-500/10 text-sky-400` };
    case "claude":
      return { label: "Claude", className: `${base} border-orange-500/30 bg-orange-500/10 text-orange-400` };
    case "skillhub":
      return { label: "SkillHub", className: `${base} border-cyan-500/30 bg-cyan-500/10 text-cyan-300` };
    case "registry":
      // ClawHub 安装技能：棕褐底 + 珊瑚色字（与品牌参考一致）
      return {
        label: "ClawHub",
        className: `${base} border-[#5c4038]/80 bg-[#2f2019] text-[#eba899]`,
      };
    case "bundle":
      return { label: "Bundle", className: `${base} border-indigo-500/30 bg-indigo-500/10 text-indigo-400` };
    case "agents":
      return {
        label: t("skills.sourceAgentsGlobal"),
        className: `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-400`,
      };
    case "agent_global":
      return {
        label: t("skills.sourceAgentGlobal"),
        className: `${base} border-teal-500/30 bg-teal-500/10 text-teal-400`,
      };
    case "project_agents":
      return {
        label: t("skills.sourceProjectAgents"),
        className: `${base} border-cyan-500/30 bg-cyan-500/10 text-cyan-400`,
      };
    case "project_agent":
      return {
        label: t("skills.sourceProjectAgent"),
        className: `${base} border-cyan-500/30 bg-cyan-500/5 text-cyan-300`,
      };
    case "agenticx":
      return { label: t("skills.sourceSelf"), className: `${base} border-purple-500/30 bg-purple-500/10 text-purple-400` };
    case "agent_created":
      return { label: t("skills.sourceSelf"), className: `${base} border-purple-500/30 bg-purple-500/10 text-purple-300` };
    case "custom":
      return { label: t("skills.sourceCustom"), className: `${base} border-border bg-surface-panel text-text-faint` };
    default:
      return { label: t("skills.sourceOther"), className: `${base} border-border bg-surface-panel text-text-faint` };
  }
}

function skillLocationDisplay(locationLabel: "全局" | "项目", t: TFunction): string {
  return locationLabel === "项目" ? t("skills.location.project") : t("skills.location.global");
}

function getSkillCategory(skill: SkillItem): "third-party" | "custom" | "builtin" {
  const src = effectiveSkillSource(skill);
  if (["registry", "bundle", "cursor", "claude", "skillhub"].includes(src)) return "third-party";
  if (["builtin"].includes(src)) return "builtin";
  // All other sources including 'agenticx', 'agents', 'agent_created', 'custom', 'unknown' are treated as custom/user-created
  return "custom";
}

const SKILLS_SECTION_PANEL_TITLE_CLASS = SETTINGS_PANEL_TITLE_CLASS;

const SKILLS_GROUP_TITLE_CLASS = SETTINGS_PANEL_TITLE_CLASS;

function SkillRowButton({
  skill,
  isActive,
  isExpanded,
  detailContent,
  detailLoading,
  recentMarketSkillName,
  locationLabel,
  preferredSource,
  onChoosePreferredSource,
  onActivate,
  onExpandDetail,
  onCollapseDetail,
  globalSkillEnabled,
  skillScanBusy,
  onToggleGlobalSkill,
}: {
  skill: SkillItem;
  isActive: boolean;
  isExpanded: boolean;
  detailContent: string | null;
  detailLoading: boolean;
  recentMarketSkillName: string | null;
  locationLabel: "全局" | "项目";
  preferredSource?: string;
  onChoosePreferredSource: (name: string, source: string) => void;
  onActivate: (name: string) => void;
  onExpandDetail: (name: string) => void;
  onCollapseDetail: () => void;
  globalSkillEnabled: boolean;
  skillScanBusy: boolean;
  onToggleGlobalSkill: (name: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const src = skillSourceBadge(effectiveSkillSource(skill), t);
  const conflictCount = Number(skill.conflict_count ?? 0);
  const variants = Array.isArray(skill.variants) ? skill.variants : [];
  const uniqueSources = Array.from(
    new Set(
      variants
        .map((v) => String(v?.source ?? "").trim())
        .filter(Boolean),
    ),
  );
  const selectedSource = preferredSource && uniqueSources.includes(preferredSource)
    ? preferredSource
    : effectiveSkillSource(skill);
  const locClass =
    locationLabel === "项目"
      ? "shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400"
      : "shrink-0 rounded-full border border-border bg-surface-panel px-1.5 text-[10px] text-text-faint";
  return (
    <div
      className={`w-full px-4 py-3 transition ${
        isExpanded || isActive
          ? "bg-[var(--settings-accent-subtle-bg)]"
          : skill.name === recentMarketSkillName
            ? "bg-amber-500/5"
            : "bg-surface-base hover:bg-surface-hover"
      } ${!globalSkillEnabled ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onActivate(skill.name)}
          onDoubleClick={() => void onExpandDetail(skill.name)}
          title={t("skills.expandTitle")}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">{skill.name}</span>
            {skill.name === recentMarketSkillName && (
              <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 text-[10px] text-amber-300">
                {t("skills.justInstalled")}
              </span>
            )}
            <span className={src.className}>{src.label}</span>
            <span className={locClass}>{skillLocationDisplay(locationLabel, t)}</span>
            {skill.tag ? (
              <span className="shrink-0 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 text-[10px] text-violet-300">
                {skill.tag}
              </span>
            ) : null}
            {skill.icon ? (
              <span className="shrink-0 rounded-full border border-border bg-surface-panel px-1.5 text-[10px] text-text-faint">
                icon:{skill.icon}
              </span>
            ) : null}
            {conflictCount > 1 ? (
              <span className="shrink-0 rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 text-[10px] text-rose-300">
                {t("skills.nameConflict", { count: conflictCount })}
              </span>
            ) : null}
          </div>
          {skill.description ? (
            <p className="mt-1.5 truncate text-xs text-text-muted">{skill.description}</p>
          ) : null}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          <SettingsSwitch
            checked={globalSkillEnabled}
            disabled={skillScanBusy}
            aria-label={t("skills.enableSkill", { name: skill.name })}
            onChange={(next) => onToggleGlobalSkill(skill.name, next)}
          />
        </div>
      </div>
      {conflictCount > 1 ? (
        <div
          className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-text-faint"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="shrink-0">{t("skills.defaultSource")}</span>
          <SettingsDropdown
            value={selectedSource}
            displayLabel={skillSourceBadge(selectedSource, t).label}
            options={uniqueSources.map((source) => ({
              value: source,
              label: skillSourceBadge(source, t).label,
            }))}
            onChange={(source) => onChoosePreferredSource(skill.name, source)}
            size="inline"
            menuPortal
            className="w-fit shrink-0"
            title={t("skills.preferredSourceTitle")}
          />
        </div>
      ) : null}
      {isExpanded ? (
        <div className="mt-3 rounded-md border border-[var(--settings-accent-border-muted)] bg-surface-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-[var(--settings-accent-fg)]">SKILL.md</span>
            <button
              type="button"
              className="text-xs text-text-faint transition hover:text-text-primary"
              onClick={(e) => {
                e.stopPropagation();
                onCollapseDetail();
              }}
            >
              {t("skills.closeDetail")}
            </button>
          </div>
          {detailLoading ? (
            <div className="px-3 py-3 text-xs text-text-faint">{t("skills.loadingDetail")}</div>
          ) : (
            <pre className="max-h-[55vh] overflow-y-auto px-3 py-2 text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap break-words">
              {detailContent ?? ""}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SkillList({
  skills,
  ...props
}: {
  skills: SkillItem[];
  locationLabel: "全局" | "项目";
  activeSkillName: string | null;
  expandedSkillName: string | null;
  detail: { name: string; content: string } | null;
  loadingDetail: boolean;
  recentMarketSkillName: string | null;
  preferredSources: Record<string, string>;
  onChoosePreferredSource: (name: string, source: string) => void;
  onActivate: (name: string) => void;
  onExpandDetail: (name: string) => void;
  onCollapseDetail: () => void;
  disabledSkillNames: string[];
  skillScanBusy: boolean;
  onToggleGlobalSkill: (name: string, enabled: boolean) => void;
}) {
  const PREVIEW_COUNT = 15;
  const [showAll, setShowAll] = useState(false);
  const shouldCollapse = skills.length > PREVIEW_COUNT;
  const visibleSkills = showAll || !shouldCollapse ? skills : skills.slice(0, PREVIEW_COUNT);
  const remaining = Math.max(0, skills.length - visibleSkills.length);
  const { t } = useTranslation("settings");

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-base">
      <div className="divide-y divide-border">
        {visibleSkills.map((skill) => (
          <SkillRowButton
            key={skill.name}
            skill={skill}
            isActive={props.activeSkillName === skill.name}
            isExpanded={props.expandedSkillName === skill.name}
            detailLoading={props.expandedSkillName === skill.name && props.loadingDetail && props.detail?.name !== skill.name}
            detailContent={props.expandedSkillName === skill.name && props.detail?.name === skill.name ? props.detail.content : null}
            globalSkillEnabled={!props.disabledSkillNames.includes(skill.name)}
            {...props}
          />
        ))}
      </div>
      {remaining > 0 && (
        <button
          type="button"
          className="w-full border-t border-border bg-surface-panel py-2.5 text-xs font-medium text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
          onClick={() => setShowAll(true)}
        >
          {t("skills.showRemaining", { count: remaining })}
        </button>
      )}
    </div>
  );
}

function SkillGroup({
  title,
  skills,
  ...props
}: {
  title: string;
  skills: SkillItem[];
  locationLabel: "全局" | "项目";
  activeSkillName: string | null;
  expandedSkillName: string | null;
  detail: { name: string; content: string } | null;
  loadingDetail: boolean;
  recentMarketSkillName: string | null;
  preferredSources: Record<string, string>;
  onChoosePreferredSource: (name: string, source: string) => void;
  onActivate: (name: string) => void;
  onExpandDetail: (name: string) => void;
  onCollapseDetail: () => void;
  disabledSkillNames: string[];
  skillScanBusy: boolean;
  onToggleGlobalSkill: (name: string, enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (skills.length === 0) return null;

  return (
    <div className="mb-4 last:mb-0">
      <button
        type="button"
        className="mb-2 flex w-full items-center justify-between gap-2 text-left transition hover:text-text-primary"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`min-w-0 truncate ${SKILLS_GROUP_TITLE_CLASS}`}>
          {title} ({skills.length})
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      {expanded && <SkillList skills={skills} {...props} />}
    </div>
  );
}

function SkillsLocationSection({
  skills,
  title,
  locationLabel,
  search,
  onSearchChange,
  onRefresh,
  listLoading,
  showWhenEmpty,
  ...props
}: {
  skills: SkillItem[];
  title: string;
  locationLabel: "全局" | "项目";
  search?: string;
  onSearchChange?: (value: string) => void;
  onRefresh?: () => void;
  listLoading?: boolean;
  showWhenEmpty?: boolean;
  activeSkillName: string | null;
  expandedSkillName: string | null;
  detail: { name: string; content: string } | null;
  loadingDetail: boolean;
  recentMarketSkillName: string | null;
  preferredSources: Record<string, string>;
  onChoosePreferredSource: (name: string, source: string) => void;
  onActivate: (name: string) => void;
  onExpandDetail: (name: string) => void;
  onCollapseDetail: () => void;
  disabledSkillNames: string[];
  skillScanBusy: boolean;
  onToggleGlobalSkill: (name: string, enabled: boolean) => void;
}) {
  const { t } = useTranslation("settings");
  const isGlobal = locationLabel === "全局";
  if (skills.length === 0 && !showWhenEmpty) return null;

  return (
    <Panel
      title={title}
      collapsible
      defaultCollapsed={false}
      className="mb-4"
      titleClassName={SKILLS_SECTION_PANEL_TITLE_CLASS}
    >
      <div className="pt-1">
        {isGlobal && onSearchChange && onRefresh ? (
          <div className="mb-3 flex gap-2">
            <input
              className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
              placeholder={t("skills.searchPh")}
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <button
              type="button"
              className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
              onClick={() => onRefresh()}
              disabled={listLoading}
            >
              {t("skills.refresh")}
            </button>
          </div>
        ) : null}
        {skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-faint">
            {t("skills.noGlobalMatch")}
          </div>
        ) : isGlobal ? (
          <>
            <SkillGroup title={t("skills.groupThirdParty")} skills={skills.filter(s => getSkillCategory(s) === "third-party")} locationLabel={locationLabel} {...props} />
            <SkillGroup title={t("skills.groupCustom")} skills={skills.filter(s => getSkillCategory(s) === "custom")} locationLabel={locationLabel} {...props} />
            <SkillGroup title={t("skills.groupBuiltin")} skills={skills.filter(s => getSkillCategory(s) === "builtin")} locationLabel={locationLabel} {...props} />
          </>
        ) : (
          <SkillList skills={skills} locationLabel={locationLabel} {...props} />
        )}
      </div>
    </Panel>
  );
}

type RegistrySearchItem = {
  name: string;
  description: string;
  version: string;
  author: string;
  source: string;
  source_type: string;
};

/** Matches SkillHubSearchResult.items from preload / agx serve. */
type SkillHubRow = {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads?: string | number;
};

type Props = {
  open: boolean;
  defaultProvider: string;
  providers: Record<string, ProviderEntry>;
  sessionId: string;
  /** Studio API base URL (for 收藏列表等需要直连后端的 Tab). */
  apiBase: string;
  apiToken: string;
  mcpServers: McpServer[];
  onRefreshMcp: (sessionId?: string) => Promise<void>;
  runMode: RunMode;
  theme: "dark" | "light" | "dim";
  chatStyle: ChatStyle;
  onThemeChange: (theme: "dark" | "light" | "dim") => void;
  onChatStyleChange: (style: ChatStyle) => void;
  onRunModeChange: (mode: RunMode) => Promise<void> | void;
  onClose: () => void;
  onSave: (result: {
    defaultProvider: string;
    providers: Record<string, ProviderEntry>;
  }) => Promise<void>;
  panes: ChatPane[];
  avatars: Avatar[];
  groups: GroupChat[];
  onForwardFavorite: (
    ctx: FavoriteForwardContext,
    payload: ForwardConfirmPayload,
    note: string
  ) => Promise<void>;
};

/** 模型行健康检测：无记录视为 idle */
type ModelHealthEntry =
  | { phase: "checking" }
  | { phase: "ok"; ms: number }
  | { phase: "error" }
  | { phase: "unauthorized"; error?: string };

function healthEntryFromCheckResult(res: HealthCheckResult): ModelHealthEntry {
  if (res.ok) {
    const ms = typeof res.latencyMs === "number" ? res.latencyMs : 0;
    return { phase: "ok", ms };
  }
  if (res.reason === "unauthorized") {
    return { phase: "unauthorized", error: res.error };
  }
  return { phase: "error" };
}

function unauthorizedHoverLabel(error: string | undefined, t: TFunction): string {
  const trimmed = String(error || "").trim();
  if (!trimmed) return t("provider.unauthorizedHover");
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

/** 品牌 Avatar：优先用内联 SVG 图标，自定义厂商降级为品牌色首字母 */
function ProviderAvatar({
  providerId,
  size = 28,
  entry,
}: {
  providerId: string;
  size?: number;
  entry?: { displayName?: string; baseUrl?: string; interface?: string } | null;
}) {
  const IconComp = PROVIDER_ICON_MAP[providerId];
  const bg = getProviderBrandColor(providerId);
  const color = getProviderBrandTextColor(providerId);
  const r = size <= 28 ? "rounded-full" : "rounded-xl";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden shadow-sm ${r}`}
      style={{ width: size, height: size, backgroundColor: bg, color }}
    >
      {IconComp ? (
        <IconComp size={Math.round(size * 0.64)} className="shrink-0" />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.4), fontWeight: 700, lineHeight: 1 }}>
          {getProviderInitials(providerId, entry)}
        </span>
      )}
    </span>
  );
}

function formatHealthLatencyMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function ModelCapabilityBadges({
  className = "",
  provider = "",
  model = "",
}: {
  className?: string;
  provider?: string;
  model?: string;
}) {
  const { t } = useTranslation("settings");
  const kind = classifyModelKind(provider, model);
  if (isEmbeddingModelKind(kind)) {
    const label = kind === "multimodal_embedding" ? t("provider.capMmEmbedding") : t("provider.capEmbedding");
    return (
      <div className={`flex items-center gap-1.5 ${className}`.trim()}>
        <HoverTip label={label}>
          <span
            role="img"
            aria-label={t("provider.capAbility", { label })}
            className="inline-flex h-5 items-center justify-center rounded-full border border-teal-500/35 bg-teal-500/12 px-1.5 text-[11px] font-medium text-teal-400"
          >
            {label}
          </span>
        </HoverTip>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-1.5 ${className}`.trim()}>
      <HoverTip label={t("provider.capReasoning")}>
        <span
          role="img"
          aria-label={t("provider.capReasoningAria")}
          className="inline-flex h-5 min-w-8 items-center justify-center rounded-full border border-indigo-500/35 bg-indigo-500/12 px-1.5 text-indigo-400"
        >
          <Sparkles className="h-3 w-3" aria-hidden />
        </span>
      </HoverTip>
      <HoverTip label={t("provider.capTools")}>
        <span
          role="img"
          aria-label={t("provider.capToolsAria")}
          className="inline-flex h-5 min-w-8 items-center justify-center rounded-full border border-amber-500/35 bg-amber-500/12 px-1.5 text-amber-400"
        >
          <Wrench className="h-3 w-3" aria-hidden />
        </span>
      </HoverTip>
    </div>
  );
}

const TAB_DEFS: { id: SettingsTab; icon: typeof Settings2 }[] = [
  { id: "account", icon: User },
  { id: "general", icon: Settings2 },
  { id: "provider", icon: Cpu },
  { id: "mcp", icon: Plug },
  { id: "connectors", icon: Link2 },
  { id: "tools", icon: Wrench },
  { id: "skills", icon: SkillPuzzleIcon },
  // Plan-Id: machi-kb-stage1-local-mvp
  { id: "knowledge", icon: Library },
  { id: "data_sources", icon: Database },
  { id: "memory", icon: Network },
  { id: "automation", icon: AutomationTaskIcon },
  { id: "voice", icon: Mic },
  { id: "favorites", icon: Bookmark },
  { id: "server", icon: Globe },
  { id: "security", icon: ShieldCheck },
];

const EMAIL_PRESETS: Array<{
  id: EmailPresetId;
  smtp_host: string;
  smtp_port: number;
  smtp_use_tls: boolean;
}> = [
  { id: "qq", smtp_host: "smtp.qq.com", smtp_port: 587, smtp_use_tls: true },
  { id: "163", smtp_host: "smtp.163.com", smtp_port: 465, smtp_use_tls: true },
  { id: "gmail", smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_use_tls: true },
  { id: "outlook", smtp_host: "smtp.office365.com", smtp_port: 587, smtp_use_tls: true },
  { id: "custom", smtp_host: "", smtp_port: 587, smtp_use_tls: true },
];

const DEFAULT_EMAIL_SETTINGS: EmailSettingsForm = {
  enabled: true,
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_use_tls: true,
  from_email: "",
  default_to_email: "bingzhenli@hotmail.com",
};

function inferPresetFromConfig(config: EmailSettingsForm): EmailPresetId {
  const host = config.smtp_host.trim().toLowerCase();
  if (host === "smtp.qq.com") return "qq";
  if (host === "smtp.163.com") return "163";
  if (host === "smtp.gmail.com") return "gmail";
  if (host === "smtp.office365.com") return "outlook";
  return "custom";
}

function normalizeEmailSettings(input: unknown): EmailSettingsForm {
  if (!input || typeof input !== "object") return { ...DEFAULT_EMAIL_SETTINGS };
  const row = input as Partial<EmailSettingsForm>;
  return {
    enabled: Boolean(row.enabled ?? true),
    smtp_host: String(row.smtp_host ?? ""),
    smtp_port: Number(row.smtp_port ?? 587) || 587,
    smtp_username: String(row.smtp_username ?? ""),
    smtp_password: String(row.smtp_password ?? ""),
    smtp_use_tls: Boolean(row.smtp_use_tls ?? true),
    from_email: String(row.from_email ?? ""),
    default_to_email: String(row.default_to_email ?? "bingzhenli@hotmail.com"),
  };
}

type RegistryTool = { name: string; description: string; category: string; is_meta: boolean };

const CATEGORY_ORDER = ["system", "filesystem", "code", "document", "agent", "memory", "data_source", "scheduling", "mcp", "skill", "meta", "other"];

const TOOL_LABEL_IDS = [
  "bash_exec", "file_read", "file_write", "file_edit", "list_files", "codegen",
  "lsp_goto_definition", "lsp_find_references", "lsp_hover", "lsp_diagnostics",
  "mcp_connect", "mcp_call", "mcp_import", "skill_use", "skill_list", "skill_manage",
  "todo_write", "scratchpad_write", "scratchpad_read", "memory_append", "memory_search",
  "session_search", "code_search", "code_index_create", "code_index_status",
  "code_index_clear", "code_index_cancel", "liteparse", "schedule_task",
  "list_scheduled_tasks", "cancel_scheduled_task", "spawn_subagent", "cancel_subagent",
  "retry_subagent", "query_subagent_status", "check_resources", "recommend_subagent_model",
  "list_skills", "list_mcps", "send_bug_report_email", "update_email_config",
  "set_taskspace", "delegate_to_avatar", "read_avatar_workspace", "chat_with_avatar",
] as const;

function categoryLabels(t: TFunction): Record<string, string> {
  return {
    system: t("tools.categories.system"),
    filesystem: t("tools.categories.filesystem"),
    code: t("tools.categories.code"),
    mcp: t("tools.categories.mcp"),
    skill: t("tools.categories.skill"),
    agent: t("tools.categories.agent"),
    memory: t("tools.categories.memory"),
    document: t("tools.categories.document"),
    scheduling: t("tools.categories.scheduling"),
    data_source: t("tools.categories.data_source"),
    meta: t("tools.categories.meta"),
    other: t("tools.categories.other"),
  };
}

function toolLabels(t: TFunction): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of TOOL_LABEL_IDS) {
    out[id] = t(`tools.labels.${id}`);
  }
  return out;
}

function toolDisplayDescription(name: string, apiDescription: string, t: TFunction): string {
  const key = `tools.descriptions.${name}`;
  const translated = t(key);
  return translated === key ? apiDescription : translated;
}

// ---------------------------------------------------------------------------
// Tools Tab
// ---------------------------------------------------------------------------

/** 与 `GET/PUT /api/tools/policy` 的 tools_options 字段对齐（仅含 UI 用到的键）。 */
type StudioToolsOptions = {
  bash_exec?: { default_timeout_sec?: number };
};

/** 预授权工具卡片下展示「高级设置」白名单（与后端 tools_options 白名单对齐）。 */
const ADVANCED_TOOL_POLICY_NAMES = new Set<string>(["bash_exec"]);
const BASH_DEFAULT_TIMEOUT_MIN = 30;
const BASH_DEFAULT_TIMEOUT_MAX = 3600;

type CcBridgePanelHandle = {
  save: () => Promise<{ ok: boolean; error?: string }>;
};

type ToolsTabHandle = {
  /** 持久化工具页内待提交的项（bash 默认超时 + 最大工具轮数 + CC Bridge 配置）。 */
  saveAll: () => Promise<{ ok: boolean; error?: string }>;
};

const CcBridgeSettingsPanel = forwardRef<CcBridgePanelHandle, Record<string, never>>(
  function CcBridgeSettingsPanel(_props, ref) {
  const { t } = useTranslation("settings");
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"headless" | "visible_tui">("headless");
  const [showToken, setShowToken] = useState(false);
  const [idleStopSeconds, setIdleStopSeconds] = useState("600");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (apiToken) h["x-agx-desktop-token"] = apiToken;
    return h;
  }, [apiToken]);

  const parseJsonOrError = useCallback(async (res: Response): Promise<any> => {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      const short = text.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(
        t("commonSettings.nonJsonBackend", { status: res.status, snippet: short }),
      );
    }
  }, [t]);

  const load = useCallback(async () => {
    setLoading(true);
    setMsg("");
    try {
      const token = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
      const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
      const headers: Record<string, string> = {};
      if (token) headers["x-agx-desktop-token"] = token;
      const res = await fetch(`${effectiveBase}/api/cc-bridge/config`, { headers });
      const data = (await parseJsonOrError(res)) as {
        ok?: boolean;
        url?: string;
        token?: string;
        idle_stop_seconds?: number;
        mode?: string;
        mode_effective?: string;
        mode_env_override?: string;
        error?: string;
      };
      if (data.ok) {
        setUrl((data.url || "http://127.0.0.1:9742").trim());
        setToken(data.token || "");
        const m = (data.mode || "headless").toLowerCase();
        setMode(m === "visible_tui" ? "visible_tui" : "headless");
        const effective = String(data.mode_effective || "").toLowerCase();
        const envOverride = String(data.mode_env_override || "").trim();
        if (effective && effective !== m && envOverride) {
          setMsg(t("tools.cc.envOverride", { env: envOverride, effective }));
        }
        const idle = Number.isFinite(data.idle_stop_seconds as number)
          ? Math.max(0, Math.min(86400, Math.round(Number(data.idle_stop_seconds))))
          : 600;
        setIdleStopSeconds(String(idle));
      } else {
        setMsg(data.error || t("commonSettings.loadFailed"));
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, [apiToken, backendUrl, parseJsonOrError]);

  useEffect(() => {
    void load();
  }, [load]);

  useImperativeHandle(
    ref,
    () => ({
      async save() {
        if (loading) {
          return { ok: false, error: t("tools.cc.stillLoading") };
        }
        setBusy(true);
        setMsg("");
        try {
          const tokenHeader = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
          const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (tokenHeader) headers["x-agx-desktop-token"] = tokenHeader;
          const res = await fetch(`${effectiveBase}/api/cc-bridge/config`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              url: url.trim(),
              token,
              mode,
              idle_stop_seconds: Math.max(0, Math.min(86400, parseInt(idleStopSeconds || "600", 10) || 600)),
            }),
          });
          const data = (await parseJsonOrError(res)) as {
            ok?: boolean;
            url?: string;
            token?: string;
            idle_stop_seconds?: number;
            mode?: string;
            mode_effective?: string;
            mode_env_override?: string;
            detail?: unknown;
          };
          if (data.ok) {
            setUrl((data.url || url).trim());
            setToken(data.token || token);
            const m = (data.mode || mode).toLowerCase();
            setMode(m === "visible_tui" ? "visible_tui" : "headless");
            const effective = String(data.mode_effective || "").toLowerCase();
            const envOverride = String(data.mode_env_override || "").trim();
            const idle = Number.isFinite(data.idle_stop_seconds as number)
              ? Math.max(0, Math.min(86400, Math.round(Number(data.idle_stop_seconds))))
              : 600;
            setIdleStopSeconds(String(idle));
            const hint =
              effective && effective !== m && envOverride
                ? t("tools.cc.savedOverride", { env: envOverride, effective })
                : t("commonSettings.saved");
            setMsg(hint);
            return { ok: true };
          }
          const d = data.detail;
          const errText = typeof d === "string" ? d : d != null ? JSON.stringify(d) : t("commonSettings.saveFailed");
          setMsg(errText);
          return { ok: false, error: errText };
        } catch (e) {
          const errText = String(e);
          setMsg(errText);
          return { ok: false, error: errText };
        } finally {
          setBusy(false);
        }
      },
    }),
    [apiToken, backendUrl, idleStopSeconds, loading, mode, parseJsonOrError, t, token, url],
  );

  const regen = async () => {
    setBusy(true);
    setMsg("");
    try {
      const tokenHeader = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
      const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
      const headers: Record<string, string> = {};
      if (tokenHeader) headers["x-agx-desktop-token"] = tokenHeader;
      const res = await fetch(`${effectiveBase}/api/cc-bridge/token/regenerate`, {
        method: "POST",
        headers,
      });
      const data = (await parseJsonOrError(res)) as { ok?: boolean; token?: string; detail?: unknown };
      if (data.ok && data.token) {
        setToken(data.token);
        setMsg(t("tools.cc.regenDone"));
      } else {
        const d = data.detail;
        setMsg(typeof d === "string" ? d : d != null ? JSON.stringify(d) : t("commonSettings.regenerateFailed"));
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Panel title={t("tools.cc.title")}>
        <div className="py-4 text-center text-xs text-text-faint">{t("commonSettings.loadingEllipsis")}</div>
      </Panel>
    );
  }

  return (
    <Panel title={t("tools.cc.title")}>
      <div className={`mb-2 space-y-1 ${SETTINGS_INTRO_CLASS}`}>
        <p>
          <Trans t={t} i18nKey="tools.cc.intro1" components={{ code: <code className="rounded bg-surface-panel px-0.5" /> }} />
        </p>
        <p>
          <Trans t={t} i18nKey="tools.cc.intro2" components={{ code: <code className="rounded bg-surface-panel px-0.5" /> }} />
        </p>
      </div>
      <div className="space-y-2">
        <div>
          <span className={`mb-0.5 block ${SETTINGS_LABEL_CLASS}`}>{t("tools.cc.runMode")}</span>
          <div className="flex flex-wrap gap-3 text-xs text-text-subtle">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="cc-bridge-mode"
                checked={mode === "headless"}
                disabled={busy}
                onChange={() => setMode("headless")}
              />
              {t("tools.cc.headless")}
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="cc-bridge-mode"
                checked={mode === "visible_tui"}
                disabled={busy}
                onChange={() => setMode("visible_tui")}
              />
              {t("tools.cc.visibleTui")}
            </label>
          </div>
        </div>
        <div>
          <label className={`mb-0.5 block ${SETTINGS_LABEL_CLASS}`} htmlFor="cc-bridge-url">
            Bridge URL
          </label>
          <input
            id="cc-bridge-url"
            type="text"
            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-xs text-text-primary"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:9742"
          />
        </div>
        <div>
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <label className={SETTINGS_LABEL_CLASS} htmlFor="cc-bridge-token">
              Bearer token
            </label>
            <button
              type="button"
              className="text-[10px] text-text-subtle underline hover:text-text-primary"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? t("commonSettings.hide") : t("commonSettings.show")}
            </button>
          </div>
          <input
            id="cc-bridge-token"
            type={showToken ? "text" : "password"}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1 font-mono text-xs text-text-primary"
            value={token}
            disabled={busy}
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <div>
          <label className={`mb-0.5 block ${SETTINGS_LABEL_CLASS}`} htmlFor="cc-bridge-idle-seconds">
            {t("tools.cc.idleStop")}
          </label>
          <input
            id="cc-bridge-idle-seconds"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-xs text-text-primary"
            value={idleStopSeconds}
            disabled={busy}
            onChange={(e) => setIdleStopSeconds(e.target.value.replace(/\D/g, "").slice(0, 5))}
          />
        </div>
        <p className="text-[11px] text-text-faint">
          {t("tools.cc.saveHint")}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-amber-200 disabled:opacity-40"
            disabled={busy}
            onClick={() => void regen()}
          >
            {t("tools.cc.regenToken")}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => void load()}
          >
            {t("tools.cc.reload")}
          </button>
        </div>
        {msg ? <div className="text-xs text-text-subtle">{msg}</div> : null}
      </div>
    </Panel>
  );
});

type WbBridgePanelHandle = {
  save: () => Promise<{ ok: boolean; error?: string }>;
};

const WbBridgeSettingsPanel = forwardRef<WbBridgePanelHandle, Record<string, never>>(
  function WbBridgeSettingsPanel(_props, ref) {
    const { t } = useTranslation("settings");
    const apiToken = useAppStore((s) => s.apiToken);
    const backendUrl = useAppStore((s) => s.backendUrl);
    const [url, setUrl] = useState("http://127.0.0.1:9743");
    const [token, setToken] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState("");
    const [probeBusy, setProbeBusy] = useState(false);
    const [probe, setProbe] = useState<{
      ready?: boolean;
      reachable?: boolean;
      auth_ok?: boolean;
      detail?: string;
      autostart?: string;
    } | null>(null);

    const parseJsonOrError = useCallback(async (res: Response): Promise<any> => {
      const text = await res.text();
      try {
        return text ? JSON.parse(text) : {};
      } catch {
        const short = text.slice(0, 120).replace(/\s+/g, " ");
        throw new Error(
          t("commonSettings.nonJsonBackend", { status: res.status, snippet: short }),
        );
      }
    }, [t]);

    const load = useCallback(async () => {
      setLoading(true);
      setMsg("");
      try {
        const tokenHeader = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
        const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
        const headers: Record<string, string> = {};
        if (tokenHeader) headers["x-agx-desktop-token"] = tokenHeader;
        const res = await fetch(`${effectiveBase}/api/wb-bridge/config`, { headers });
        const data = (await parseJsonOrError(res)) as {
          ok?: boolean;
          url?: string;
          token?: string;
          error?: string;
        };
        if (data.ok) {
          setUrl((data.url || "http://127.0.0.1:9743").trim());
          setToken(data.token || "");
        } else {
          setMsg(data.error || t("commonSettings.loadFailed"));
        }
      } catch (e) {
        setMsg(String(e));
      } finally {
        setLoading(false);
      }
    }, [apiToken, backendUrl, parseJsonOrError]);

    const authHeaders = useCallback(async (): Promise<{
      headers: Record<string, string>;
      effectiveBase: string;
    }> => {
      const tokenHeader = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
      const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
      const headers: Record<string, string> = {};
      if (tokenHeader) headers["x-agx-desktop-token"] = tokenHeader;
      return { headers, effectiveBase };
    }, [apiToken, backendUrl]);

    const checkStatus = useCallback(async () => {
      setProbeBusy(true);
      try {
        const { headers, effectiveBase } = await authHeaders();
        const res = await fetch(`${effectiveBase}/api/wb-bridge/status`, { headers });
        const data = (await parseJsonOrError(res)) as {
          ready?: boolean;
          reachable?: boolean;
          auth_ok?: boolean;
          detail?: string;
        };
        setProbe(data);
      } catch (e) {
        setProbe({ ready: false, reachable: false, auth_ok: false, detail: String(e) });
      } finally {
        setProbeBusy(false);
      }
    }, [authHeaders, parseJsonOrError]);

    const ensureServe = useCallback(async () => {
      setProbeBusy(true);
      setMsg("");
      try {
        const { headers, effectiveBase } = await authHeaders();
        const res = await fetch(`${effectiveBase}/api/wb-bridge/ensure`, {
          method: "POST",
          headers,
        });
        const data = (await parseJsonOrError(res)) as {
          ready?: boolean;
          reachable?: boolean;
          auth_ok?: boolean;
          detail?: string;
          autostart?: string;
        };
        setProbe(data);
        if (data.ready) {
          setMsg(t("tools.wb.serveReady"));
        } else if (data.reachable && !data.auth_ok) {
          setMsg(t("tools.wb.tokenMismatchHint"));
        } else {
          setMsg(data.detail || data.autostart || t("tools.wb.startFailed"));
        }
      } catch (e) {
        setProbe({ ready: false, reachable: false, auth_ok: false, detail: String(e) });
        setMsg(String(e));
      } finally {
        setProbeBusy(false);
      }
    }, [authHeaders, parseJsonOrError]);

    useEffect(() => {
      void load();
    }, [load]);

    useEffect(() => {
      if (loading) return;
      void checkStatus();
    }, [loading, checkStatus]);

    useImperativeHandle(
      ref,
      () => ({
        async save() {
          if (loading) {
            return { ok: false, error: t("tools.wb.stillLoading") };
          }
          setBusy(true);
          setMsg("");
          try {
            const tokenHeader = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
            const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (tokenHeader) headers["x-agx-desktop-token"] = tokenHeader;
            const res = await fetch(`${effectiveBase}/api/wb-bridge/config`, {
              method: "PUT",
              headers,
              body: JSON.stringify({ url: url.trim(), token }),
            });
            const data = (await parseJsonOrError(res)) as {
              ok?: boolean;
              url?: string;
              token?: string;
              detail?: unknown;
            };
            if (data.ok) {
              setUrl((data.url || url).trim());
              setToken(data.token || token);
              setMsg(t("commonSettings.saved"));
              return { ok: true };
            }
            const d = data.detail;
            const errText = typeof d === "string" ? d : d != null ? JSON.stringify(d) : t("commonSettings.saveFailed");
            setMsg(errText);
            return { ok: false, error: errText };
          } catch (e) {
            const errText = String(e);
            setMsg(errText);
            return { ok: false, error: errText };
          } finally {
            setBusy(false);
          }
        },
      }),
      [apiToken, backendUrl, loading, parseJsonOrError, t, token, url],
    );

    const regen = async () => {
      setBusy(true);
      setMsg("");
      try {
        const tokenHeader = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
        const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
        const headers: Record<string, string> = {};
        if (tokenHeader) headers["x-agx-desktop-token"] = tokenHeader;
        const res = await fetch(`${effectiveBase}/api/wb-bridge/token/regenerate`, {
          method: "POST",
          headers,
        });
        const data = (await parseJsonOrError(res)) as { ok?: boolean; token?: string; detail?: unknown };
        if (data.ok && data.token) {
          setToken(data.token);
          setMsg(t("tools.wb.regenDone"));
        } else {
          const d = data.detail;
          setMsg(typeof d === "string" ? d : d != null ? JSON.stringify(d) : t("commonSettings.regenerateFailed"));
        }
      } catch (e) {
        setMsg(String(e));
      } finally {
        setBusy(false);
      }
    };

    const statusLabel = probeBusy
      ? t("tools.wb.probing")
      : probe?.ready
        ? t("tools.wb.ready")
        : probe?.reachable && !probe?.auth_ok
          ? t("tools.wb.tokenMismatch")
          : probe
            ? t("tools.wb.notListening")
            : t("tools.wb.unknown");
    const statusDot = probeBusy
      ? "bg-text-faint"
      : probe?.ready
        ? "bg-emerald-400"
        : "bg-rose-400";

    if (loading) {
      return (
        <Panel title={t("tools.wb.title")}>
          <div className="py-4 text-center text-xs text-text-faint">{t("commonSettings.loadingEllipsis")}</div>
        </Panel>
      );
    }

    return (
      <Panel
        title={t("tools.wb.title")}
        actions={
          <span className="flex items-center gap-1.5 text-[11px] text-text-subtle">
            <span className={`h-2 w-2 rounded-full ${statusDot}`} aria-hidden />
            {statusLabel}
          </span>
        }
      >
        <div className={`mb-2 space-y-1 ${SETTINGS_INTRO_CLASS}`}>
          <p>
            <Trans t={t} i18nKey="tools.wb.intro1" components={{ code: <code className="rounded bg-surface-panel px-0.5" /> }} />
          </p>
          <p>
            <Trans t={t} i18nKey="tools.wb.intro2" components={{ code: <code className="rounded bg-surface-panel px-0.5" /> }} />
          </p>
        </div>
        <div className="space-y-2">
          <div>
            <label className={`mb-0.5 block ${SETTINGS_LABEL_CLASS}`} htmlFor="wb-bridge-url">
              Bridge URL
            </label>
            <input
              id="wb-bridge-url"
              type="text"
              className="w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-xs text-text-primary"
              value={url}
              disabled={busy}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:9743"
            />
          </div>
          <div>
            <div className="mb-0.5 flex items-center justify-between gap-2">
              <label className={SETTINGS_LABEL_CLASS} htmlFor="wb-bridge-token">
                Bearer token
              </label>
              <button
                type="button"
                className="text-[11px] text-text-faint transition hover:text-text-subtle"
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? t("commonSettings.hide") : t("commonSettings.show")}
              </button>
            </div>
            <input
              id="wb-bridge-token"
              className="w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-xs text-text-primary"
              type={showToken ? "text" : "password"}
              value={token}
              disabled={busy}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
          </div>
          <p className="text-[11px] text-text-faint">
            {t("tools.wb.saveHint")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
              disabled={busy || probeBusy}
              onClick={() => void checkStatus()}
            >
              {probeBusy ? t("tools.wb.probing") : t("tools.wb.probe")}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-emerald-200 disabled:opacity-40"
              disabled={busy || probeBusy}
              onClick={() => void ensureServe()}
            >
              {t("tools.wb.startAndProbe")}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-amber-200 disabled:opacity-40"
              disabled={busy}
              onClick={() => void regen()}
            >
              {t("tools.cc.regenToken")}
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
              disabled={busy}
              onClick={() => void load()}
            >
              {t("tools.cc.reload")}
            </button>
          </div>
          {msg ? <div className="text-xs text-text-subtle">{msg}</div> : null}
        </div>
      </Panel>
    );
  },
);

const ToolsTab = forwardRef<ToolsTabHandle, Record<string, never>>(function ToolsTab(_props, ref) {
  const { t } = useTranslation("settings");
  const ccBridgePanelRef = useRef<CcBridgePanelHandle>(null);
  const wbBridgePanelRef = useRef<WbBridgePanelHandle>(null);
  const [registry, setRegistry] = useState<RegistryTool[]>([]);
  const [policy, setPolicy] = useState<Record<string, boolean>>({});
  const [toolsOptions, setToolsOptions] = useState<StudioToolsOptions>({});
  const [advOpenByTool, setAdvOpenByTool] = useState<Record<string, boolean>>({});
  /** 用字符串受控，避免 type=number + 每键 Number() 导致前导 0 与「0600」类显示问题 */
  const [bashTimeoutInput, setBashTimeoutInput] = useState("30");
  const [envTools, setEnvTools] = useState<ToolStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState<Record<string, ToolInstallState>>({});
  const [search, setSearch] = useState("");
  const [maxToolRounds, setMaxToolRounds] = useState(60);
  const [maxTaskspaces, setMaxTaskspaces] = useState(RUNTIME_DEFAULT_TASKSPACES);
  const [opsToolsEnabled, setOpsToolsEnabled] = useState(true);
  const [toolSearchMode, setToolSearchMode] = useState<"off" | "auto" | "always">("off");
  const [toolSearchThreshold, setToolSearchThreshold] = useState(6000);
  const [toolSearchStrategy, setToolSearchStrategy] = useState<"adaptive" | "manual">("adaptive");
  const [toolSearchRatioPercent, setToolSearchRatioPercent] = useState(5);
  const [toolSearchPersistError, setToolSearchPersistError] = useState("");
  const [stallNudge, setStallNudge] = useState<StallNudgeConfig>({
    stall_detect_silence_seconds: 90,
    stall_auto_nudge_enabled: false,
    stall_auto_nudge_after_seconds: 120,
    stall_auto_nudge_max_per_session: 2,
    llm_stall_patience_enabled: true,
    llm_stall_patience_max_attempts: 3,
    llm_stall_patience_budget_seconds: 900,
  });
  const [unattended, setUnattended] = useState<UnattendedConfig>({
    unattended_enabled: false,
    unattended_max_continuations_per_session: 20,
    unattended_max_wall_clock_hours: 6,
    unattended_stall_continue_after_seconds: 120,
    unattended_auto_resume_exhausted: true,
    unattended_auto_resume_interrupted: true,
  });
  const [tokenBudget, setTokenBudget] = useState<TokenBudgetConfig>(
    normalizeTokenBudgetConfig(undefined),
  );
  const [runtimeLoadError, setRuntimeLoadError] = useState("");
  const toolSearchThresholdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistToolSearchConfig = useCallback(
    async (
      mode: "off" | "auto" | "always",
      threshold: number,
      strategy: "adaptive" | "manual",
      ratioPercent: number,
    ) => {
      try {
        const rtRes = await window.agenticxDesktop.saveRuntimeConfig({
          tool_search_mode: mode,
          tool_search_auto_schema_token_threshold: threshold,
          tool_search_threshold_strategy: strategy,
          tool_search_context_budget_ratio: Math.max(0.01, Math.min(0.25, ratioPercent / 100)),
        });
        if (!rtRes?.ok) {
          setToolSearchPersistError(
            rtRes?.error ? String(rtRes.error) : t("tools.toolSearchSaveFailed"),
          );
          return false;
        }
        setToolSearchPersistError("");
        return true;
      } catch (err) {
        setToolSearchPersistError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [],
  );

  const handleToolSearchModeChange = useCallback(
    (mode: "off" | "auto" | "always") => {
      setToolSearchMode(mode);
      void persistToolSearchConfig(mode, toolSearchThreshold, toolSearchStrategy, toolSearchRatioPercent);
    },
    [persistToolSearchConfig, toolSearchThreshold, toolSearchStrategy, toolSearchRatioPercent],
  );

  const handleToolSearchStrategyChange = useCallback(
    (strategy: "adaptive" | "manual") => {
      setToolSearchStrategy(strategy);
      void persistToolSearchConfig(toolSearchMode, toolSearchThreshold, strategy, toolSearchRatioPercent);
    },
    [persistToolSearchConfig, toolSearchMode, toolSearchThreshold, toolSearchRatioPercent],
  );

  const handleToolSearchThresholdChange = useCallback(
    (threshold: number) => {
      setToolSearchThreshold(threshold);
      if (toolSearchThresholdTimerRef.current) {
        clearTimeout(toolSearchThresholdTimerRef.current);
      }
      toolSearchThresholdTimerRef.current = setTimeout(() => {
        void persistToolSearchConfig(
          toolSearchMode,
          threshold,
          toolSearchStrategy,
          toolSearchRatioPercent,
        );
      }, 350);
    },
    [persistToolSearchConfig, toolSearchMode, toolSearchStrategy, toolSearchRatioPercent],
  );

  const handleToolSearchRatioPercentChange = useCallback(
    (percent: number) => {
      setToolSearchRatioPercent(percent);
      if (toolSearchThresholdTimerRef.current) {
        clearTimeout(toolSearchThresholdTimerRef.current);
      }
      toolSearchThresholdTimerRef.current = setTimeout(() => {
        void persistToolSearchConfig(
          toolSearchMode,
          toolSearchThreshold,
          toolSearchStrategy,
          percent,
        );
      }, 350);
    },
    [persistToolSearchConfig, toolSearchMode, toolSearchThreshold, toolSearchStrategy],
  );

  useEffect(() => {
    return () => {
      if (toolSearchThresholdTimerRef.current) {
        clearTimeout(toolSearchThresholdTimerRef.current);
      }
    };
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    setRuntimeLoadError("");
    try {
      const [regResult, policyResult, statusResult, runtimeResult] = await Promise.all([
        window.agenticxDesktop.getToolsRegistry(),
        window.agenticxDesktop.getToolsPolicy(),
        window.agenticxDesktop.getToolsStatus(),
        window.agenticxDesktop.loadRuntimeConfig().catch(() => ({ ok: false as const })),
      ]);
      if (regResult?.ok) setRegistry(Array.isArray(regResult.tools) ? regResult.tools : []);
      else setError(regResult?.error ?? t("tools.registryLoadFailed"));
      if (policyResult?.ok) {
        setPolicy(policyResult.tools_enabled ?? {});
        const opts = policyResult.tools_options ?? {};
        setToolsOptions(opts);
        const d = opts.bash_exec?.default_timeout_sec;
        const n =
          typeof d === "number" && Number.isFinite(d)
            ? Math.max(BASH_DEFAULT_TIMEOUT_MIN, Math.min(BASH_DEFAULT_TIMEOUT_MAX, Math.round(d)))
            : 30;
        setBashTimeoutInput(String(n));
      }
      if (statusResult?.ok) setEnvTools(Array.isArray(statusResult.tools) ? statusResult.tools : []);
      if (runtimeResult?.ok) {
        const raw = Number(runtimeResult.max_tool_rounds);
        const n = Number.isFinite(raw) ? raw : 60;
        setMaxToolRounds(
          Math.max(RUNTIME_MIN_TOOL_ROUNDS, Math.min(RUNTIME_MAX_TOOL_ROUNDS, n)),
        );
        const taskspacesRaw = Number(runtimeResult.max_taskspaces);
        const taskspacesN = Number.isFinite(taskspacesRaw) ? taskspacesRaw : RUNTIME_DEFAULT_TASKSPACES;
        setMaxTaskspaces(
          Math.max(RUNTIME_MIN_TASKSPACES, Math.min(RUNTIME_MAX_TASKSPACES, taskspacesN)),
        );
        const tsMode = String(runtimeResult.tool_search_mode ?? "off").trim().toLowerCase();
        setToolSearchMode(
          tsMode === "auto" || tsMode === "always" || tsMode === "off" ? tsMode : "off",
        );
        const tsThreshold = Number(runtimeResult.tool_search_auto_schema_token_threshold ?? 6000);
        setToolSearchThreshold(
          Number.isFinite(tsThreshold)
            ? Math.max(1000, Math.min(50000, Math.round(tsThreshold)))
            : 6000,
        );
        const tsStrategy = String(runtimeResult.tool_search_threshold_strategy ?? "adaptive")
          .trim()
          .toLowerCase();
        setToolSearchStrategy(tsStrategy === "manual" ? "manual" : "adaptive");
        const tsRatio = Number(runtimeResult.tool_search_context_budget_ratio ?? 0.05);
        setToolSearchRatioPercent(
          Number.isFinite(tsRatio)
            ? Math.max(1, Math.min(25, Math.round(tsRatio * 1000) / 10))
            : 5,
        );
        const detectSec = Math.max(
          30,
          Math.min(300, Number(runtimeResult.stall_detect_silence_seconds ?? 90) || 90),
        );
        let afterSec = Math.max(
          60,
          Math.min(300, Number(runtimeResult.stall_auto_nudge_after_seconds ?? 120) || 120),
        );
        if (afterSec < detectSec) afterSec = detectSec;
        setStallNudge({
          stall_detect_silence_seconds: detectSec,
          stall_auto_nudge_enabled: Boolean(runtimeResult.stall_auto_nudge_enabled),
          stall_auto_nudge_after_seconds: afterSec,
          stall_auto_nudge_max_per_session: Math.max(
            1,
            Math.min(5, Number(runtimeResult.stall_auto_nudge_max_per_session ?? 2) || 2),
          ),
          llm_stall_patience_enabled: Boolean(runtimeResult.llm_stall_patience_enabled ?? true),
          llm_stall_patience_max_attempts: Math.max(
            1,
            Math.min(10, Number(runtimeResult.llm_stall_patience_max_attempts ?? 3) || 3),
          ),
          llm_stall_patience_budget_seconds: Math.max(
            60,
            Math.min(3600, Number(runtimeResult.llm_stall_patience_budget_seconds ?? 900) || 900),
          ),
        });
        setUnattended({
          unattended_enabled: Boolean(runtimeResult.unattended_enabled),
          unattended_max_continuations_per_session: Math.max(
            1,
            Math.min(
              100,
              Number(runtimeResult.unattended_max_continuations_per_session ?? 20) || 20,
            ),
          ),
          unattended_max_wall_clock_hours: Math.max(
            0.5,
            Math.min(48, Number(runtimeResult.unattended_max_wall_clock_hours ?? 6) || 6),
          ),
          unattended_stall_continue_after_seconds: Math.max(
            30,
            Math.min(
              600,
              Number(runtimeResult.unattended_stall_continue_after_seconds ?? 120) || 120,
            ),
          ),
          unattended_auto_resume_exhausted: Boolean(
            runtimeResult.unattended_auto_resume_exhausted ?? true,
          ),
          unattended_auto_resume_interrupted: Boolean(
            runtimeResult.unattended_auto_resume_interrupted ?? true,
          ),
        });
        setTokenBudget(
          normalizeTokenBudgetConfig({
            max_tokens_per_session: Number(runtimeResult.max_tokens_per_session),
            max_tokens_per_turn: Number(runtimeResult.max_tokens_per_turn),
          }),
        );
        setOpsToolsEnabled(runtimeResult.ops_tools_enabled !== false);
      } else {
        setRuntimeLoadError(t("tools.runtimeReadFailed"));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    const dispose = window.agenticxDesktop.onToolInstallProgress((event) => {
      setInstalling((prev) => {
        const targetToolId =
          event.tool_id ||
          Object.keys(prev).find((key) => prev[key].requestId === event.requestId) ||
          "";
        if (!targetToolId) return prev;
        const current = prev[targetToolId];
        if (!current || current.requestId !== event.requestId) return prev;
        const next: ToolInstallState = {
          ...current,
          percent: Number.isFinite(event.percent) ? event.percent : current.percent,
          phase: event.phase || current.phase,
          message: event.message || current.message,
          error: event.phase === "error" ? event.message || t("commonSettings.installFailed") : undefined,
        };
        return { ...prev, [targetToolId]: next };
      });
      if (event.phase === "done") void loadAll();
    });
    return dispose;
  }, [loadAll]);

  const toggleTool = useCallback(async (toolName: string, enabled: boolean) => {
    const next = { ...policy, [toolName]: enabled };
    setPolicy(next);
    await window.agenticxDesktop.saveToolsPolicy({ tools_enabled: next });
  }, [policy]);

  const saveBashDefaultTimeout = useCallback(async () => {
    const trimmed = bashTimeoutInput.trim();
    let sec = trimmed === "" ? BASH_DEFAULT_TIMEOUT_MIN : parseInt(trimmed, 10);
    if (!Number.isFinite(sec)) sec = BASH_DEFAULT_TIMEOUT_MIN;
    sec = Math.max(BASH_DEFAULT_TIMEOUT_MIN, Math.min(BASH_DEFAULT_TIMEOUT_MAX, sec));
    setBashTimeoutInput(String(sec));
    const nextOpts: StudioToolsOptions = {
      ...toolsOptions,
      bash_exec: { default_timeout_sec: sec },
    };
    setToolsOptions(nextOpts);
    const res = await window.agenticxDesktop.saveToolsPolicy({
      tools_enabled: policy,
      tools_options: nextOpts,
    });
    if (res?.ok && res.tools_options?.bash_exec?.default_timeout_sec != null) {
      const synced = res.tools_options.bash_exec.default_timeout_sec;
      setBashTimeoutInput(String(synced));
      setToolsOptions(res.tools_options);
    }
  }, [bashTimeoutInput, policy, toolsOptions]);

  useImperativeHandle(
    ref,
    () => ({
      async saveAll() {
        if (loading) {
          return { ok: false, error: t("tools.stillLoading") };
        }
        await saveBashDefaultTimeout();
        let afterSec = stallNudge.stall_auto_nudge_after_seconds;
        if (stallNudge.stall_auto_nudge_enabled && afterSec < stallNudge.stall_detect_silence_seconds) {
          afterSec = stallNudge.stall_detect_silence_seconds;
        }
        const rtRes = await window.agenticxDesktop.saveRuntimeConfig({
          max_tool_rounds: maxToolRounds,
          max_taskspaces: maxTaskspaces,
          tool_search_mode: toolSearchMode,
          tool_search_auto_schema_token_threshold: toolSearchThreshold,
          tool_search_threshold_strategy: toolSearchStrategy,
          tool_search_context_budget_ratio: Math.max(
            0.01,
            Math.min(0.25, toolSearchRatioPercent / 100),
          ),
          stall_detect_silence_seconds: stallNudge.stall_detect_silence_seconds,
          stall_auto_nudge_enabled: stallNudge.stall_auto_nudge_enabled,
          stall_auto_nudge_after_seconds: afterSec,
          stall_auto_nudge_max_per_session: stallNudge.stall_auto_nudge_max_per_session,
          llm_stall_patience_enabled: stallNudge.llm_stall_patience_enabled,
          llm_stall_patience_max_attempts: stallNudge.llm_stall_patience_max_attempts,
          llm_stall_patience_budget_seconds: stallNudge.llm_stall_patience_budget_seconds,
          unattended_enabled: unattended.unattended_enabled,
          unattended_max_continuations_per_session: unattended.unattended_max_continuations_per_session,
          unattended_max_wall_clock_hours: unattended.unattended_max_wall_clock_hours,
          unattended_stall_continue_after_seconds: unattended.unattended_stall_continue_after_seconds,
          unattended_auto_resume_exhausted: unattended.unattended_auto_resume_exhausted,
          unattended_auto_resume_interrupted: unattended.unattended_auto_resume_interrupted,
          max_tokens_per_session: tokenBudget.max_tokens_per_session,
          max_tokens_per_turn: tokenBudget.max_tokens_per_turn,
          ops_tools_enabled: opsToolsEnabled,
        });
        if (!rtRes?.ok) {
          return {
            ok: false,
            error: rtRes?.error ? String(rtRes.error) : t("tools.runtimeSaveFailed"),
          };
        }
        const bridge = ccBridgePanelRef.current;
        if (!bridge) {
          return { ok: false, error: t("tools.ccNotReady") };
        }
        const ccRes = await bridge.save();
        if (!ccRes.ok) return ccRes;
        const wbBridge = wbBridgePanelRef.current;
        if (!wbBridge) {
          return { ok: false, error: t("tools.wbNotReady") };
        }
        return wbBridge.save();
      },
    }),
    [
      loading,
      maxToolRounds,
      maxTaskspaces,
      opsToolsEnabled,
      toolSearchMode,
      toolSearchThreshold,
      toolSearchStrategy,
      toolSearchRatioPercent,
      saveBashDefaultTimeout,
      stallNudge,
      t,
      tokenBudget,
      unattended,
    ],
  );

  const startInstall = async (tool: ToolStatusItem) => {
    if (!tool.auto_installable) {
      const command = tool.install_command || t("tools.installDocs");
      setInstalling((prev) => ({
        ...prev,
        [tool.id]: { requestId: `manual-${tool.id}`, percent: 0, phase: "manual_required", message: command },
      }));
      return;
    }
    const requestId = `${tool.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setInstalling((prev) => ({
      ...prev,
      [tool.id]: { requestId, percent: 0, phase: "starting", message: t("tools.startInstall", { name: tool.name }) },
    }));
    const result = await window.agenticxDesktop.installTool({ requestId, toolId: tool.id });
    if (!result?.ok) {
      setInstalling((prev) => ({
        ...prev,
        [tool.id]: { requestId, percent: 0, phase: "error", message: result?.error || t("commonSettings.installFailed"), error: result?.error || t("commonSettings.installFailed") },
      }));
    }
  };

  const labelsByTool = useMemo(() => toolLabels(t), [t]);
  const labelsByCategory = useMemo(() => categoryLabels(t), [t]);

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? registry.filter((tool) => {
          const descZh = toolDisplayDescription(tool.name, tool.description, t).toLowerCase();
          return (
            tool.name.toLowerCase().includes(q) ||
            (labelsByTool[tool.name] ?? "").toLowerCase().includes(q) ||
            descZh.includes(q) ||
            tool.description.toLowerCase().includes(q) ||
            (labelsByCategory[tool.category] ?? "").toLowerCase().includes(q)
          );
        })
      : registry;
    const map = new Map<string, RegistryTool[]>();
    for (const tool of filtered) {
      const cat = tool.category || "other";
      const arr = map.get(cat);
      if (arr) arr.push(tool);
      else map.set(cat, [tool]);
    }
    return CATEGORY_ORDER
      .filter((cat) => map.has(cat))
      .map((cat) => ({ category: cat, label: labelsByCategory[cat] ?? cat, tools: map.get(cat)! }));
  }, [labelsByCategory, labelsByTool, registry, search, t]);

  if (loading) return <div className="py-8 text-center text-sm text-text-faint">{t("tools.loadingStatus")}</div>;

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-subtle">
        {t("tools.intro")}
      </div>
      <div className="text-xs text-text-faint">
        {t("tools.introHint")}
      </div>
      <RuntimeConfigSection
        maxToolRounds={maxToolRounds}
        onMaxToolRoundsChange={setMaxToolRounds}
        maxTaskspaces={maxTaskspaces}
        onMaxTaskspacesChange={setMaxTaskspaces}
        opsToolsEnabled={opsToolsEnabled}
        onOpsToolsEnabledChange={setOpsToolsEnabled}
        disabled={loading}
      />
      <ToolSearchConfigSection
        mode={toolSearchMode}
        onModeChange={handleToolSearchModeChange}
        threshold={toolSearchThreshold}
        onThresholdChange={handleToolSearchThresholdChange}
        thresholdStrategy={toolSearchStrategy}
        onThresholdStrategyChange={handleToolSearchStrategyChange}
        contextBudgetRatioPercent={toolSearchRatioPercent}
        onContextBudgetRatioPercentChange={handleToolSearchRatioPercentChange}
        disabled={loading}
      />
      <TokenBudgetConfigSection value={tokenBudget} onChange={setTokenBudget} disabled={loading} />
      <StallNudgeConfigSection value={stallNudge} onChange={setStallNudge} disabled={loading} />
      <UnattendedConfigSection value={unattended} onChange={setUnattended} disabled={loading} />
      {toolSearchPersistError ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          {toolSearchPersistError}
        </div>
      ) : null}
      {runtimeLoadError ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          {runtimeLoadError}
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">{error}</div>
      ) : null}

      {/* ── 内建 Agent 工具 ── */}
      <Panel title={t("tools.preauthorized", { count: registry.length })} collapsible defaultCollapsed>
        <div className="mb-2 flex items-center gap-2">
          <input
            type="text"
            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-xs text-text-primary placeholder:text-text-faint"
            placeholder={t("tools.searchPh")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-3">
          {grouped.map(({ category, label, tools: catTools }) => (
            <div key={category}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">{label}</div>
              <div className="space-y-1">
                {catTools.map((tool) => {
                  const enabled = policy[tool.name] !== false;
                  const autoAdded = !(tool.name in policy) || policy[tool.name] === true;
                  const showAdvanced = ADVANCED_TOOL_POLICY_NAMES.has(tool.name);
                  const advOpen = Boolean(advOpenByTool[tool.name]);
                  return (
                    <div
                      key={tool.name}
                      className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">{labelsByTool[tool.name] ?? tool.name}</span>
                          {autoAdded && enabled ? (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400">{t("tools.modeAuto")}</span>
                          ) : !enabled ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">{t("tools.needsApproval")}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-text-muted">{toolDisplayDescription(tool.name, tool.description, t)}</div>
                        {showAdvanced ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs text-text-subtle transition hover:text-text-primary"
                              onClick={() =>
                                setAdvOpenByTool((prev) => ({ ...prev, [tool.name]: !prev[tool.name] }))
                              }
                              aria-expanded={advOpen}
                            >
                              <ChevronRight
                                className={`h-3.5 w-3.5 shrink-0 transition-transform ${advOpen ? "rotate-90" : ""}`}
                                aria-hidden
                              />
                              {t("tools.advanced")}
                            </button>
                            {advOpen && tool.name === "bash_exec" ? (
                              <div className="mt-2 space-y-1.5 pl-1">
                                <label className="block text-[11px] font-medium text-text-muted" htmlFor={`bash-timeout-${tool.name}`}>
                                  {t("tools.defaultTimeout")}
                                </label>
                                <input
                                  id={`bash-timeout-${tool.name}`}
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  className="w-32 rounded-md border border-border bg-surface-panel px-2 py-1 text-xs text-text-primary"
                                  value={bashTimeoutInput}
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(/\D/g, "").slice(0, 4);
                                    setBashTimeoutInput(raw);
                                  }}
                                  onBlur={() => void saveBashDefaultTimeout()}
                                />
                                <p className="max-w-md text-[10px] leading-relaxed text-text-faint">
                                  {t("tools.timeoutHintBefore")}{" "}
                                  <code className="rounded bg-surface-panel px-0.5">timeout_sec</code>{" "}
                                  <Trans
                                    t={t}
                                    i18nKey="tools.timeoutHintAfter"
                                    values={{ min: BASH_DEFAULT_TIMEOUT_MIN, max: BASH_DEFAULT_TIMEOUT_MAX }}
                                    components={{ code: <code className="rounded bg-surface-panel px-0.5" /> }}
                                  />
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-0.5 shrink-0">
                        <SettingsSwitch
                          checked={enabled}
                          onChange={(next) => void toggleTool(tool.name, next)}
                          aria-label={t("tools.enableTool", { name: tool.name })}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && search ? (
            <div className="py-4 text-center text-xs text-text-faint">{t("tools.noMatch")}</div>
          ) : null}
        </div>
      </Panel>

      {/* ── 环境依赖（可安装的外部工具） ── */}
      <Panel title={t("tools.envDeps")}>
        <div className="mb-2 text-xs text-text-subtle">
          {t("tools.envHint")}
        </div>
        <div className="space-y-2">
          {envTools.map((tool) => {
            const installState = installing[tool.id];
            const isInstalling = Boolean(installState) && !["done", "error", "manual_required"].includes(installState.phase);
            const isManual = installState?.phase === "manual_required";
            const badge = tool.installed
              ? t("tools.installed")
              : isInstalling ? t("tools.installing") : isManual ? t("tools.manualInstall") : t("tools.notInstalled");
            const badgeClass = tool.installed
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : isInstalling
                ? "border-[var(--settings-accent-border-muted)] bg-[var(--settings-accent-subtle-bg)] text-[var(--settings-accent-fg-muted)]"
                : isManual ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-border bg-surface-panel text-text-faint";
            return (
              <div key={tool.id} className="rounded-md border border-border bg-surface-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">{tool.name}</span>
                      <span className={`shrink-0 rounded-full border px-1.5 text-[10px] ${badgeClass}`}>{badge}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">{tool.description}</div>
                    {tool.installed && tool.version ? (
                      <div className="mt-0.5 text-[11px] text-text-faint">{t("tools.version", { version: tool.version })}</div>
                    ) : null}
                  </div>
                  {!tool.installed ? (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                      onClick={() => void startInstall(tool)}
                      disabled={isInstalling}
                    >
                      {tool.auto_installable ? t("tools.install") : t("tools.installGuide")}
                    </button>
                  ) : null}
                </div>
                {installState ? (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center gap-2 text-xs text-text-subtle">
                      {isInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      <span>{installState.message}</span>
                      {!tool.installed ? <span>{Math.max(0, Math.min(100, installState.percent))}%</span> : null}
                    </div>
                    {!tool.installed ? (
                      <div className="h-1.5 w-full overflow-hidden rounded bg-surface-panel">
                        <div
                          className={`h-full ${
                            installState.phase === "error" ? "bg-rose-400" : installState.phase === "done" ? "bg-emerald-400" : "bg-[var(--settings-accent-progress)]"
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, installState.percent))}%` }}
                        />
                      </div>
                    ) : null}
                    {installState.error ? (
                      <div className="mt-1 text-xs text-rose-300">{installState.error}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Panel>

      <CcBridgeSettingsPanel ref={ccBridgePanelRef} />
      <WbBridgeSettingsPanel ref={wbBridgePanelRef} />
    </div>
  );
});

function pinSkillFirst(skills: SkillItem[], pin: string | null): SkillItem[] {
  if (!pin || skills.length === 0) return skills;
  const i = skills.findIndex((s) => s.name === pin);
  if (i <= 0) return skills;
  const next = [...skills];
  const [one] = next.splice(i, 1);
  return [one, ...next];
}

function normalizeSkillScanCustomPaths(
  raw: Array<string | SkillScanCustomRow> | undefined | null,
): SkillScanCustomRow[] {
  if (!Array.isArray(raw)) return [];
  const out: SkillScanCustomRow[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string") {
      const path = item.trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, enabled: true });
      continue;
    }
    if (item && typeof item === "object") {
      const path = String(item.path ?? "").trim();
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push({ path, enabled: item.enabled !== false });
    }
  }
  return out;
}

function SkillsTab() {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<{ name: string; content: string } | null>(null);
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  const [expandedSkillName, setExpandedSkillName] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [marketQuery, setMarketQuery] = useState("");
  const [marketResults, setMarketResults] = useState<RegistrySearchItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketMsg, setMarketMsg] = useState("");
  const [registryInstallBusy, setRegistryInstallBusy] = useState(false);
  const [marketPending, setMarketPending] = useState<RegistrySearchItem | null>(null);
  const [marketNeedsConfirmNonHigh, setMarketNeedsConfirmNonHigh] = useState(false);
  const [marketNeedsConfirmHigh, setMarketNeedsConfirmHigh] = useState(false);
  const [marketInstallingKey, setMarketInstallingKey] = useState<string | null>(null);
  const [marketQueuedKeys, setMarketQueuedKeys] = useState<string[]>([]);
  /** After marketplace install: pin this skill at top of its group and surface global section first. */
  const [recentMarketSkillName, setRecentMarketSkillName] = useState<string | null>(null);
  const [skillScanPresets, setSkillScanPresets] = useState<SkillScanPresetRow[]>([]);
  const [skillScanCustomPaths, setSkillScanCustomPaths] = useState<SkillScanCustomRow[]>([]);
  /** Local draft custom path: null = no draft; string (incl. "") = unconfirmed row, never persisted until 确认. */
  const [skillScanDraftPath, setSkillScanDraftPath] = useState<string | null>(null);
  const [preferredSkillSources, setPreferredSkillSources] = useState<Record<string, string>>({});
  /** Skill names globally disabled in ~/.agenticx/config.yaml (skills.disabled). */
  const [disabledSkillNames, setDisabledSkillNames] = useState<string[]>([]);
  const [skillScanBusy, setSkillScanBusy] = useState(false);
  const [skillScanMsg, setSkillScanMsg] = useState("");
  const marketSearchSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const marketInstallQueueRef = useRef<RegistrySearchItem[]>([]);
  const skillsListAnchorRef = useRef<HTMLDivElement | null>(null);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);

  const addPane = useAppStore((s) => s.addPane);
  const setForwardAutoReply = useAppStore((s) => s.setForwardAutoReply);
  const closeSettings = useAppStore((s) => s.closeSettings);

  const [installPromptBusy, setInstallPromptBusy] = useState(false);
  const [skillhubQuery, setSkillhubQuery] = useState("");
  const [skillhubResults, setSkillhubResults] = useState<SkillHubRow[]>([]);
  const [skillhubResultsExpanded, setSkillhubResultsExpanded] = useState(true);
  const [skillhubLoading, setSkillhubLoading] = useState(false);
  const [skillhubMsg, setSkillhubMsg] = useState("");
  const [skillhubHint, setSkillhubHint] = useState("");
  const [recommendedIconData, setRecommendedIconData] = useState<Record<string, string>>(() =>
    Object.fromEntries(RECOMMENDED_SKILLS.map((skill) => [skill.id, skill.icon_src]))
  );
  const [recommendedIconBroken, setRecommendedIconBroken] = useState<Record<string, boolean>>({});
  const [recommendedTierFilter, setRecommendedTierFilter] = useState<
    "all" | RecommendedSkillTier
  >("all");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const skill of RECOMMENDED_SKILLS) {
        const iconSrc = String(skill.icon_src ?? "").trim();
        if (!iconSrc) {
          next[skill.id] = "";
          continue;
        }
        if (!isLikelyLocalImagePath(iconSrc)) {
          next[skill.id] = iconSrc;
          continue;
        }
        try {
          const res = await window.agenticxDesktop.loadLocalImageDataUrl(iconSrc);
          if (res?.ok && res.dataUrl) {
            next[skill.id] = res.dataUrl;
          } else {
            next[skill.id] = iconSrc;
          }
        } catch {
          next[skill.id] = iconSrc;
        }
      }
      if (!cancelled) {
        setRecommendedIconData(next);
        setRecommendedIconBroken({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    void (async () => {
      try {
        const [skillsRes, scanRes] = await Promise.all([
          window.agenticxDesktop.loadSkills(),
          window.agenticxDesktop.getSkillSettings(),
        ]);
        if (!cancelled) {
          if (skillsRes.ok) setItems(skillsRes.items ?? []);
          else setErr(skillsRes.error ?? t("skills.loadFailed"));
          if (scanRes.ok && Array.isArray(scanRes.preset_paths)) {
            setSkillScanPresets(
              scanRes.preset_paths.map((p) => ({
                id: String(p.id ?? ""),
                label: String(p.label ?? ""),
                path: String(p.path ?? ""),
                enabled: Boolean(p.enabled),
              })),
            );
          }
          if (scanRes.ok && Array.isArray(scanRes.custom_paths)) {
            setSkillScanCustomPaths(normalizeSkillScanCustomPaths(scanRes.custom_paths));
          }
          if (scanRes.ok && scanRes.preferred_sources && typeof scanRes.preferred_sources === "object") {
            setPreferredSkillSources({ ...scanRes.preferred_sources });
          }
          if (scanRes.ok && Array.isArray(scanRes.disabled_skills)) {
            setDisabledSkillNames([...scanRes.disabled_skills]);
          }
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const off = window.agenticxDesktop.onSkillsChanged(() => {
      void (async () => {
        const skillsRes = await window.agenticxDesktop.loadSkills();
        if (skillsRes.ok) {
          setItems(skillsRes.items ?? []);
          setErr("");
        }
      })();
    });
    return () => off();
  }, []);

  useEffect(() => {
    if (!recentMarketSkillName) return;
    skillsListAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [recentMarketSkillName]);

  const persistSkillScanSettings = useCallback(
    async (
      presetRows: SkillScanPresetRow[],
      customs: SkillScanCustomRow[],
      preferredSources: Record<string, string>,
      disabledSkills: string[],
    ) => {
      setSkillScanBusy(true);
      setSkillScanMsg("");
      try {
        const cleanedCustom = normalizeSkillScanCustomPaths(customs);
        const r = await window.agenticxDesktop.putSkillSettings({
          presetPaths: presetRows.map((p) => ({ id: p.id, enabled: p.enabled })),
          customPaths: cleanedCustom,
          preferredSources,
          disabledSkills,
        });
        if (r.ok) {
          if (Array.isArray(r.preset_paths)) {
            setSkillScanPresets(
              r.preset_paths.map((p) => ({
                id: String(p.id ?? ""),
                label: String(p.label ?? ""),
                path: String(p.path ?? ""),
                enabled: Boolean(p.enabled),
              })),
            );
          }
          if (Array.isArray(r.custom_paths)) {
            setSkillScanCustomPaths(normalizeSkillScanCustomPaths(r.custom_paths));
          }
          if (r.preferred_sources && typeof r.preferred_sources === "object") {
            setPreferredSkillSources({ ...r.preferred_sources });
          }
          if (Array.isArray(r.disabled_skills)) {
            setDisabledSkillNames([...r.disabled_skills]);
          }
          setSkillScanMsg(t("skills.scanSaved"));
          await window.agenticxDesktop.refreshSkills();
          const skillsRes = await window.agenticxDesktop.loadSkills();
          if (skillsRes.ok) setItems(skillsRes.items ?? []);
        } else {
          setSkillScanMsg(r.error ?? t("commonSettings.saveFailed"));
        }
      } catch (e) {
        setSkillScanMsg(String(e));
      } finally {
        setSkillScanBusy(false);
      }
    },
    [t],
  );

  const onRefresh = async () => {
    setLoading(true);
    setErr("");
    setDetail(null);
    setExpandedSkillName(null);
    setRecentMarketSkillName(null);
    try {
      await window.agenticxDesktop.refreshSkills();
      const [skillsRes, scanRes] = await Promise.all([
        window.agenticxDesktop.loadSkills(),
        window.agenticxDesktop.getSkillSettings(),
      ]);
      if (skillsRes.ok) setItems(skillsRes.items ?? []);
      else setErr(skillsRes.error ?? t("skills.refreshFailed"));
      if (scanRes.ok && Array.isArray(scanRes.preset_paths)) {
        setSkillScanPresets(
          scanRes.preset_paths.map((p) => ({
            id: String(p.id ?? ""),
            label: String(p.label ?? ""),
            path: String(p.path ?? ""),
            enabled: Boolean(p.enabled),
          })),
        );
      }
      if (scanRes.ok && Array.isArray(scanRes.custom_paths)) {
        setSkillScanCustomPaths(normalizeSkillScanCustomPaths(scanRes.custom_paths));
        setSkillScanDraftPath(null);
      }
      if (scanRes.ok && scanRes.preferred_sources && typeof scanRes.preferred_sources === "object") {
        setPreferredSkillSources({ ...scanRes.preferred_sources });
      }
      if (scanRes.ok && Array.isArray(scanRes.disabled_skills)) {
        setDisabledSkillNames([...scanRes.disabled_skills]);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const choosePreferredSource = async (skillName: string, source: string) => {
    const next = { ...preferredSkillSources, [skillName]: source };
    setPreferredSkillSources(next);
    await persistSkillScanSettings(skillScanPresets, skillScanCustomPaths, next, disabledSkillNames);
  };

  const toggleGlobalSkill = useCallback(
    async (name: string, enabled: boolean) => {
      const nextDisabled = enabled
        ? disabledSkillNames.filter((n) => n !== name)
        : [...new Set([...disabledSkillNames, name])].sort();
      setDisabledSkillNames(nextDisabled);
      await persistSkillScanSettings(
        skillScanPresets,
        skillScanCustomPaths,
        preferredSkillSources,
        nextDisabled,
      );
    },
    [
      disabledSkillNames,
      persistSkillScanSettings,
      skillScanPresets,
      skillScanCustomPaths,
      preferredSkillSources,
    ],
  );

  const onAddCustomSkillPath = useCallback(() => {
    if (skillScanBusy) return;
    if (skillScanDraftPath !== null) {
      setSkillScanMsg(t("skills.confirmDraftFirst"));
      return;
    }
    setSkillScanDraftPath("");
    setSkillScanMsg("");
  }, [skillScanBusy, skillScanDraftPath]);

  const pickSkillDirectory = useCallback(async (): Promise<string | null> => {
    const picker = window.agenticxDesktop.chooseDirectory;
    if (typeof picker !== "function") {
      setSkillScanMsg(t("skills.noFolderPicker"));
      return null;
    }
    try {
      const picked = await picker();
      if (picked.canceled) return null;
      if (!picked.ok || !picked.path?.trim()) {
        setSkillScanMsg(picked.error ? t("skills.pickDirFailed", { reason: picked.error }) : t("commonSettings.noDirectorySelected"));
        return null;
      }
      return picked.path.trim();
    } catch (e) {
      setSkillScanMsg(String(e));
      return null;
    }
  }, []);

  const onBrowseSkillDraftPath = useCallback(async () => {
    if (skillScanBusy || skillScanDraftPath === null) return;
    const path = await pickSkillDirectory();
    if (path == null) return;
    setSkillScanDraftPath(path);
    setSkillScanMsg("");
  }, [skillScanBusy, skillScanDraftPath, pickSkillDirectory]);

  const onBrowseCommittedSkillPath = useCallback(
    async (index: number) => {
      if (skillScanBusy) return;
      const path = await pickSkillDirectory();
      if (path == null) return;
      if (skillScanCustomPaths.some((p, i) => i !== index && p.path.trim() === path)) {
        setSkillScanMsg(t("skills.pathAlreadyListed"));
        return;
      }
      const next = skillScanCustomPaths.map((row, i) =>
        i === index ? { ...row, path } : row,
      );
      setSkillScanCustomPaths(next);
      await persistSkillScanSettings(skillScanPresets, next, preferredSkillSources, disabledSkillNames);
    },
    [
      skillScanBusy,
      skillScanCustomPaths,
      skillScanPresets,
      preferredSkillSources,
      disabledSkillNames,
      persistSkillScanSettings,
      pickSkillDirectory,
    ],
  );

  const onConfirmSkillDraftPath = useCallback(async () => {
    if (skillScanBusy || skillScanDraftPath === null) return;
    const path = skillScanDraftPath.trim();
    if (!path) {
      setSkillScanMsg(t("commonSettings.pathEmpty"));
      return;
    }
    if (skillScanCustomPaths.some((p) => p.path.trim() === path)) {
      setSkillScanMsg(t("skills.pathAlreadyListed"));
      return;
    }
    const next = [...skillScanCustomPaths, { path, enabled: true }];
    setSkillScanDraftPath(null);
    setSkillScanCustomPaths(next);
    await persistSkillScanSettings(skillScanPresets, next, preferredSkillSources, disabledSkillNames);
  }, [
    skillScanBusy,
    skillScanDraftPath,
    skillScanCustomPaths,
    skillScanPresets,
    preferredSkillSources,
    disabledSkillNames,
    persistSkillScanSettings,
  ]);

  const onCancelSkillDraftPath = useCallback(() => {
    setSkillScanDraftPath(null);
    setSkillScanMsg("");
  }, []);

  const reloadSkillsAfterMarketInstall = async (installedSlug: string) => {
    try {
      await window.agenticxDesktop.refreshSkills();
    } catch {
      /* still try load */
    }
    const skillsRes = await window.agenticxDesktop.loadSkills();
    if (!skillsRes.ok) return;
    const list = skillsRes.items ?? [];
    setItems(list);
    const needle = `/registry/${installedSlug}`;
    const byRegistryPath = list.find((s) =>
      (s.base_dir ?? "").replace(/\\/g, "/").includes(needle)
    );
    const pinName = byRegistryPath?.name ?? list.find((s) => s.name === installedSlug)?.name ?? installedSlug;
    setRecentMarketSkillName(pinName);
  };

  const runInstallPromptInMetaAgent = useCallback(
    async (prompt: string) => {
      const text = prompt.trim();
      if (!text) return;
      setSkillhubMsg("");
      setInstallPromptBusy(true);
      try {
        const created = await window.agenticxDesktop.createSession({});
        if (!created.ok || !created.session_id) {
          const err = created.error ?? t("skills.createMetaFailed");
          setSkillhubMsg(err);
          return;
        }
        const sid = created.session_id;
        const paneId = addPane(null, "Near", sid);
        // Skill-market install is a real user-initiated turn. Do not inherit
        // forwardAutoReply's merge-forward defaults (suppressUserEcho /
        // skipUserHistory = true), or the pane looks like it started with no
        // instruction while bash_exec already runs.
        setForwardAutoReply({
          paneId,
          sessionId: sid,
          text,
          suppressUserEcho: false,
          skipUserHistory: false,
        });
        closeSettings();
      } catch (e) {
        const msg = String(e);
        setSkillhubMsg(msg);
      } finally {
        setInstallPromptBusy(false);
      }
    },
    [addPane, setForwardAutoReply, closeSettings],
  );

  const onSkillHubMarketInstall = (slug: string) => {
    const prompt = buildSkillHubAgentInstallPrompt(slug);
    if (!prompt.trim()) return;
    void runInstallPromptInMetaAgent(prompt);
  };

  const onRecommendedSkillInstall = (skillId: string) => {
    const prompt =
      skillId === "officecli"
        ? buildOfficeCliInstallPrompt()
        : skillId === "archscribe"
          ? buildArchscribeInstallPrompt()
          : "";
    if (!prompt.trim()) return;
    void runInstallPromptInMetaAgent(prompt);
  };

  const filteredRecommendedSkills =
    recommendedTierFilter === "all"
      ? RECOMMENDED_SKILLS
      : RECOMMENDED_SKILLS.filter((s) => s.tier === recommendedTierFilter);

  const onSkillHubSearch = async () => {
    setSkillhubLoading(true);
    setSkillhubMsg("");
    setSkillhubHint("");
    try {
      const res = await window.agenticxDesktop.searchSkillHub({ q: skillhubQuery });
      if (!res.ok) {
        setSkillhubResults([]);
        setSkillhubMsg(res.error || t("skills.searchFailed"));
        return;
      }
      const raw = Array.isArray(res.items) ? res.items : [];
      const rows: SkillHubRow[] = [];
      for (const row of raw) {
        const r = row as SkillHubRow;
        const slug = String(r.slug || r.name || "").trim();
        if (!slug) continue;
        rows.push({
          slug,
          name: String(r.name || slug).trim() || slug,
          description: String(r.description || "").trim(),
          version: String(r.version || "latest"),
          author: String(r.author || "unknown"),
          downloads: r.downloads,
        });
      }
      setSkillhubResults(rows);
      setSkillhubResultsExpanded(true);
      setSkillhubHint(typeof res.hint === "string" ? res.hint : "");
    } catch (e) {
      setSkillhubResults([]);
      setSkillhubMsg(String(e));
    } finally {
      setSkillhubLoading(false);
    }
  };

  const onMarketSearch = async () => {
    const seq = ++marketSearchSeqRef.current;
    const q = marketQuery.trim();
    setMarketLoading(true);
    setMarketMsg("");
    try {
      const res = await window.agenticxDesktop.searchRegistry({ q });
      if (seq !== marketSearchSeqRef.current) return;
      if (res.ok) {
        setMarketResults(res.items ?? []);
        if ((res.items ?? []).length === 0) {
          setMarketMsg(res.hint?.trim() || t("skills.noneFound"));
        } else {
          setMarketMsg("");
        }
      } else {
        setMarketMsg(res.error ?? t("skills.searchFailed"));
        setMarketResults([]);
      }
    } catch (e) {
      if (seq !== marketSearchSeqRef.current) return;
      setMarketMsg(String(e));
    } finally {
      if (seq === marketSearchSeqRef.current) {
        setMarketLoading(false);
      }
    }
  };

  const onMarketInstall = async (item: RegistrySearchItem) => {
    const key = `${item.source}:${item.name}`;
    if (registryInstallBusy && marketInstallingKey && marketInstallingKey !== key) {
      const exists = marketInstallQueueRef.current.some(
        (q) => q.source === item.source && q.name === item.name
      );
      if (!exists) {
        marketInstallQueueRef.current.push(item);
        setMarketQueuedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      }
      setMarketMsg(t("skills.installQueued", { current: marketInstallingKey.split(":")[1], queued: item.name }));
      return;
    }
    setMarketQueuedKeys((prev) => prev.filter((k) => k !== key));
    marketInstallQueueRef.current = marketInstallQueueRef.current.filter(
      (q) => !(q.source === item.source && q.name === item.name)
    );
    setMarketInstallingKey(key);
    setRegistryInstallBusy(true);
    setMarketNeedsConfirmNonHigh(false);
    setMarketNeedsConfirmHigh(false);
    setMarketPending(null);
    setMarketMsg(t("skills.pulling", { name: item.name }));
    let pauseQueue = false;
    try {
      const prev = await window.agenticxDesktop.installFromRegistryPreview({
        source: item.source,
        name: item.name,
      });
      if (!prev.ok) {
        const rawErr = String(prev.error ?? t("commonSettings.unknownError"));
        const is429 = rawErr.includes("rate limited (429)") || rawErr.includes("Too Many Requests");
        if (is429) {
          const secMatch = rawErr.match(/about (\d+)s/);
          const waitSec = secMatch ? Math.min(Number(secMatch[1]), 30) : 10;
          setMarketMsg(t("skills.rateLimited", { seconds: waitSec }));
          await new Promise((r) => setTimeout(r, waitSec * 1000));
          setMarketMsg(t("skills.repulling", { name: item.name }));
          const retry = await window.agenticxDesktop.installFromRegistryPreview({
            source: item.source,
            name: item.name,
          });
          if (!retry.ok) {
            const retryErr = String(retry.error ?? t("commonSettings.unknownError"));
            setMarketMsg(t("skills.pullFailed", { reason: retryErr }));
            return;
          }
          Object.assign(prev, retry);
        } else if (rawErr.includes("fetch failed") || rawErr.includes("Failed to fetch skill")) {
          setMarketMsg(t("skills.pullFailed", { reason: rawErr }));
          return;
        } else {
          setMarketMsg(t("skills.scanFailed", { reason: rawErr }));
          return;
        }
      }
      if (prev.scan) {
        setMarketMsg(formatSkillScanSummary(prev.scan, t));
      }

      const res = await window.agenticxDesktop.installFromRegistry({
        source: item.source,
        name: item.name,
      });
      if (res.ok) {
        setMarketMsg(
          formatInstallDoneMsg(t("skills.installedNamed", { name: item.name }), res.scan_summary ?? prev.scan, t),
        );
        await reloadSkillsAfterMarketInstall(String(res.name ?? item.name));
        return;
      }
      if (res.error_code === "non_high_risk_confirm_required") {
        setMarketPending(item);
        setMarketNeedsConfirmNonHigh(true);
        pauseQueue = true;
        if (res.scan_summary) {
          setMarketMsg(t("skills.confirmThenWriteWithScan", { summary: formatSkillScanSummary(res.scan_summary, t) }));
        } else {
          setMarketMsg(t("skills.confirmThenWrite"));
        }
        return;
      }
      if (res.error_code === "high_risk_confirm_required") {
        setMarketPending(item);
        setMarketNeedsConfirmHigh(true);
        pauseQueue = true;
        if (res.scan_summary) {
          setMarketMsg(t("skills.highRiskConfirmWithScan", { summary: formatSkillScanSummary(res.scan_summary, t) }));
        } else {
          setMarketMsg(t("skills.highRiskConfirm"));
        }
        return;
      }
      setMarketMsg(t("skills.installFailedReason", { reason: res.error ?? t("commonSettings.unknownError") }));
    } catch (e) {
      setMarketMsg(String(e));
    } finally {
      setRegistryInstallBusy(false);
      setMarketInstallingKey(null);
      if (!pauseQueue && marketInstallQueueRef.current.length > 0) {
        const next = marketInstallQueueRef.current.shift()!;
        const nextKey = `${next.source}:${next.name}`;
        setMarketQueuedKeys((prev) => prev.filter((k) => k !== nextKey));
        setTimeout(() => {
          void onMarketInstall(next);
        }, 0);
      }
    }
  };

  const onConfirmMarketInstall = async (kind: "non_high" | "high") => {
    if (!marketPending) return;
    const pending = marketPending;
    setMarketInstallingKey(`${pending.source}:${pending.name}`);
    setRegistryInstallBusy(true);
    try {
      const res = await window.agenticxDesktop.installFromRegistry({
        source: pending.source,
        name: pending.name,
        confirmNonHighRisk: kind === "non_high",
        acknowledgeHighRisk: kind === "high",
      });
      setMarketNeedsConfirmNonHigh(false);
      setMarketNeedsConfirmHigh(false);
      setMarketPending(null);
      if (res.ok) {
        setMarketMsg(
          formatInstallDoneMsg(t("skills.installedNamed", { name: pending.name }), res.scan_summary, t),
        );
        await reloadSkillsAfterMarketInstall(String(res.name ?? pending.name));
      } else {
        setMarketMsg(t("skills.installFailedReason", { reason: res.error ?? t("commonSettings.unknownError") }));
      }
    } catch (e) {
      setMarketMsg(String(e));
    } finally {
      setRegistryInstallBusy(false);
      setMarketInstallingKey(null);
    }
  };

  const onExpandDetail = async (name: string) => {
    setActiveSkillName(name);
    setExpandedSkillName(name);
    if (detail?.name === name && detail.content) return;
    const requestSeq = detailRequestSeqRef.current + 1;
    detailRequestSeqRef.current = requestSeq;
    setLoadingDetail(true);
    try {
      const res = await window.agenticxDesktop.loadSkillDetail({ name });
      if (detailRequestSeqRef.current !== requestSeq) return;
      if (res.ok) setDetail({ name, content: res.content });
      else setErr(res.error ?? t("skills.loadDetailFailed"));
    } catch (e) {
      if (detailRequestSeqRef.current !== requestSeq) return;
      setErr(String(e));
    } finally {
      if (detailRequestSeqRef.current === requestSeq) {
        setLoadingDetail(false);
      }
    }
  };

  const projectSkills = pinSkillFirst(
    items.filter((s) => effectiveSkillLocation(s) === "project"),
    recentMarketSkillName
  );
  const globalSkillPool = items.filter((s) => effectiveSkillLocation(s) !== "project");
  const globalSkills = pinSkillFirst(
    filterAndRankSkills(globalSkillPool, search),
    recentMarketSkillName,
  );
  const hasGlobalSkills = globalSkillPool.length > 0;
  const showGlobalSkillsFirst =
    Boolean(recentMarketSkillName) &&
    globalSkills.some((s) => s.name === recentMarketSkillName);

  if (loading) {
    return <div className="py-8 text-center text-sm text-text-faint">{t("skills.loadingList")}</div>;
  }

  return (
    <div ref={skillsListAnchorRef} className="space-y-3">

      {pendingProposalCount > 0 ? (
        <Panel title={t("skills.pendingTitle", { count: pendingProposalCount })}>
          <PendingProposalsList onCountChange={setPendingProposalCount} />
        </Panel>
      ) : (
        <PendingProposalsList onCountChange={setPendingProposalCount} hideWhenEmpty />
      )}

      {/* Skill scan roots (presets + custom paths) */}
      <Panel title={t("skills.scanPaths")} collapsible titleClassName={SKILLS_SECTION_PANEL_TITLE_CLASS}>
        <p className="mb-3 text-xs leading-relaxed text-text-subtle">
          <Trans
            t={t}
            i18nKey="skills.scanIntro"
            components={{
              a: <code className="text-text-muted" />,
              b: <code className="text-text-muted" />,
              c: <code className="text-text-muted" />,
            }}
          />
        </p>
        
        <div className="overflow-hidden rounded-lg border border-border bg-surface-base">
          <div className="divide-y divide-border">
            {skillScanPresets.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-3 py-2.5">
                <div className="min-w-0 flex-1 pr-3">
                  <div className="text-xs font-semibold text-text-strong">{p.label}</div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">{p.path}</div>
                </div>
                <div className="shrink-0">
                  <SettingsSwitch
                    checked={p.enabled}
                    disabled={skillScanBusy}
                    aria-label={t("skills.togglePreset", { label: p.label })}
                    onChange={(next) => {
                      const updated = skillScanPresets.map((row) =>
                        row.id === p.id ? { ...row, enabled: next } : row,
                      );
                      setSkillScanPresets(updated);
                      void persistSkillScanSettings(updated, skillScanCustomPaths, preferredSkillSources, disabledSkillNames);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="divide-y divide-border border-t border-border">
            {skillScanCustomPaths.map((row, i) => (
              <div key={`skill-custom-${i}`} className="flex items-center gap-2 px-3 py-2 bg-surface-base">
                <div className="flex-1 min-w-0">
                  <input
                    className="w-full rounded bg-surface-panel px-2 py-1.5 font-mono text-xs text-text-primary outline-none placeholder:text-text-faint focus:ring-1 focus:ring-border"
                    placeholder={t("skills.customPathPh")}
                    value={row.path}
                    disabled={skillScanBusy}
                    onChange={(e) => {
                      const next = skillScanCustomPaths.map((r, j) =>
                        j === i ? { ...r, path: e.target.value } : r,
                      );
                      setSkillScanCustomPaths(next);
                    }}
                    onBlur={(e) => {
                      const next = skillScanCustomPaths.map((r, j) =>
                        j === i ? { ...r, path: e.target.value } : r,
                      );
                      void persistSkillScanSettings(
                        skillScanPresets,
                        next,
                        preferredSkillSources,
                        disabledSkillNames,
                      );
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                  disabled={skillScanBusy}
                  title={t("skills.browseDir")}
                  onClick={() => void onBrowseCommittedSkillPath(i)}
                >
                  <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                  disabled={skillScanBusy}
                  title={tCommon("remove")}
                  onClick={() => {
                    const next = skillScanCustomPaths.filter((_, j) => j !== i);
                    setSkillScanCustomPaths(next);
                    void persistSkillScanSettings(
                      skillScanPresets,
                      next,
                      preferredSkillSources,
                      disabledSkillNames,
                    );
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <div className="shrink-0 pl-1">
                  <SettingsSwitch
                    checked={row.enabled}
                    disabled={skillScanBusy}
                    aria-label={t("skills.toggleCustom", { label: row.path || i + 1 })}
                    onChange={(nextEnabled) => {
                      const next = skillScanCustomPaths.map((r, j) =>
                        j === i ? { ...r, enabled: nextEnabled } : r,
                      );
                      setSkillScanCustomPaths(next);
                      void persistSkillScanSettings(
                        skillScanPresets,
                        next,
                        preferredSkillSources,
                        disabledSkillNames,
                      );
                    }}
                  />
                </div>
              </div>
            ))}

            {skillScanDraftPath !== null ? (
              <div className="bg-surface-base px-3 py-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <input
                      className="w-full rounded bg-surface-panel px-2 py-1.5 font-mono text-xs text-text-primary outline-none placeholder:text-text-faint focus:ring-1 focus:ring-border"
                      placeholder={t("skills.draftPathPh")}
                      value={skillScanDraftPath}
                      disabled={skillScanBusy}
                      autoFocus
                      onChange={(e) => setSkillScanDraftPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void onConfirmSkillDraftPath();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          onCancelSkillDraftPath();
                        }
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1.5 text-text-faint transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                    disabled={skillScanBusy}
                    title={t("skills.browseDir")}
                    onClick={() => void onBrowseSkillDraftPath()}
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border bg-[var(--ui-btn-primary-bg)] px-2 py-1 text-xs font-medium text-[var(--ui-btn-primary-fg)] transition hover:opacity-90 disabled:opacity-40"
                    disabled={skillScanBusy}
                    onClick={() => void onConfirmSkillDraftPath()}
                  >
                    {tCommon("confirm")}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                    disabled={skillScanBusy}
                    onClick={onCancelSkillDraftPath}
                  >
                    {tCommon("cancel")}
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-text-faint">{t("skills.draftHint")}</p>
              </div>
            ) : null}

            <div className="bg-surface-base px-3 py-2">
              <button
                type="button"
                className="flex w-full items-center justify-center rounded-md border border-dashed border-border px-3 py-2.5 text-sm text-text-subtle transition hover:border-border-strong hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                disabled={skillScanBusy}
                onClick={onAddCustomSkillPath}
              >
                {t("skills.addCustomPath")}
              </button>
            </div>
          </div>
        </div>
        
        {skillScanMsg ? (
          <div
            className={`mt-2 text-xs ${settingsMsgLooksFail(skillScanMsg) ? "text-amber-400" : "text-emerald-400"}`}
          >
            {skillScanMsg}
          </div>
        ) : null}
      </Panel>

      {err && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          {err}
        </div>
      )}

      {items.length === 0 && !err && (
        <div className="py-6 text-center text-sm text-text-faint">
          {t("skills.emptyTitle")}<br />
          <span className="text-xs text-text-subtle">
            {t("skills.emptyHint")}
          </span>
        </div>
      )}

      {/* Skills list grouped by location; after market install, global block first + pinned row */}
      <div className="space-y-3">
        {showGlobalSkillsFirst ? (
          <>
            <SkillsLocationSection
              skills={globalSkills}
              title={t("skills.globalSkills")}
              locationLabel="全局"
              search={search}
              onSearchChange={setSearch}
              onRefresh={() => void onRefresh()}
              listLoading={loading}
              showWhenEmpty={hasGlobalSkills}
              activeSkillName={activeSkillName}
              expandedSkillName={expandedSkillName}
              detail={detail}
              loadingDetail={loadingDetail}
              recentMarketSkillName={recentMarketSkillName}
              preferredSources={preferredSkillSources}
              onChoosePreferredSource={choosePreferredSource}
              onActivate={setActiveSkillName}
              onExpandDetail={onExpandDetail}
              onCollapseDetail={() => setExpandedSkillName(null)}
              disabledSkillNames={disabledSkillNames}
              skillScanBusy={skillScanBusy}
              onToggleGlobalSkill={toggleGlobalSkill}
            />
            <SkillsLocationSection
              skills={projectSkills}
              title={t("skills.projectSkills")}
              locationLabel="项目"
              activeSkillName={activeSkillName}
              expandedSkillName={expandedSkillName}
              detail={detail}
              loadingDetail={loadingDetail}
              recentMarketSkillName={recentMarketSkillName}
              preferredSources={preferredSkillSources}
              onChoosePreferredSource={choosePreferredSource}
              onActivate={setActiveSkillName}
              onExpandDetail={onExpandDetail}
              onCollapseDetail={() => setExpandedSkillName(null)}
              disabledSkillNames={disabledSkillNames}
              skillScanBusy={skillScanBusy}
              onToggleGlobalSkill={toggleGlobalSkill}
            />
          </>
        ) : (
          <>
            <SkillsLocationSection
              skills={projectSkills}
              title={t("skills.projectSkills")}
              locationLabel="项目"
              activeSkillName={activeSkillName}
              expandedSkillName={expandedSkillName}
              detail={detail}
              loadingDetail={loadingDetail}
              recentMarketSkillName={recentMarketSkillName}
              preferredSources={preferredSkillSources}
              onChoosePreferredSource={choosePreferredSource}
              onActivate={setActiveSkillName}
              onExpandDetail={onExpandDetail}
              onCollapseDetail={() => setExpandedSkillName(null)}
              disabledSkillNames={disabledSkillNames}
              skillScanBusy={skillScanBusy}
              onToggleGlobalSkill={toggleGlobalSkill}
            />
            <SkillsLocationSection
              skills={globalSkills}
              title={t("skills.globalSkills")}
              locationLabel="全局"
              search={search}
              onSearchChange={setSearch}
              onRefresh={() => void onRefresh()}
              listLoading={loading}
              showWhenEmpty={hasGlobalSkills}
              activeSkillName={activeSkillName}
              expandedSkillName={expandedSkillName}
              detail={detail}
              loadingDetail={loadingDetail}
              recentMarketSkillName={recentMarketSkillName}
              preferredSources={preferredSkillSources}
              onChoosePreferredSource={choosePreferredSource}
              onActivate={setActiveSkillName}
              onExpandDetail={onExpandDetail}
              onCollapseDetail={() => setExpandedSkillName(null)}
              disabledSkillNames={disabledSkillNames}
              skillScanBusy={skillScanBusy}
              onToggleGlobalSkill={toggleGlobalSkill}
            />
          </>
        )}
      </div>

      {/* === Skills Marketplace Section (Collapsible) === */}
      <Panel
        title={t("skills.market")}
        collapsible
        defaultCollapsed={false}
        className="mt-4"
        titleClassName={SKILLS_SECTION_PANEL_TITLE_CLASS}
      >
        <div className="space-y-4 pt-1 pb-1">
          {/* === Recommended official shortcuts (suite-style cards, 图2) === */}
            <section className="pt-0.5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div className="text-[11px] font-semibold tracking-wide text-text-strong">
                  {t("skills.official")}
                </div>
                <div
                  className="inline-flex rounded-full bg-surface-panel p-0.5"
                  role="tablist"
                  aria-label={t("skills.tierFilterAria")}
                >
                  {(
                    [
                      { id: "all" as const, label: t("skills.tierAll") },
                      { id: "enterprise" as const, label: t("skills.tierEnterprise") },
                      { id: "third_party" as const, label: t("skills.tierThirdParty") },
                    ] as const
                  ).map((tab) => {
                    const active = recommendedTierFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={
                          active
                            ? "rounded-full bg-surface-card px-2.5 py-1 text-[11px] font-medium text-text-strong shadow-sm"
                            : "rounded-full px-2.5 py-1 text-[11px] text-text-faint transition-colors hover:text-text-primary"
                        }
                        onClick={() => setRecommendedTierFilter(tab.id)}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {filteredRecommendedSkills.length === 0 ? (
                <p className="py-8 text-center text-xs text-text-faint">
                  {t("skills.noTierResults")}
                </p>
              ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredRecommendedSkills.map((skill) => {
                  const canInstall = skill.cta === "install";
                  const primaryAction = () => {
                    if (canInstall) onRecommendedSkillInstall(skill.id);
                    else window.open(skill.official_url, "_blank", "noopener,noreferrer");
                  };
                  return (
                  <div
                    key={skill.id}
                    className="flex min-h-[132px] flex-col rounded-2xl border border-black/[0.08] bg-surface-panel px-3.5 py-3.5 transition-colors hover:bg-surface-hover/50 dark:border-white/[0.1]"
                  >
                    <div className="flex items-center gap-2.5">
                      {recommendedIconBroken[skill.id] || !(recommendedIconData[skill.id] || skill.icon_src) ? (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-panel text-[13px] font-semibold text-text-subtle">
                          {(skill.name || skill.id).slice(0, 1).toUpperCase()}
                        </div>
                      ) : (
                        <img
                          src={recommendedIconData[skill.id] || skill.icon_src}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-full bg-white object-cover ring-1 ring-black/[0.04]"
                          loading="lazy"
                          onError={() =>
                            setRecommendedIconBroken((prev) =>
                              prev[skill.id] ? prev : { ...prev, [skill.id]: true }
                            )
                          }
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold tracking-tight text-text-strong">
                          {skill.name}
                        </div>
                        <div
                          className={
                            skill.tier === "enterprise"
                              ? "mt-0.5 text-[10px] font-medium text-[#07C160]"
                              : "mt-0.5 text-[10px] text-text-faint"
                          }
                        >
                          {skill.tier === "enterprise" ? t("skills.tierEnterprise") : t("skills.tierThirdParty")}
                          <span className="mx-1 text-border">·</span>
                          <span className="font-normal text-text-faint">{t(`skills.recommended.${skill.id}.category`)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        title={canInstall ? t("tools.install") : t("skills.openSite")}
                        aria-label={canInstall ? t("skills.installNamed", { name: skill.name }) : t("skills.openSiteNamed", { name: skill.name })}
                        disabled={canInstall && installPromptBusy}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-black/[0.06] text-text-strong transition-colors hover:bg-black/[0.1] active:scale-[0.97] disabled:opacity-40 dark:bg-white/10 dark:hover:bg-white/15"
                        onClick={primaryAction}
                      >
                        <span className="text-[17px] font-medium leading-none" aria-hidden>
                          +
                        </span>
                      </button>
                    </div>
                    <HoverTip
                      label={t(`skills.recommended.${skill.id}.description`)}
                      delayMs={280}
                      className="mt-2.5 min-h-0 w-full flex-1 flex-col"
                    >
                      <ClampToFitText
                        text={t(`skills.recommended.${skill.id}.description`)}
                        className="min-h-0 w-full min-w-0 flex-1 break-words text-[12px] leading-4 text-text-muted"
                      />
                    </HoverTip>
                    {!canInstall ? (
                      <button
                        type="button"
                        className="mt-2 self-start text-[11px] text-text-faint transition hover:text-text-primary"
                        onClick={() => window.open(skill.official_url, "_blank", "noopener,noreferrer")}
                      >
                        {t("skills.officialSite")}
                      </button>
                    ) : null}
                  </div>
                  );
                })}
              </div>
              )}
            </section>

            {/* === ClawHub marketplace (registry aggregate) === */}
            <section className="rounded-lg bg-surface-panel p-3 border border-border">
              <div className="mb-3 text-[11px] font-semibold text-text-strong">
                {t("skills.clawhubMarket")}
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
                  placeholder={t("skills.searchNamePh")}
                  value={marketQuery}
                  onChange={(e) => setMarketQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void onMarketSearch(); }}
                />
                <button
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                  onClick={() => void onMarketSearch()}
                  disabled={marketLoading}
                >
                  {marketLoading ? t("skills.searching") : t("skills.search")}
                </button>
              </div>
              {marketMsg && (
                <div
                  className={`mt-1.5 whitespace-pre-wrap text-xs ${
                    settingsMsgLooksFail(marketMsg) || settingsMsgLooksNotFound(marketMsg)
                      ? "text-amber-400"
                      : marketNeedsConfirmNonHigh || marketNeedsConfirmHigh || settingsMsgLooksHighRisk(marketMsg)
                        ? "text-amber-300"
                        : "text-emerald-400"
                  }`}
                >
                  {marketMsg}
                </div>
              )}
              {(marketNeedsConfirmNonHigh || marketNeedsConfirmHigh) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {marketNeedsConfirmNonHigh && (
                    <button
                      type="button"
                      className="rounded-md border border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)] px-3 py-1.5 text-xs text-[var(--settings-accent-fg-muted)] transition hover:bg-[var(--settings-accent-subtle-bg-hover)] disabled:opacity-40"
                      disabled={registryInstallBusy}
                      onClick={() => void onConfirmMarketInstall("non_high")}
                    >
                      {registryInstallBusy ? t("skills.installing") : t("skills.confirmInstall")}
                    </button>
                  )}
                  {marketNeedsConfirmHigh && (
                    <button
                      type="button"
                      className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
                      disabled={registryInstallBusy}
                      onClick={() => void onConfirmMarketInstall("high")}
                    >
                      {registryInstallBusy ? t("skills.installing") : t("skills.confirmHighRisk")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                    disabled={registryInstallBusy}
                    onClick={() => {
                      setMarketNeedsConfirmNonHigh(false);
                      setMarketNeedsConfirmHigh(false);
                      setMarketPending(null);
                      setMarketMsg("");
                    }}
                  >
                    {tCommon("cancel")}
                  </button>
                </div>
              )}
              {marketResults.length > 0 && (
                <div className="mt-2 space-y-1">
                  {marketResults.map((item) => (
                    <div
                      key={`${item.source}:${item.name}`}
                      className="flex items-start gap-2 rounded-md border border-transparent bg-surface-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-text-primary">{item.name}</span>
                          <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                            {item.source}
                          </span>
                          {item.source_type === "clawhub" && (
                            <span className="shrink-0 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 text-[10px] text-violet-400">
                              ClawHub
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{item.description}</p>
                        )}
                        <p className="mt-0.5 text-[10px] text-text-faint">by {item.author} · v{item.version}</p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded border border-[var(--settings-accent-border-muted)] px-2 py-0.5 text-[10px] text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-subtle-bg)] disabled:opacity-40"
                        disabled={marketLoading || marketInstallingKey === `${item.source}:${item.name}` || marketQueuedKeys.includes(`${item.source}:${item.name}`)}
                        onClick={() => void onMarketInstall(item)}
                      >
                        {marketInstallingKey === `${item.source}:${item.name}`
                          ? t("skills.installing")
                          : marketQueuedKeys.includes(`${item.source}:${item.name}`)
                            ? t("skills.queued")
                            : t("tools.install")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* === SkillHub (Tencent) marketplace === */}
            <section className="rounded-lg bg-surface-panel p-3 border border-border">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-text-strong">
                  {t("skills.skillhubMarket")}
                </div>
                <button
                  type="button"
                  className="text-[11px] text-text-faint underline decoration-border underline-offset-2 transition hover:text-[var(--settings-accent-fg)]"
                  onClick={() => window.open("https://skillhub.tencent.com/", "_blank", "noopener,noreferrer")}
                >
                  skillhub.tencent.com ↗
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
                  placeholder={t("skills.skillhubSearchPh")}
                  value={skillhubQuery}
                  onChange={(e) => setSkillhubQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onSkillHubSearch();
                  }}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                  onClick={() => void onSkillHubSearch()}
                  disabled={skillhubLoading}
                >
                  {skillhubLoading ? t("skills.searching") : t("skills.search")}
                </button>
              </div>
              {skillhubMsg && (
                <div
                  className={`mt-1.5 whitespace-pre-wrap text-xs ${
                    settingsMsgLooksFail(skillhubMsg) ? "text-amber-400" : "text-rose-400"
                  }`}
                >
                  {skillhubMsg}
                </div>
              )}
              {skillhubHint && (
                <div className="mt-1.5 text-xs text-text-faint">{skillhubHint}</div>
              )}
              {skillhubResults.length > 0 && (
                <div className="mt-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left transition hover:text-text-primary"
                      onClick={() => setSkillhubResultsExpanded((v) => !v)}
                      aria-expanded={skillhubResultsExpanded}
                    >
                      <span className={`min-w-0 truncate ${SKILLS_GROUP_TITLE_CLASS}`}>
                        {t("skills.searchResults", { count: skillhubResults.length })}
                      </span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${skillhubResultsExpanded ? "" : "-rotate-90"}`}
                      />
                    </button>
                    <button
                      type="button"
                      className="shrink-0 text-[11px] text-text-faint transition hover:text-text-primary"
                      onClick={() => {
                        setSkillhubResults([]);
                        setSkillhubHint("");
                        setSkillhubMsg("");
                        setSkillhubResultsExpanded(true);
                      }}
                    >
                      {t("skills.clear")}
                    </button>
                  </div>
                  {skillhubResultsExpanded ? (
                    <div className="space-y-1">
                  {skillhubResults.map((item) => (
                    <div
                      key={item.slug}
                      className="flex items-start gap-2 rounded-md border border-transparent bg-surface-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-text-primary">{item.name}</span>
                          <span className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 text-[10px] text-sky-400">
                            SkillHub
                          </span>
                        </div>
                        {item.description ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{item.description}</p>
                        ) : null}
                        <p className="mt-0.5 text-[10px] text-text-faint">
                          by {item.author} · v{item.version}
                          {item.downloads != null && item.downloads !== "" ? t("skills.downloads", { count: String(item.downloads) }) : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          className="rounded border border-[var(--settings-accent-border-muted)] px-2 py-0.5 text-[10px] text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-subtle-bg)] disabled:opacity-40"
                          disabled={installPromptBusy}
                          onClick={() => onSkillHubMarketInstall(item.slug)}
                        >
                          {t("tools.install")}
                        </button>
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-0.5 text-[10px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                          onClick={() =>
                            window.open(
                              `https://skillhub.tencent.com/skills/${encodeURIComponent(item.slug)}`,
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                        >
                          {t("skills.detailLink")}
                        </button>
                      </div>
                    </div>
                  ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-3 py-2 text-center text-xs text-text-faint">
                      {t("skills.collapsedResults", { count: skillhubResults.length })}
                    </div>
                  )}
                </div>
              )}
            </section>
        </div>
      </Panel>
    </div>
  );
}

function EmailSettingsTab() {
  const { t } = useTranslation("settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [preset, setPreset] = useState<EmailPresetId>("custom");
  const [form, setForm] = useState<EmailSettingsForm>({ ...DEFAULT_EMAIL_SETTINGS });

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadEmailConfig();
        const config = normalizeEmailSettings(result?.config);
        if (!disposed) {
          setForm(config);
          setPreset(inferPresetFromConfig(config));
        }
      } catch (err) {
        if (!disposed) setMessage(t("email.loadFailed"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const updateField = <K extends keyof EmailSettingsForm>(field: K, value: EmailSettingsForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onPresetChange = (next: EmailPresetId) => {
    setPreset(next);
    if (next === "custom") return;
    const target = EMAIL_PRESETS.find((item) => item.id === next);
    if (!target) return;
    setForm((prev) => ({
      ...prev,
      smtp_host: target.smtp_host,
      smtp_port: target.smtp_port,
      smtp_use_tls: target.smtp_use_tls,
    }));
  };

  const onTestSend = async () => {
    setTesting(true);
    setMessage("");
    try {
      const res = await window.agenticxDesktop.testEmailConfig({
        config: form,
        toEmail: form.default_to_email,
      });
      setMessage(res?.ok ? t("email.testOk") : t("email.testFailedReason", { reason: res?.error ?? t("commonSettings.unknownError") }));
    } catch (err) {
      setMessage(t("email.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await window.agenticxDesktop.saveEmailConfig(form);
      setMessage(res?.ok ? t("email.saved") : t("commonSettings.saveFailedWithReason", { reason: res?.error ?? t("commonSettings.unknownError") }));
    } catch (err) {
      setMessage(t("email.saveFailedRetry"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-text-faint">{t("email.loading")}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface-card p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-text-primary">{t("email.smtpTitle")}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">{t("email.enableNotify")}</span>
            <SettingsSwitch
              checked={form.enabled}
              onChange={(next) => updateField("enabled", next)}
              aria-label={t("email.enableNotify")}
            />
          </div>
        </div>

        <div className="space-y-3">
          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
            {t("email.preset")}
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={preset}
              onChange={(e) => onPresetChange(e.target.value as EmailPresetId)}
            >
              {EMAIL_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(`email.presets.${item.id}`)}
                </option>
              ))}
            </select>
          </label>

          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
            SMTP Host
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.smtp_host}
              onChange={(e) => updateField("smtp_host", e.target.value)}
              placeholder="smtp.qq.com"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className={`block ${SETTINGS_LABEL_CLASS}`}>
              SMTP Port
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={String(form.smtp_port)}
                onChange={(e) => updateField("smtp_port", Number(e.target.value) || 0)}
              />
            </label>
            <label className={`block ${SETTINGS_LABEL_CLASS}`}>
              TLS
              <select
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={form.smtp_use_tls ? "true" : "false"}
                onChange={(e) => updateField("smtp_use_tls", e.target.value === "true")}
              >
                <option value="true">{t("commonSettings.enable")}</option>
                <option value="false">{t("commonSettings.disable")}</option>
              </select>
            </label>
          </div>

          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
            {t("email.username")}
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.smtp_username}
              onChange={(e) => updateField("smtp_username", e.target.value)}
              placeholder="your_email@qq.com"
            />
          </label>

          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
            {t("email.password")}
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.smtp_password}
              onChange={(e) => updateField("smtp_password", e.target.value)}
              placeholder={t("email.passwordPh")}
            />
          </label>

          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
            {t("email.from")}
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.from_email}
              onChange={(e) => updateField("from_email", e.target.value)}
              placeholder="your_email@qq.com"
            />
          </label>

          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
            {t("email.to")}
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.default_to_email}
              onChange={(e) => updateField("default_to_email", e.target.value)}
              placeholder="bingzhenli@hotmail.com"
            />
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover disabled:opacity-40"
          onClick={onTestSend}
          disabled={testing || saving}
        >
          {testing ? t("commonSettings.testing") : t("email.testSend")}
        </button>
        <button
          className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
          onClick={onSave}
          disabled={testing || saving}
        >
          {saving ? t("commonSettings.savingDots") : t("email.save")}
        </button>
      </div>
      {message ? <div className="mt-2 text-xs text-text-subtle">{message}</div> : null}
    </div>
  );
}

type FavoriteRow = {
  message_id?: string;
  session_id?: string;
  content?: string;
  saved_at?: string;
  role?: string;
  tags?: string[];
};

function FavoritesTab({
  apiBase,
  apiToken,
  sessionId,
  panes,
  avatars,
  groups,
  onForwardFavorite,
}: {
  apiBase: string;
  apiToken: string;
  sessionId: string;
  panes: ChatPane[];
  avatars: Avatar[];
  groups: GroupChat[];
  onForwardFavorite: (
    ctx: FavoriteForwardContext,
    payload: ForwardConfirmPayload,
    note: string
  ) => Promise<void>;
}) {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const [items, setItems] = useState<FavoriteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardCtx, setForwardCtx] = useState<FavoriteForwardContext | null>(null);
  const [editing, setEditing] = useState<{
    messageId: string;
    tags: string[];
    input: string;
  } | null>(null);
  const [tagSaving, setTagSaving] = useState(false);

  const base = apiBase.replace(/\/$/, "");

  const reload = useCallback(async () => {
    if (!base) return;
    const r = await fetch(`${base}/api/memory/favorites`, {
      headers: { "x-agx-desktop-token": apiToken },
    });
    const data = (await r.json().catch(() => null)) as { items?: FavoriteRow[]; detail?: string } | null;
    if (!r.ok) {
      throw new Error(data?.detail ? String(data.detail) : `HTTP ${r.status}`);
    }
    setItems(Array.isArray(data?.items) ? data.items : []);
  }, [apiToken, base]);

  useEffect(() => {
    if (!apiBase.trim()) {
      setErr(t("favorites.needStudio"));
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr("");
    void (async () => {
      try {
        await reload();
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, apiToken, reload]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const patchTags = useCallback(
    async (messageId: string, tags: string[]) => {
      if (!base || !messageId.trim()) return;
      setTagSaving(true);
      try {
        const r = await fetch(`${base}/api/memory/favorites/${encodeURIComponent(messageId)}/tags`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "x-agx-desktop-token": apiToken,
          },
          body: JSON.stringify({ tags }),
        });
        const data = (await r.json().catch(() => null)) as { ok?: boolean; detail?: string } | null;
        if (!r.ok || !data?.ok) {
          throw new Error(data?.detail ? String(data.detail) : `HTTP ${r.status}`);
        }
        setItems((prev) =>
          prev.map((row) =>
            String(row.message_id ?? "").trim() === messageId ? { ...row, tags: [...tags] } : row
          )
        );
        setEditing(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setTagSaving(false);
      }
    },
    [apiToken, base]
  );

  const finishEditingTags = useCallback(() => {
    if (!editing || tagSaving) return;
    void patchTags(editing.messageId, editing.tags);
  }, [editing, patchTags, tagSaving]);

  if (!apiBase.trim()) {
    return <div className="py-8 text-center text-sm text-text-faint">{t("favorites.needStudio")}</div>;
  }
  if (loading) {
    return <div className="py-8 text-center text-sm text-text-faint">{t("commonSettings.loadingEllipsis")}</div>;
  }
  if (err && items.length === 0 && !loading) {
    return <div className="py-8 text-center text-sm text-rose-400">{err}</div>;
  }
  if (items.length === 0) {
    return <div className="py-8 text-center text-sm text-text-faint">{t("favorites.empty")}</div>;
  }

  return (
    <div className="space-y-2">
      {err ? <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">{err}</div> : null}
      <p className="mb-3 text-xs text-text-subtle">
        {t("favorites.intro")}
      </p>
      <ForwardPicker
        open={forwardOpen}
        currentSessionId={forwardCtx?.sourceSessionId ?? sessionId}
        currentAvatarId={null}
        avatars={avatars}
        groups={groups}
        onClose={() => {
          setForwardOpen(false);
          setForwardCtx(null);
        }}
        onConfirm={async (payload, note) => {
          if (!forwardCtx) return;
          await onForwardFavorite(forwardCtx, payload, note);
        }}
      />
      {items.map((row, idx) => {
        const content = String(row.content ?? "").trim() || t("favorites.noText");
        const savedAt = String(row.saved_at ?? "");
        const sid = String(row.session_id ?? "").trim();
        const mid = String(row.message_id ?? "").trim();
        let timeLabel = savedAt;
        try {
          if (savedAt) timeLabel = new Date(savedAt).toLocaleString();
        } catch {
          // keep raw
        }
        const tags = Array.isArray(row.tags)
          ? row.tags.map((tag) => String(tag).trim()).filter(Boolean)
          : [];
        const isEditing = editing?.messageId === mid;

        return (
          <div
            key={`${mid || idx}-${savedAt}`}
            className="flex gap-3 rounded-lg border border-border bg-surface-card px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-text-primary">{content}</p>
              {!isEditing && tags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border bg-surface-panel px-2 py-0.5 text-[11px] text-text-muted"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {isEditing ? (
                <div
                  className="mt-2 space-y-2 rounded-md border border-border bg-surface-panel p-2"
                  onBlur={(ev) => {
                    if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) {
                      finishEditingTags();
                    }
                  }}
                >
                  <div className="flex flex-wrap gap-1">
                    {editing.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[11px] text-text-muted"
                      >
                        {tag}
                        <button
                          type="button"
                          className="text-text-faint hover:text-rose-400"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            setEditing((prev) =>
                              prev && prev.messageId === mid
                                ? { ...prev, tags: prev.tags.filter((x) => x !== tag) }
                                : prev
                            )
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={editing.input}
                      onChange={(e) =>
                        setEditing((prev) => (prev && prev.messageId === mid ? { ...prev, input: e.target.value } : prev))
                      }
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const next = editing.input.trim();
                        if (!next) return;
                        setEditing((prev) => {
                          if (!prev || prev.messageId !== mid) return prev;
                          if (prev.tags.includes(next)) return { ...prev, input: "" };
                          return { ...prev, tags: [...prev.tags, next], input: "" };
                        });
                      }}
                      placeholder={t("favorites.tagPh")}
                      className="min-w-[8rem] flex-1 rounded border border-border bg-surface-card px-2 py-1 text-xs text-text-primary outline-none focus:border-[var(--settings-accent-focus)]"
                    />
                    <button
                      type="button"
                      disabled={tagSaving}
                      className="rounded border border-border px-2 py-1 text-xs text-text-subtle hover:bg-surface-hover disabled:opacity-40"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void patchTags(mid, editing.tags)}
                    >
                      {tagSaving ? t("commonSettings.saving") : tCommon("save")}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                <button
                  type="button"
                  className="rounded border border-border px-2 py-0.5 text-text-subtle transition hover:bg-surface-hover"
                  onClick={async () => {
                    if (!mid) return;
                    try {
                      await navigator.clipboard.writeText(content);
                      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
                      setCopiedId(mid);
                      copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1000);
                    } catch {
                      setErr(t("favorites.copyFailed"));
                    }
                  }}
                >
                  {copiedId === mid ? t("favorites.copied") : tCommon("copy")}
                </button>
                <button
                  type="button"
                  disabled={!sid}
                  className="rounded border border-border px-2 py-0.5 text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
                  onClick={() => {
                    if (!sid) return;
                    setForwardCtx({
                      sourceSessionId: sid,
                      content,
                      role: row.role,
                    });
                    setForwardOpen(true);
                  }}
                >
                  {t("favorites.forward")}
                </button>
                <button
                  type="button"
                  disabled={!mid}
                  className="rounded border border-border px-2 py-0.5 text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
                  onClick={() =>
                    setEditing({
                      messageId: mid,
                      tags: [...tags],
                      input: "",
                    })
                  }
                >
                  {t("favorites.editTags")}
                </button>
                <button
                  type="button"
                  disabled={!mid}
                  className="rounded border border-rose-500/40 px-2 py-0.5 text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-40"
                  onClick={() => {
                    if (!mid || !base) return;
                    const prev = items;
                    setItems((list) => list.filter((r) => String(r.message_id ?? "").trim() !== mid));
                    setErr("");
                    void (async () => {
                      try {
                        const r = await fetch(`${base}/api/memory/favorites/${encodeURIComponent(mid)}`, {
                          method: "DELETE",
                          headers: { "x-agx-desktop-token": apiToken },
                        });
                        const data = (await r.json().catch(() => null)) as { ok?: boolean; detail?: string } | null;
                        if (!r.ok || !data?.ok) {
                          throw new Error(data?.detail ? String(data.detail) : `HTTP ${r.status}`);
                        }
                      } catch (e) {
                        setItems(prev);
                        setErr(e instanceof Error ? e.message : String(e));
                      }
                    })();
                  }}
                >
                  {tCommon("delete")}
                </button>
                {sid ? <span className="text-text-faint">{t("favorites.session", { id: sid.slice(0, 8) })}</span> : null}
                {row.role ? <span className="text-text-faint">{row.role}</span> : null}
              </div>
            </div>
            <div className="shrink-0 text-right text-[11px] text-text-subtle tabular-nums">{timeLabel}</div>
          </div>
        );
      })}
    </div>
  );
}

/** 设置内统一开关：绿轨 + 白钮（与技能高级设置卡片一致） */
function SettingsSwitch({
  checked,
  disabled,
  onChange,
  size = "md",
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  size?: "sm" | "md";
  "aria-label"?: string;
}) {
  const trackClass = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knobClass = size === "sm" ? "left-0.5 top-0.5 h-3 w-3" : "left-0.5 top-0.5 h-4 w-4";
  const knobTranslate = size === "sm" ? "translate-x-3" : "translate-x-4";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative ${trackClass} shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb,16,185,129),0.55)] disabled:opacity-40 ${
        checked ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-[var(--ui-switch-track-off)]"
      }`}
    >
      <span
        className={`pointer-events-none absolute ${knobClass} rounded-full shadow-sm transition-transform ${
          checked ? "bg-[var(--theme-color-text)]" : "bg-white"
        } ${checked ? knobTranslate : "translate-x-0"}`}
      />
    </button>
  );
}

function SkillAdvancedPanel() {
  const { t } = useTranslation("settings");
  const { loading: trinityLoading, saving: trinitySaving, form, message: trinityMessage, update } =
    useTrinityConfig();

  const loading = trinityLoading;
  const busy = trinitySaving;
  const [nudgeDraft, setNudgeDraft] = useState(String(form.learning_nudge_interval));
  const [minCallsDraft, setMinCallsDraft] = useState(String(form.learning_min_tool_calls));
  const [reviewAdvancedOpen, setReviewAdvancedOpen] = useState(false);

  useEffect(() => {
    setNudgeDraft(String(form.learning_nudge_interval));
    setMinCallsDraft(String(form.learning_min_tool_calls));
  }, [form.learning_min_tool_calls, form.learning_nudge_interval]);

  const commitLearningNumber = useCallback(
    (field: "learning_nudge_interval" | "learning_min_tool_calls", raw: string) => {
      const parsed = Number.parseInt(raw, 10);
      const next = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
      if (form[field] !== next) {
        void update({ [field]: next });
      }
      if (field === "learning_nudge_interval") {
        setNudgeDraft(String(next));
      } else {
        setMinCallsDraft(String(next));
      }
    },
    [form, update]
  );

  if (loading) {
    return (
      <Panel
        title={t("skills.advancedTitle")}
        collapsible
        defaultCollapsed={false}
        titleClassName={SKILLS_SECTION_PANEL_TITLE_CLASS}
      >
        <div className="py-2 text-sm text-text-faint">{t("commonSettings.loadingEllipsis")}</div>
      </Panel>
    );
  }

  return (
    <Panel
      title={t("skills.advancedTitle")}
      collapsible
      defaultCollapsed={false}
      titleClassName={SKILLS_SECTION_PANEL_TITLE_CLASS}
    >
      <p className={`mb-3 ${SETTINGS_INTRO_CLASS}`}>
        <Trans t={t} i18nKey="skills.writesConfig" components={{ path: <code className="text-text-subtle" /> }} />
      </p>
      <div className="space-y-3">
        <SettingsToggleCard
          title={t("skills.skillFirst")}
          description={t("skills.skillFirstHint")}
          checked={form.skill_protocol}
          disabled={busy}
          onChange={(next) => void update({ skill_protocol: next })}
        />
        <SettingsToggleCard
          title={t("skills.allowManage")}
          description={t("skills.allowManageHint")}
          checked={form.skill_manage_enabled}
          disabled={busy}
          onChange={(next) => void update({ skill_manage_enabled: next })}
        />
        <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className={SETTINGS_LABEL_CLASS}>{t("skills.learning")}</div>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                {t("skills.learningHint")}
              </p>
            </div>
            <SettingsSwitch
              checked={form.learning_enabled}
              disabled={busy}
              onChange={(next) => void update({ learning_enabled: next })}
              aria-label={t("skills.learning")}
            />
          </div>
          <div className="mt-2.5 rounded-md bg-surface-panel px-3 py-2 text-[11px] text-text-faint">
            <Trans
              t={t}
              i18nKey="skills.observationsPath"
              values={{ obsPath: "~/.agenticx/sessions/<session_id>/tool_call_observations.json" }}
              components={{ path: <code className="text-text-subtle" /> }}
            />
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-text-subtle transition hover:text-text-primary"
              onClick={() => setReviewAdvancedOpen((v) => !v)}
              aria-expanded={reviewAdvancedOpen}
            >
              <ChevronRight
                className={`h-3.5 w-3.5 shrink-0 transition-transform ${reviewAdvancedOpen ? "rotate-90" : ""}`}
                aria-hidden
              />
              {t("skills.advancedToggle")}
            </button>
            {reviewAdvancedOpen ? (
              <div className="mt-2 space-y-3">
                <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                  {t("skills.nudgeInterval")}
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                    value={nudgeDraft}
                    disabled={busy || !form.learning_enabled}
                    onChange={(e) => setNudgeDraft(e.target.value)}
                    onBlur={() => commitLearningNumber("learning_nudge_interval", nudgeDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </label>
                <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                  {t("skills.minToolCalls")}
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                    value={minCallsDraft}
                    disabled={busy || !form.learning_enabled}
                    onChange={(e) => setMinCallsDraft(e.target.value)}
                    onBlur={() => commitLearningNumber("learning_min_tool_calls", minCallsDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {trinityMessage ? (
        <div
          className={`mt-2 text-xs ${trinityMessage.startsWith(t("commonSettings.savedPrefix")) ? "text-text-muted" : "text-rose-400"}`}
        >
          {trinityMessage}
        </div>
      ) : null}
    </Panel>
  );
}

function SessionMemoryPanel() {
  const { t } = useTranslation("settings");
  const { loading, saving, form, message, update } = useTrinityConfig();

  if (loading) {
    return (
      <Panel title={t("memory.title")}>
        <div className="py-2 text-sm text-text-faint">{t("commonSettings.loadingEllipsis")}</div>
      </Panel>
    );
  }

  return (
    <Panel title={t("memory.title")}>
      <p className={`mb-3 ${SETTINGS_INTRO_CLASS}`}>
        <Trans t={t} i18nKey="skills.writesConfig" components={{ path: <code className="text-text-subtle" /> }} />
      </p>
      <div className="space-y-3 text-sm text-text-subtle">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className={SETTINGS_LABEL_CLASS}>{t("memory.sessionSummary")}</div>
            <div className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t("memory.sessionSummaryHint")}</div>
          </div>
          <SettingsSwitch
            checked={form.session_summary}
            disabled={saving}
            onChange={(next) => void update({ session_summary: next })}
            aria-label={t("memory.sessionSummary")}
          />
        </div>
      </div>
      {message ? (
        <div className={`mt-2 text-xs ${message.startsWith(t("commonSettings.savedPrefix")) ? "text-text-muted" : "text-rose-400"}`}>
          {message}
        </div>
      ) : null}
    </Panel>
  );
}

function formatInstallDoneMsg(
  successLine: string,
  scan: { overall: string; skills: Parameters<typeof formatSkillScanSummary>[0]["skills"] } | null | undefined,
  t: TFunction,
): string {
  if (!scan?.skills?.length) return successLine;
  return `${successLine}

${formatSkillScanSummary(scan, t)}`;
}

function formatSkillScanSummary(scan: {
  overall: string;
  skills: Array<{
    skill_name: string;
    verdict: string;
    score?: number;
    grade?: string;
    tier?: string;
    findings?: Array<{
      pattern_name: string;
      severity?: string;
      matched_text?: string;
    }>;
  }>;
}, t: TFunction): string {
  const verdictLabel = (v: string) =>
    v === "dangerous" ? t("skills.scan.verdictDanger") : v === "caution" ? t("skills.scan.verdictCaution") : t("skills.scan.verdictOk");
  const sevLabel = (s: string | undefined) =>
    s === "dangerous" ? t("skills.scan.sevDanger") : s === "caution" ? t("skills.scan.sevCaution") : s ?? "";
  const patternLabelOf = (name: string) => {
    const key = `skills.scan.patterns.${name}`;
    const translated = t(key);
    return translated === key ? name : translated;
  };

  const lines = [
    t("skills.scan.header", { verdict: verdictLabel(scan.overall) }),
  ];
  for (const s of scan.skills) {
    const meta: string[] = [];
    if (s.grade) meta.push(t("skills.scan.grade", { grade: s.grade }));
    if (typeof s.score === "number") meta.push(t("skills.scan.score", { score: s.score }));
    if (s.tier) meta.push(s.tier);
    lines.push(
      `· ${s.skill_name || "skill"}：${verdictLabel(s.verdict)}${
        s.findings?.length ? t("skills.scan.hitRules", { count: s.findings.length }) : ""
      }${meta.length ? ` · ${meta.join(" · ")}` : ""}`
    );
    if (s.findings?.length) {
      for (const f of s.findings.slice(0, 8)) {
        const label = patternLabelOf(f.pattern_name);
        const matched = f.matched_text ? `「${f.matched_text.slice(0, 60)}」` : "";
        lines.push(`  ${sevLabel(f.severity)} ${label}${matched ? " — " + matched : ""}`);
      }
      if (s.findings.length > 8) {
        lines.push(t("skills.scan.moreFindings", { count: s.findings.length - 8 }));
      }
    }
  }
  return lines.join("\n");
}

function MetaMarkdownField({
  label,
  showLabel = true,
  value,
  rows,
  externalHint,
  externalHintText,
  placeholder,
  onChange,
  onAiAssist,
  aiAssistLoading,
  onOpenInEditor,
}: {
  label: string;
  showLabel?: boolean;
  value: string;
  rows: number;
  externalHint?: boolean;
  externalHintText?: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onAiAssist?: () => void;
  aiAssistLoading?: boolean;
  onOpenInEditor?: () => void;
}) {
  const { t } = useTranslation("settings");
  const [preview, setPreview] = useState(false);
  const toolbarBtnClass = (active?: boolean) =>
    `flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors disabled:opacity-40 ${
      active
        ? "bg-surface-hover"
        : "hover:bg-surface-hover hover:text-text-primary"
    }`;
  const iconClass = "h-3.5 w-3.5 shrink-0";
  return (
    <div>
      {showLabel ? <div className="mb-1.5 text-sm font-medium text-text-muted">{label}</div> : null}
      {externalHint ? (
        <div className="mb-1 text-[10px] text-amber-600/90 dark:text-amber-400/90">
          {externalHintText}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-surface-panel">
        <div className="flex h-9 items-center justify-between bg-surface-hover/35 pl-3 pr-2">
          <span className="text-[10px] font-medium tracking-wide text-text-faint">Markdown</span>
          <div className="flex items-center gap-0.5">
            {onAiAssist ? (
              <HoverTip label={value.trim() ? t("meta.aiPolish") : t("meta.aiGenerate")}>
                <button
                  type="button"
                  disabled={aiAssistLoading}
                  className={toolbarBtnClass()}
                  onClick={onAiAssist}
                >
                  {aiAssistLoading ? (
                    <Loader2 className={`${iconClass} animate-spin`} aria-hidden />
                  ) : (
                    <Sparkles className={iconClass} aria-hidden />
                  )}
                </button>
              </HoverTip>
            ) : null}
            <HoverTip label={t("meta.edit")}>
              <button
                type="button"
                className={toolbarBtnClass(!preview)}
                onClick={() => setPreview(false)}
              >
                <SquarePen className={iconClass} aria-hidden />
              </button>
            </HoverTip>
            <HoverTip label={t("meta.preview")}>
              <button
                type="button"
                className={toolbarBtnClass(preview)}
                onClick={() => setPreview(true)}
              >
                <Eye className={iconClass} aria-hidden />
              </button>
            </HoverTip>
            {onOpenInEditor ? (
              <HoverTip label={t("meta.openInEditor")}>
                <button type="button" className={toolbarBtnClass()} onClick={onOpenInEditor}>
                  <ExternalLink className={iconClass} aria-hidden />
                </button>
              </HoverTip>
            ) : null}
          </div>
        </div>
        {preview ? (
          <div
            className="agx-settings-md min-h-[4rem] w-full overflow-auto px-3 py-2 text-[13px] leading-5 text-text-primary [scrollbar-gutter:stable]"
            style={{ minHeight: `${rows * 1.625}rem` }}
          >
            {value.trim() ? (
              <ReactMarkdown
                remarkPlugins={settingsRemarkPlugins}
                components={settingsMarkdownComponents}
                urlTransform={chatUrlTransform}
              >
                {normalizeChatMarkdownContent(value)}
              </ReactMarkdown>
            ) : (
              <span className="text-text-faint italic">{t("meta.emptyPreview")}</span>
            )}
          </div>
        ) : (
          <textarea
            className="block w-full resize-none border-0 bg-transparent px-3 py-2 text-[13px] leading-5 text-text-primary placeholder:text-text-faint outline-none [scrollbar-gutter:stable] focus:ring-0"
            rows={rows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
        )}
      </div>
    </div>
  );
}

function formatMetaWorkspaceHistoryTime(id: string, savedAt: string): string {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return savedAt;
}

function SettingsToggleCard(props: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const { title, description, checked, disabled, onChange } = props;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className={SETTINGS_LABEL_CLASS}>{title}</div>
        <p className={`mt-1 ${SETTINGS_HINT_CLASS}`}>{description}</p>
      </div>
      <SettingsSwitch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={title}
      />
    </div>
  );
}


export function SettingsPanel({
  open,
  defaultProvider,
  providers,
  sessionId,
  apiBase,
  apiToken,
  mcpServers,
  onRefreshMcp,
  runMode,
  theme,
  chatStyle,
  onThemeChange,
  onChatStyleChange,
  onRunModeChange,
  onClose,
  onSave,
  panes,
  avatars,
  groups,
  onForwardFavorite,
}: Props) {
  const { t } = useTranslation("settings");
  const { t: tCommon } = useTranslation("common");
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const tabs = useMemo(
    () => TAB_DEFS.map((def) => ({ ...def, label: t(`tabs.${def.id}`) })),
    [t],
  );
  const userNickname = useAppStore((s) => s.userNickname);
  const setUserNickname = useAppStore((s) => s.setUserNickname);
  const userAvatarUrl = useAppStore((s) => s.userAvatarUrl);
  const setUserAvatarUrl = useAppStore((s) => s.setUserAvatarUrl);
  const userPreference = useAppStore((s) => s.userPreference);
  const setUserPreference = useAppStore((s) => s.setUserPreference);
  const themeColor = useAppStore((s) => s.themeColor);
  const setThemeColor = useAppStore((s) => s.setThemeColor);
  const metaAvatarUrl = useAppStore((s) => s.metaAvatarUrl);
  const effectiveMetaAvatarUrl = metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL;
  const settingsOpenToTab = useAppStore((s) => s.settings.openToTab);
  const settingsOpenToFocus = useAppStore((s) => s.settings.openToFocus);
  const settingsFocusSeq = useAppStore((s) => s.settings.focusSeq ?? 0);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const capabilityLocks = useAppStore((s) => s.capabilityLocks) ?? UNRESTRICTED_CAPABILITY_LOCKS;
  const memoryContextPane = panes.find((p) => p.id === activePaneId) ?? panes[0];
  const updateSettingsSlice = useAppStore((s) => s.updateSettings);
  const initializedForOpenRef = useRef(false);
  const metaWorkspaceHydratedRef = useRef(false);
  const [aiAssistLoading, setAiAssistLoading] = useState<"identity" | "soul" | "preference" | null>(null);
  const metaIdentityDraftRef = useRef("");
  const metaIdentitySavedRef = useRef("");
  const metaSoulDraftRef = useRef("");
  const metaSoulSavedRef = useRef("");
  const toolsTabRef = useRef<ToolsTabHandle>(null);
  const knowledgeRef = useRef<KnowledgeSettingsHandle>(null);
  const voiceSettingsRef = useRef<VoiceSettingsPanelHandle>(null);
  const securityTabRef = useRef<SecurityCenterTabHandle>(null);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [securityFocus, setSecurityFocus] = useState<SettingsFocus | undefined>();
  const [securityFocusSeq, setSecurityFocusSeq] = useState(0);
  const [userProfileEditing, setUserProfileEditing] = useState(false);
  const [metaEditorKind, setMetaEditorKind] = useState<"identity" | "soul" | null>(null);
  const [panelSize, setPanelSize] = useState<SettingsPanelSize>(() => loadSettingsPanelSize());
  const [navWidth, setNavWidth] = useState(() =>
    loadSettingsNavWidth(loadSettingsPanelSize().width),
  );
  useEffect(() => {
    if (!open) {
      setSecurityFocus(undefined);
      return;
    }
    if (!settingsOpenToTab && !settingsOpenToFocus) return;
    // 钩子管理已并入安全中心；旧 deep-link 仍要能打开到正确分区。
    if (settingsOpenToTab) {
      const TAB_ALIASES: Partial<Record<SettingsTab, SettingsTab>> = { hooks: "security" };
      setTab(TAB_ALIASES[settingsOpenToTab] ?? settingsOpenToTab);
    }
    if (settingsOpenToFocus) {
      setSecurityFocus(settingsOpenToFocus);
      setSecurityFocusSeq(settingsFocusSeq);
    }
    updateSettingsSlice({ openToTab: undefined, openToFocus: undefined });
  }, [open, settingsOpenToTab, settingsOpenToFocus, settingsFocusSeq, updateSettingsSlice]);
  useEffect(() => {
    if (!open) return;
    const size = loadSettingsPanelSize();
    setPanelSize(size);
    setNavWidth(loadSettingsNavWidth(size.width));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onWindowResize = () => {
      setPanelSize((prev) => {
        const next = clampSettingsPanelSize(prev);
        setNavWidth((nav) => clampSettingsNavWidth(nav, next.width));
        return next;
      });
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setNavWidth((prev) => clampSettingsNavWidth(prev, panelSize.width));
  }, [open, panelSize.width]);
  const onPanelResizeMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = panelSize.width;
    const startHeight = panelSize.height;
    document.body.classList.add("agx-settings-panel-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      setPanelSize(
        clampSettingsPanelSize({
          width: startWidth + (moveEvent.clientX - startX),
          height: startHeight + (moveEvent.clientY - startY),
        }),
      );
    };
    const onUp = () => {
      document.body.classList.remove("agx-settings-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setPanelSize((prev) => {
        saveSettingsPanelSize(prev);
        return prev;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [panelSize.height, panelSize.width]);
  const onNavResizeMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = navWidth;
    document.body.classList.add("agx-settings-nav-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      setNavWidth(clampSettingsNavWidth(startWidth + (moveEvent.clientX - startX), panelSize.width));
    };
    const onUp = () => {
      document.body.classList.remove("agx-settings-nav-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setNavWidth((prev) => {
        saveSettingsNavWidth(prev, panelSize.width);
        return prev;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [navWidth, panelSize.width]);
  const [active, setActive] = useState(defaultProvider || ALL_PROVIDERS[0]);
  const providerListScrollRef = useScrollbarOnScroll<HTMLDivElement>();
  const [draft, setDraft] = useState<Record<string, ProviderEntry>>({});
  const [providerSavedSnapshot, setProviderSavedSnapshot] = useState<Record<string, ProviderEntry>>({});
  const [providerSavedDefProv, setProviderSavedDefProv] = useState(defaultProvider);
  const [providerConfigMessage, setProviderConfigMessage] = useState("");
  const [providerConfigSaving, setProviderConfigSaving] = useState(false);
  const [defProv, setDefProv] = useState(defaultProvider);
  const [keyStatus, setKeyStatus] = useState<Record<string, "idle" | "checking" | "ok" | "fail">>({});
  const [keyError, setKeyError] = useState<Record<string, string>>({});
  const [keyWarning, setKeyWarning] = useState<Record<string, string>>({});
  const [modelHealthMap, setModelHealthMap] = useState<Record<string, ModelHealthEntry>>({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsModalOpen, setFetchModelsModalOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchModelsSearch, setFetchModelsSearch] = useState("");
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [fetchModelsWarning, setFetchModelsWarning] = useState<string | null>(null);
  const [addModelModalOpen, setAddModelModalOpen] = useState(false);
  const [addModelFormId, setAddModelFormId] = useState("");
  const [addModelFormName, setAddModelFormName] = useState("");
  const [addServiceVendorModalOpen, setAddServiceVendorModalOpen] = useState(false);
  const [addVendorFormName, setAddVendorFormName] = useState("");
  const [addVendorFormType, setAddVendorFormType] = useState<ProviderInterfaceKind>("openai");
  const [editModelModalOpen, setEditModelModalOpen] = useState(false);
  const [editModelOriginalId, setEditModelOriginalId] = useState("");
  const [editModelFormId, setEditModelFormId] = useState("");
  const [editModelError, setEditModelError] = useState<string | null>(null);
  const [inlineRenameProviderId, setInlineRenameProviderId] = useState<string | null>(null);
  const [inlineRenameValue, setInlineRenameValue] = useState("");
  const [providerDeleteConfirmId, setProviderDeleteConfirmId] = useState<string | null>(null);
  const [providerDeleteBusy, setProviderDeleteBusy] = useState(false);
  const inlineRenameInputRef = useRef<HTMLInputElement>(null);
  const [providerEnableHint, setProviderEnableHint] = useState<string | null>(null);
  const [defaultProvHint, setDefaultProvHint] = useState<string | null>(null);
  /** API 密钥显隐（切换左侧厂商时恢复为隐藏） */
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [mcpExtraPaths, setMcpExtraPaths] = useState<string[]>([]);
  const [mcpPathSaving, setMcpPathSaving] = useState(false);
  const [mcpServerBusy, setMcpServerBusy] = useState<Record<string, boolean>>({});
  const mcpServerInFlightRef = useRef<Record<string, boolean>>({});
  const mcpQueuedToggleRef = useRef<Record<string, boolean>>({});
  const [mcpOptimisticChecked, setMcpOptimisticChecked] = useState<Record<string, boolean>>({});
  const [mcpMessage, setMcpMessage] = useState("");
  const [mcpErrorInspect, setMcpErrorInspect] = useState<{ title: string; body: string } | null>(null);
  const [mcpDiscoverLoading, setMcpDiscoverLoading] = useState(false);
  const [mcpDiscoverHits, setMcpDiscoverHits] = useState<MCPDiscoveryHit[]>([]);
  const [mcpMarketplaceLoading, setMcpMarketplaceLoading] = useState(false);
  const [mcpMarketplaceItems, setMcpMarketplaceItems] = useState<Array<Record<string, unknown>>>([]);
  const [mcpMarketplaceSummary, setMcpMarketplaceSummary] = useState("");
  const [mcpMarketplaceSearch, setMcpMarketplaceSearch] = useState("");
  const [mcpMarketplaceInstallBusy, setMcpMarketplaceInstallBusy] = useState(false);
  const [mcpMarketplaceEnvSchema, setMcpMarketplaceEnvSchema] = useState<{ required: string[] }>({ required: [] });
  const [mcpMarketplaceInstalledIds, setMcpMarketplaceInstalledIds] = useState<Set<string>>(new Set());
  const [mcpMarketplaceInstallingId, setMcpMarketplaceInstallingId] = useState<string | null>(null);
  const [mcpMarketplaceStatus, setMcpMarketplaceStatus] = useState<{
    message: string;
    kind: "info" | "success" | "error";
    serverId?: string;
  } | null>(null);
  const [mcpMarketplaceIdToNames, setMcpMarketplaceIdToNames] = useState<Record<string, string[]>>(() => {
    try {
      const raw = readScopedLocalStorage(MCP_MARKETPLACE_ID_MAP_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
        }
        return out;
      }
    } catch {
      // ignore
    }
    return {};
  });
  const mcpMarketplaceDetailInFlightRef = useRef<Set<string>>(new Set());
  const mcpMarketplaceRequestSeqRef = useRef(0);
  const [mcpDisabledTools, setMcpDisabledTools] = useState<Record<string, string[]>>({});
  const [mcpSkipDefaultNames, setMcpSkipDefaultNames] = useState<string[]>([]);
  const [mcpDefaultEntryNames, setMcpDefaultEntryNames] = useState<string[]>([
    ...BUNDLED_DEFAULT_MCP_NAMES_FALLBACK,
  ]);
  const [mcpDeleteConfirmServerName, setMcpDeleteConfirmServerName] = useState<string | null>(null);
  const [mcpExpandedServers, setMcpExpandedServers] = useState<Set<string>>(new Set());
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [mcpEditorPath, setMcpEditorPath] = useState(MCP_PRIMARY_CONFIG_PATH);
  const [mcpEditorFocusServerName, setMcpEditorFocusServerName] = useState<string | undefined>(undefined);
  const [mcpEditorFocusToken, setMcpEditorFocusToken] = useState(0);
  const [mcpRemoteModalOpen, setMcpRemoteModalOpen] = useState(false);
  const [mcpRemoteModalMode, setMcpRemoteModalMode] = useState<"add" | "edit">("add");
  const [mcpRemoteEditName, setMcpRemoteEditName] = useState<string | undefined>(undefined);
  const [mcpRemoteDetailExpanded, setMcpRemoteDetailExpanded] = useState<Set<string>>(new Set());
  const fetchModelsRequestSeqRef = useRef(0);
  const authProbeGenerationRef = useRef(0);
  const [authProbeProgress, setAuthProbeProgress] = useState<{ done: number; total: number } | null>(null);
  const activeProviderRef = useRef(active);

  const [serverMode, setServerMode] = useState<"local" | "remote">("local");
  const [serverUrl, setServerUrl] = useState("");
  const [serverToken, setServerToken] = useState("");
  const [serverTestStatus, setServerTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [serverTestError, setServerTestError] = useState("");
  const [serverShowToken, setServerShowToken] = useState(false);
  const [metaSoul, setMetaSoul] = useState("");
  const [metaSoulSaved, setMetaSoulSaved] = useState("");
  const [metaSoulSaving, setMetaSoulSaving] = useState(false);
  const [metaIdentity, setMetaIdentity] = useState("");
  const [metaIdentitySaved, setMetaIdentitySaved] = useState("");
  const [metaIdentitySaving, setMetaIdentitySaving] = useState(false);
  const [metaWorkspaceMessage, setMetaWorkspaceMessage] = useState("");
  const [metaExternalHintIdentity, setMetaExternalHintIdentity] = useState(false);
  const [metaExternalHintSoul, setMetaExternalHintSoul] = useState(false);
  const [metaHistoryOpen, setMetaHistoryOpen] = useState(false);
  const [metaHistoryLoading, setMetaHistoryLoading] = useState(false);
  const [metaHistoryMessage, setMetaHistoryMessage] = useState("");
  const [metaHistoryIdentityItems, setMetaHistoryIdentityItems] = useState<
    Array<{ id: string; savedAt: string; preview: string }>
  >([]);
  const [metaHistorySoulItems, setMetaHistorySoulItems] = useState<
    Array<{ id: string; savedAt: string; preview: string }>
  >([]);
  const [userNicknameDraft, setUserNicknameDraft] = useState("");
  const [userPreferenceDraft, setUserPreferenceDraft] = useState("");
  const [userProfileMessage, setUserProfileMessage] = useState("");
  const [userAvatarMessage, setUserAvatarMessage] = useState("");
  const [workspaceDirDraft, setWorkspaceDirDraft] = useState("~/.agenticx/workspace");
  const [workspaceDirSaved, setWorkspaceDirSaved] = useState("~/.agenticx/workspace");
  const [workspaceDirResolved, setWorkspaceDirResolved] = useState("");
  const [workspaceDirMessage, setWorkspaceDirMessage] = useState("");
  const [workspaceDirSaving, setWorkspaceDirSaving] = useState(false);

  const workspaceDirDirty = workspaceDirDraft.trim() !== workspaceDirSaved.trim();
  const [gwEnabled, setGwEnabled] = useState(false);
  const [gwUrl, setGwUrl] = useState("");
  const [gwDeviceId, setGwDeviceId] = useState("");
  const [gwToken, setGwToken] = useState("");
  const [gwStudioBase, setGwStudioBase] = useState("");
  const [gwShowToken, setGwShowToken] = useState(false);
  const [gwAdvancedOpen, setGwAdvancedOpen] = useState(false);
  const [gwQrOpen, setGwQrOpen] = useState(false);
  // WeChat iLink sidecar
  const [wechatStatus, setWechatStatus] = useState<"idle" | "binding" | "connected" | "stale" | "recovering" | "expired" | "error">("idle");
  const [wechatBotId, setWechatBotId] = useState("");
  const [wechatQrUrl, setWechatQrUrl] = useState("");
  const [wechatQrFallbackUrl, setWechatQrFallbackUrl] = useState("");
  const [wechatBindSessionId, setWechatBindSessionId] = useState("");
  const [wechatBindSidecarPort, setWechatBindSidecarPort] = useState(0);
  const [wechatBindMsg, setWechatBindMsg] = useState("");
  // Feishu long-connection
  const [imTab, setImTab] = useState<"feishu" | "webhook">("feishu");
  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [feishuAppId, setFeishuAppId] = useState("");
  const [feishuAppSecret, setFeishuAppSecret] = useState("");
  const [feishuShowSecret, setFeishuShowSecret] = useState(false);
  const [feishuSaving, setFeishuSaving] = useState(false);
  const [gwBindings, setGwBindings] = useState<
    Array<{ platform: string; sender_id: string; device_id: string; bound_at: number }>
  >([]);
  const [gwBindingsLoading, setGwBindingsLoading] = useState(false);
  const [gwBindingsErr, setGwBindingsErr] = useState("");

  const refreshGwBindings = useCallback(async () => {
    const base = gwUrl.trim().replace(/\/+$/, "");
    const did = gwDeviceId.trim();
    const tok = gwToken.trim();
    if (!base || !did || !tok) {
      setGwBindings([]);
      setGwBindingsErr("");
      return;
    }
    setGwBindingsLoading(true);
    setGwBindingsErr("");
    try {
      const r = await fetch(
        `${base}/api/device/${encodeURIComponent(did)}/bindings?token=${encodeURIComponent(tok)}`,
      );
      const text = await r.text();
      let j: { bindings?: typeof gwBindings; detail?: string | unknown[] };
      try {
        j = JSON.parse(text) as { bindings?: typeof gwBindings; detail?: string | unknown[] };
      } catch {
        throw new Error(text.slice(0, 160) || `HTTP ${r.status}`);
      }
      if (!r.ok) {
        const d = j.detail;
        const msg =
          typeof d === "string" ? d : Array.isArray(d) ? JSON.stringify(d) : text.slice(0, 160);
        throw new Error(msg || `HTTP ${r.status}`);
      }
      setGwBindings(Array.isArray(j.bindings) ? j.bindings : []);
    } catch (e) {
      setGwBindingsErr(String(e));
      setGwBindings([]);
    } finally {
      setGwBindingsLoading(false);
    }
  }, [gwUrl, gwDeviceId, gwToken]);

  // Refresh wechat sidecar status with 3-source reconciliation (sidecar + binding time + reported age)
  const refreshWechatStatus = useCallback(async () => {
    try {
      const portInfo = await window.agenticxDesktop.wechatSidecarPort();
      if (!portInfo.running || !portInfo.port) return;
      const resp = await fetch(`http://127.0.0.1:${portInfo.port}/status`);
      if (!resp.ok) return;
      const data: { connected?: boolean; bot_id?: string; status?: string; stale?: boolean; credential_age_hours?: number } = await resp.json();
      let bindingAgeH = 0;
      try {
        const b = await window.agenticxDesktop.loadWechatBinding();
        const d = (b.bindings as any)?.["_desktop"];
        if (d?.bound_at) {
          const bt = Date.parse(String(d.bound_at));
          if (!Number.isNaN(bt)) bindingAgeH = (Date.now() - bt) / 3600000;
        }
      } catch {}
      const age = data.credential_age_hours ?? bindingAgeH ?? 0;

      const sidecarConnected = !!data.connected;
      const sidecarStale = !!data.stale;

      // Live connection from sidecar takes precedence.
      // Age-based staleness only applies when we don't have a positive live connection.
      const isStale = sidecarStale || (!sidecarConnected && age > 20);

      if (sidecarConnected && !sidecarStale) {
        setWechatStatus("connected");
        setWechatBotId(data.bot_id || "");
      } else if (isStale) {
        setWechatStatus("stale");
        setWechatBotId(data.bot_id || "");
      } else if (data.bot_id) {
        setWechatStatus("idle");
        setWechatBotId(data.bot_id);
      }
    } catch {
      // silent; do not overwrite user-visible state on transient error
    }
  }, []);

  useEffect(() => {
    if (!open || tab !== "server") return;
    void refreshGwBindings();
  }, [open, tab, refreshGwBindings]);

  useEffect(() => {
    // Reset the guard when dialog is closed.
    if (!open) {
      initializedForOpenRef.current = false;
      metaWorkspaceHydratedRef.current = false;
      fetchModelsRequestSeqRef.current += 1;
      setFetchingModels(false);
      setFetchModelsModalOpen(false);
      setFetchedModels([]);
      setFetchModelsSearch("");
      setFetchModelsError(null);
      setEditModelModalOpen(false);
      setEditModelOriginalId("");
      setEditModelFormId("");
      setEditModelError(null);
      setAddServiceVendorModalOpen(false);
      setAddVendorFormName("");
      return;
    }
    // IMPORTANT: only initialize once per open cycle.
    // Otherwise parent re-renders (or async prop updates) can overwrite
    // user's in-panel selection and force active provider back to default.
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;

    const merged: Record<string, ProviderEntry> = {};
    for (const name of ALL_PROVIDERS) {
      merged[name] = providerEntryFromSaved(providers[name]);
    }
    for (const [name, saved] of Object.entries(providers)) {
      if (!merged[name]) {
        merged[name] = providerEntryFromSaved(saved);
      }
    }
    setDraft(merged);
    setProviderSavedSnapshot(cloneProviderDraftMap(merged));
    setProviderSavedDefProv(defaultProvider || ALL_PROVIDERS[0]);
    setProviderConfigMessage("");
    setProviderConfigSaving(false);
    setProviderEnableHint(null);
    setDefaultProvHint(null);
    setDefProv(defaultProvider || ALL_PROVIDERS[0]);
    setActive(defaultProvider || ALL_PROVIDERS[0]);
    setKeyStatus({});
    setKeyError({});
    setModelHealthMap({});
    setMcpMessage("");
    setMetaWorkspaceMessage("");
    setWorkspaceDirMessage("");
    setUserNicknameDraft(userNickname);
    setUserPreferenceDraft(userPreference);
    setUserProfileMessage("");
    setServerTestStatus("idle");
    setServerTestError("");
    void window.agenticxDesktop.loadRemoteServer().then((rs) => {
      setServerMode(rs.enabled ? "remote" : "local");
      setServerUrl(rs.url || "");
      setServerToken(rs.token || "");
    });
    void window.agenticxDesktop.loadGatewayIm().then((gw) => {
      setGwEnabled(gw.enabled);
      setGwUrl(gw.url || "");
      setGwDeviceId(gw.deviceId || "");
      setGwToken(gw.token || "");
      setGwStudioBase(gw.studioBaseUrl || "");
    });
    void window.agenticxDesktop.loadFeishuConfig().then((lc) => {
      setFeishuEnabled(lc.enabled);
      setFeishuAppId(lc.appId || "");
      setFeishuAppSecret(lc.appSecret || "");
    });
    void refreshWechatStatus();
    void window.agenticxDesktop.loadWorkspaceConfig().then((res) => {
      if (!res?.ok) return;
      const dir = String(res.workspaceDir ?? "~/.agenticx/workspace").trim() || "~/.agenticx/workspace";
      setWorkspaceDirDraft(dir);
      setWorkspaceDirSaved(dir);
      setWorkspaceDirResolved(String(res.resolvedPath ?? "").trim());
    });
    if (sessionId) void onRefreshMcp(sessionId);
  }, [open, providers, defaultProvider, sessionId, onRefreshMcp, userNickname, userPreference]);

  // Poll for wechat status while settings panel (server tab) is open
  useEffect(() => {
    if (!open || tab !== "server") return;
    // initial refresh already scheduled in prior effect; add recurring
    const t = setInterval(() => { void refreshWechatStatus(); }, 45000);
    return () => clearInterval(t);
  }, [open, tab, refreshWechatStatus]);

  const userProfileDirty =
    userNicknameDraft !== userNickname || userPreferenceDraft !== userPreference;

  const saveUserProfile = useCallback(() => {
    setUserNickname(userNicknameDraft);
    setUserPreference(userPreferenceDraft);
    // 同步写入 USER.md，供运行时 workspace context 读取
    const userMdContent = [
      "# USER.md - About Your User",
      "",
      `- Name: ${userNicknameDraft.trim() || "(unknown)"}`,
      `- Preferred address: ${userNicknameDraft.trim() || "(unknown)"}`,
      "- Timezone: Asia/Shanghai",
      "- Preferences:",
      ...(userPreferenceDraft.trim()
        ? userPreferenceDraft.trim().split("\n").map((l) => `  ${l}`)
        : ["  (not set)"]),
    ].join("\n");
    void window.agenticxDesktop.saveUserMd({ content: userMdContent });
    setUserProfileMessage(t("profile.savedToast"));
  }, [setUserNickname, setUserPreference, t, userNicknameDraft, userPreferenceDraft]);

  const metaSoulDirty = metaSoul !== metaSoulSaved;
  const metaIdentityDirty = metaIdentity !== metaIdentitySaved;

  useEffect(() => {
    metaIdentityDraftRef.current = metaIdentity;
    metaIdentitySavedRef.current = metaIdentitySaved;
    metaSoulDraftRef.current = metaSoul;
    metaSoulSavedRef.current = metaSoulSaved;
  }, [metaIdentity, metaIdentitySaved, metaSoul, metaSoulSaved]);

  const loadMetaWorkspaceHistory = useCallback(async () => {
    setMetaHistoryLoading(true);
    setMetaHistoryMessage("");
    try {
      const [identityRes, soulRes] = await Promise.all([
        window.agenticxDesktop.listMetaWorkspaceHistory({ kind: "identity" }),
        window.agenticxDesktop.listMetaWorkspaceHistory({ kind: "soul" }),
      ]);
      if (identityRes?.ok) {
        setMetaHistoryIdentityItems(identityRes.items ?? []);
      } else {
        setMetaHistoryMessage(identityRes?.error ?? t("meta.loadIdentityHistoryFailed"));
      }
      if (soulRes?.ok) {
        setMetaHistorySoulItems(soulRes.items ?? []);
      } else if (!identityRes?.ok) {
        setMetaHistoryMessage(soulRes?.error ?? t("meta.loadSoulHistoryFailed"));
      }
    } catch (err) {
      setMetaHistoryMessage(String(err));
    } finally {
      setMetaHistoryLoading(false);
    }
  }, []);

  const reloadMetaWorkspaceFromDisk = useCallback(async () => {
    const [identityRes, soulRes] = await Promise.all([
      window.agenticxDesktop.loadMetaIdentity(),
      window.agenticxDesktop.loadMetaSoul(),
    ]);
    const diskIdentity = identityRes?.ok ? identityRes.content ?? "" : "";
    const diskSoul = soulRes?.ok ? soulRes.content ?? "" : "";

    const localIdentity = metaIdentityDraftRef.current;
    const savedIdentity = metaIdentitySavedRef.current;
    const localSoul = metaSoulDraftRef.current;
    const savedSoul = metaSoulSavedRef.current;

    const applyIdentity = (content: string) => {
      setMetaIdentity(content);
      setMetaIdentitySaved(content);
      setMetaExternalHintIdentity(false);
    };
    const applySoul = (content: string) => {
      setMetaSoul(content);
      setMetaSoulSaved(content);
      setMetaExternalHintSoul(false);
    };

    if (!metaWorkspaceHydratedRef.current) {
      applyIdentity(diskIdentity);
      applySoul(diskSoul);
      metaWorkspaceHydratedRef.current = true;
      return;
    }

    if (localIdentity === savedIdentity && diskIdentity !== savedIdentity) {
      const dlg = await window.agenticxDesktop.confirmDialog({
        title: t("meta.externalIdentityTitle"),
        message: t("meta.externalIdentityBody"),
        confirmText: t("meta.load"),
        cancelText: t("meta.keepEditing"),
      });
      if (dlg.confirmed) {
        applyIdentity(diskIdentity);
      } else {
        setMetaExternalHintIdentity(true);
      }
    } else if (localIdentity !== savedIdentity && diskIdentity !== savedIdentity) {
      setMetaExternalHintIdentity(true);
    } else if (localIdentity === savedIdentity) {
      applyIdentity(diskIdentity);
    }

    if (localSoul === savedSoul && diskSoul !== savedSoul) {
      const dlg = await window.agenticxDesktop.confirmDialog({
        title: t("meta.externalIdentityTitle"),
        message: t("meta.externalSoulBody"),
        confirmText: t("meta.load"),
        cancelText: t("meta.keepEditing"),
      });
      if (dlg.confirmed) {
        applySoul(diskSoul);
      } else {
        setMetaExternalHintSoul(true);
      }
    } else if (localSoul !== savedSoul && diskSoul !== savedSoul) {
      setMetaExternalHintSoul(true);
    } else if (localSoul === savedSoul) {
      applySoul(diskSoul);
    }
  }, []);

  useEffect(() => {
    if (!open || tab !== "general") return;
    void reloadMetaWorkspaceFromDisk();
  }, [open, tab, reloadMetaWorkspaceFromDisk]);

  useEffect(() => {
    if (!open || tab !== "general" || !metaHistoryOpen) return;
    void loadMetaWorkspaceHistory();
  }, [open, tab, metaHistoryOpen, loadMetaWorkspaceHistory]);

  const openMetaWorkspaceInEditor = useCallback(async (kind: "identity" | "soul") => {
    const res = await window.agenticxDesktop.openMetaWorkspaceFile({ kind });
    if (!res?.ok) {
      setMetaWorkspaceMessage(t("meta.openFailed", { reason: res?.error ?? t("commonSettings.unknownError") }));
    }
  }, []);

  const restoreMetaWorkspaceHistoryItem = useCallback(
    async (kind: "identity" | "soul", id: string) => {
      const dlg = await window.agenticxDesktop.confirmDialog({
        title: t("meta.restoreTitle"),
        message: t("meta.restoreBody"),
        confirmText: t("meta.restore"),
        cancelText: tCommon("cancel"),
        destructive: true,
      });
      if (!dlg.confirmed) return;

      try {
        const res = await window.agenticxDesktop.restoreMetaWorkspaceHistory({ kind, id });
        if (!res?.ok) {
          setMetaWorkspaceMessage(t("meta.restoreFailed", { reason: res?.error ?? t("commonSettings.unknownError") }));
          return;
        }
        const content = res.content ?? "";
        if (kind === "identity") {
          setMetaIdentity(content);
          setMetaIdentitySaved(content);
          setMetaExternalHintIdentity(false);
        } else {
          setMetaSoul(content);
          setMetaSoulSaved(content);
          setMetaExternalHintSoul(false);
        }
        setMetaWorkspaceMessage(t("meta.restoredToast"));
        if (metaHistoryOpen) void loadMetaWorkspaceHistory();
      } catch (err) {
        setMetaWorkspaceMessage(t("meta.restoreFailed", { reason: String(err) }));
      }
    },
    [loadMetaWorkspaceHistory, metaHistoryOpen],
  );

  const saveMetaWorkspace = useCallback(async () => {
    setMetaIdentitySaving(true);
    setMetaSoulSaving(true);
    setMetaWorkspaceMessage("");
    const errors: string[] = [];
    try {
      if (metaIdentityDirty) {
        const res = await window.agenticxDesktop.saveMetaIdentity({ content: metaIdentity });
        if (res?.ok) {
          setMetaIdentitySaved(metaIdentity);
        } else {
          errors.push(t("meta.identitySaveError", { reason: res?.error ?? t("commonSettings.unknownError") }));
        }
      }
      if (metaSoulDirty) {
        const res = await window.agenticxDesktop.saveMetaSoul({ content: metaSoul });
        if (res?.ok) {
          setMetaSoulSaved(metaSoul);
        } else {
          errors.push(t("meta.soulSaveError", { reason: res?.error ?? t("commonSettings.unknownError") }));
        }
      }
      if (errors.length > 0) {
        setMetaWorkspaceMessage(t("meta.saveFailedJoin", { reasons: errors.join("；") }));
      } else if (metaIdentityDirty || metaSoulDirty) {
        setMetaWorkspaceMessage(t("meta.savedNextTurn"));
        if (metaHistoryOpen) void loadMetaWorkspaceHistory();
      }
    } catch (err) {
      setMetaWorkspaceMessage(t("commonSettings.saveFailedWithReason", { reason: String(err) }));
    } finally {
      setMetaIdentitySaving(false);
      setMetaSoulSaving(false);
    }
  }, [
    metaIdentity,
    metaIdentityDirty,
    metaSoul,
    metaSoulDirty,
    metaHistoryOpen,
    loadMetaWorkspaceHistory,
  ]);

  const chooseWorkspaceDirectory = useCallback(async () => {
    setWorkspaceDirMessage("");
    try {
      const res = await window.agenticxDesktop.chooseDirectory();
      if (res?.canceled) return;
      if (!res?.ok || !res.path) {
        setWorkspaceDirMessage(res?.error ? t("commonSettings.chooseFailed", { reason: res.error }) : t("commonSettings.noDirectorySelected"));
        return;
      }
      setWorkspaceDirDraft(res.path);
    } catch (err) {
      setWorkspaceDirMessage(t("commonSettings.chooseFailed", { reason: String(err) }));
    }
  }, []);

  const saveWorkspaceDirectory = useCallback(async () => {
    const trimmed = workspaceDirDraft.trim();
    if (!trimmed) {
      setWorkspaceDirMessage(t("profile.workspaceEmpty"));
      return;
    }
    setWorkspaceDirSaving(true);
    setWorkspaceDirMessage("");
    try {
      const res = await window.agenticxDesktop.saveWorkspaceConfig({ workspaceDir: trimmed });
      if (!res?.ok) {
        setWorkspaceDirMessage(t("commonSettings.saveFailedWithReason", { reason: res?.error ?? t("commonSettings.unknownError") }));
        return;
      }
      const saved = String(res.workspaceDir ?? trimmed).trim() || trimmed;
      setWorkspaceDirDraft(saved);
      setWorkspaceDirSaved(saved);
      setWorkspaceDirResolved(String(res.resolvedPath ?? "").trim());
      if (res.changed) {
        void reloadMetaWorkspaceFromDisk();
        const restartDlg = await window.agenticxDesktop.confirmDialog({
          title: t("profile.workspaceUpdatedTitle"),
          message: t("profile.workspaceUpdatedBody"),
          detail:
            t("profile.workspaceRestartDetail"),
          confirmText: t("commonSettings.restartNow"),
          cancelText: t("commonSettings.restartLater"),
        });
        if (restartDlg.confirmed) {
          await window.agenticxDesktop.appRelaunch();
          return;
        }
        setWorkspaceDirMessage(t("profile.workspaceSavedRestart"));
      } else {
        setWorkspaceDirMessage(t("profile.workspaceSavedUnchanged"));
      }
    } catch (err) {
      setWorkspaceDirMessage(t("commonSettings.saveFailedWithReason", { reason: String(err) }));
    } finally {
      setWorkspaceDirSaving(false);
    }
  }, [reloadMetaWorkspaceFromDisk, workspaceDirDraft]);

  const callAiAssist = useCallback(
    async (kind: "identity" | "soul" | "preference") => {
      const setMsg = kind === "preference" ? setUserProfileMessage : setMetaWorkspaceMessage;
      const currentContent =
        kind === "identity" ? metaIdentity : kind === "soul" ? metaSoul : userPreferenceDraft;

      const prompts: Record<typeof kind, { system: string; user: string }> = {
        identity: {
          system:
            "你是一个帮助用户配置 AI 助理身份定义的助手。直接输出可填入 IDENTITY.md 的 Markdown 内容，不要加任何解释或前缀。",
          user: currentContent.trim()
            ? `请对以下身份定义进行润色，让它更清晰、更有个性，保留 Markdown 格式：\n\n${currentContent}`
            : "请为一个名为 Near 的个人 AI 助理生成一份简洁的身份定义（IDENTITY.md），Markdown 格式，包含 Name、Role、Persona 字段。",
        },
        soul: {
          system:
            "你是一个帮助用户配置 AI 助理人格原则的助手。直接输出可填入 SOUL.md 的 Markdown 内容，不要加任何解释或前缀。",
          user: currentContent.trim()
            ? `请对以下全局人格进行润色，让原则更清晰、更有可操作性，保留 Markdown 格式：\n\n${currentContent}`
            : "请为一个个人 AI 助理生成一份全局人格文档（SOUL.md），Markdown 格式，包含行为准则和沟通风格。",
        },
        preference: {
          system:
            "你是一个帮助用户描述自己使用 AI 时偏好的助手。输出简洁的纯文本偏好描述（非 Markdown），不超过 200 字，直接输出内容，不要加任何前缀。",
          user: currentContent.trim()
            ? `请润色以下用户偏好描述，让它更自然、更清晰：\n\n${currentContent}`
            : "请生成一段示例用户偏好描述，内容包含：回复风格、格式偏好、沟通习惯等，字数在 100 字以内。",
        },
      };
      const { system, user } = prompts[kind];

      // 从当前激活的 provider 取 API 配置
      const store = await import("../store").then((m) => m.useAppStore.getState());
      const activeProvider = store.activeProvider || defaultProvider || "";
      const providerEntry = providers[activeProvider];
      const apiKey = providerEntry?.apiKey ?? "";
      const baseUrl = providerEntry?.baseUrl ?? "";
      const model = providerEntry?.model ?? store.activeModel ?? "";

      setAiAssistLoading(kind);
      setMsg("");
      try {
        const res = await window.agenticxDesktop.aiAssistComplete({
          systemPrompt: system,
          userPrompt: user,
          provider: activeProvider,
          apiKey,
          baseUrl,
          model,
        });
        if (!res?.ok) {
          setMsg(t("profile.aiAssistFailed", { reason: res?.error ?? t("commonSettings.unknownError") }));
          return;
        }
        const result = (res.content ?? "").trim();
        if (!result) {
          setMsg(t("profile.aiEmpty"));
          return;
        }
        if (kind === "identity") {
          setMetaIdentity(result);
          setMetaWorkspaceMessage(t("profile.aiGeneratedIdentity"));
        } else if (kind === "soul") {
          setMetaSoul(result);
          setMetaWorkspaceMessage(t("profile.aiGeneratedSoul"));
        } else {
          setUserPreferenceDraft(result);
          setUserProfileMessage(t("profile.aiGeneratedPreference"));
        }
      } catch (err) {
        setMsg(t("profile.aiAssistFailed", { reason: String(err) }));
      } finally {
        setAiAssistLoading(null);
      }
    },
    [metaIdentity, metaSoul, userPreferenceDraft, defaultProvider, providers],
  );

  const handleProfileAvatarUpload = useCallback(
    (file: File) => {
      const maxBytes = 1.8 * 1024 * 1024;
      if (!file.type.startsWith("image/")) {
        setUserAvatarMessage(t("profile.pickImage"));
        return;
      }
      if (file.size > maxBytes) {
        setUserAvatarMessage(t("profile.imageTooLarge"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (!result) {
          setUserAvatarMessage(t("profile.readImageFailed"));
          return;
        }
        setUserAvatarUrl(result);
        setUserAvatarMessage(t("profile.avatarUpdated"));
      };
      reader.onerror = () => {
        setUserAvatarMessage(t("profile.readImageFailed"));
      };
      reader.readAsDataURL(file);
    },
    [setUserAvatarUrl]
  );

  useEffect(() => {
    if (!open || tab !== "mcp") return;
    void window.agenticxDesktop.getMcpSettings().then((r) => {
      if (r.ok && Array.isArray(r.extra_search_paths)) {
        setMcpExtraPaths([...r.extra_search_paths]);
      }
      if (r.ok && r.disabled_tools && typeof r.disabled_tools === "object") {
        setMcpDisabledTools(r.disabled_tools as Record<string, string[]>);
      }
      if (r.ok && Array.isArray(r.skip_default_names)) {
        setMcpSkipDefaultNames(r.skip_default_names.map((x) => String(x).trim()).filter(Boolean));
      }
      if (r.ok && Array.isArray(r.default_entry_names)) {
        setMcpDefaultEntryNames(r.default_entry_names.map((x) => String(x).trim()).filter(Boolean));
      }
    });
  }, [open, tab]);

  const persistMcpExtraPaths = useCallback(
    async (next: string[]) => {
      const cleaned = next.map((x) => x.trim()).filter(Boolean);
      setMcpPathSaving(true);
      setMcpMessage("");
      try {
        const r = await window.agenticxDesktop.putMcpSettings({ extraSearchPaths: cleaned });
        if (r.ok) {
          setMcpExtraPaths(cleaned);
          setMcpMessage(t("mcp.pathSaved"));
          if (sessionId) await onRefreshMcp(sessionId);
        } else {
          setMcpMessage(t("mcp.pathSaveFailed", { reason: r.error ?? t("commonSettings.unknownError") }));
        }
      } catch (err) {
        setMcpMessage(t("mcp.pathSaveFailed", { reason: String(err) }));
      } finally {
        setMcpPathSaving(false);
      }
    },
    [sessionId, onRefreshMcp]
  );

  const current = useMemo((): ProviderEntry => {
    const empty: ProviderEntry = {
      apiKey: "",
      baseUrl: "",
      model: "",
      models: [],
      enabled: false,
      dropParams: false,
    };
    const raw = draft[active];
    if (!raw || typeof raw !== "object") {
      return empty;
    }
    return {
      ...empty,
      ...raw,
      apiKey: String(raw.apiKey ?? ""),
      baseUrl: String(raw.baseUrl ?? ""),
      model: String(raw.model ?? ""),
      models: Array.isArray(raw.models) ? raw.models.map((m) => String(m)) : [],
      enabled: raw.enabled !== false,
      dropParams: raw.dropParams === true,
      displayName: raw.displayName != null && String(raw.displayName).trim() ? String(raw.displayName).trim() : undefined,
      interface:
        raw.interface === "openai" || raw.interface === "ollama" ? raw.interface : undefined,
    };
  }, [draft, active]);

  const filteredFetchedModels = useMemo(() => {
    const keyword = fetchModelsSearch.trim().toLowerCase();
    if (!keyword) return fetchedModels;
    return fetchedModels.filter((model) => model.toLowerCase().includes(keyword));
  }, [fetchedModels, fetchModelsSearch]);

  useEffect(() => {
    setApiKeyVisible(false);
  }, [active]);

  useEffect(() => {
    if (!inlineRenameProviderId) return;
    const t = window.setTimeout(() => {
      inlineRenameInputRef.current?.focus();
      inlineRenameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [inlineRenameProviderId]);

  useEffect(() => {
    setFetchModelsModalOpen(false);
    setFetchedModels([]);
    setFetchModelsSearch("");
    setFetchModelsError(null);
    setFetchingModels(false);
    authProbeGenerationRef.current += 1;
    setAuthProbeProgress(null);
    activeProviderRef.current = active;
    fetchModelsRequestSeqRef.current += 1;
  }, [active]);

  const currentEffectiveOn = useMemo(() => providerEffectiveOn(draft[active]), [draft, active]);

  const updateField = useCallback(
    (field: keyof ProviderEntry, value: string | string[] | boolean) => {
      setDraft((prev) => {
        const prevEntry = prev[active] ?? {
          apiKey: "",
          baseUrl: "",
          model: "",
          models: [],
          enabled: false,
          dropParams: false,
        };
        const next: ProviderEntry = { ...prevEntry, [field]: value as never };
        if (field === "apiKey" || field === "baseUrl") {
          const k = (field === "apiKey" ? String(value) : next.apiKey).trim();
          const u = (field === "baseUrl" ? String(value) : next.baseUrl).trim();
          if (!k && !u) next.enabled = false;
        }
        return { ...prev, [active]: next };
      });
      if (field === "apiKey" || field === "baseUrl") {
        setProviderEnableHint(null);
        setDefaultProvHint(null);
      }
    },
    [active]
  );

  const providerNames = useMemo(() => {
    const set = new Set<string>([...ALL_PROVIDERS, ...Object.keys(draft)]);
    return Array.from(set);
  }, [draft]);

  const providerConfigDirty = useMemo(() => {
    if (defProv !== providerSavedDefProv) return true;
    const normalizedDraft = normalizeProviderDraftForCompare(draft);
    const normalizedSaved = normalizeProviderDraftForCompare(providerSavedSnapshot);
    return !providerDraftMapsEqual(normalizedDraft, normalizedSaved);
  }, [defProv, draft, providerSavedDefProv, providerSavedSnapshot]);

  const saveProviderConfig = useCallback(async () => {
    if (!providerConfigDirty || providerConfigSaving) return;
    setProviderConfigSaving(true);
    setProviderConfigMessage("");
    try {
      const normalized: Record<string, ProviderEntry> = {};
      for (const [name, entry] of Object.entries(draft)) {
        normalized[name] = normalizeProviderEntry({
          ...entry,
          baseUrl: normalizeProviderBaseUrlForSave(name, entry.baseUrl, entry),
        });
      }
      await onSave({ defaultProvider: defProv, providers: normalized });
      setProviderSavedSnapshot(cloneProviderDraftMap(normalized));
      setProviderSavedDefProv(defProv);
      setProviderConfigMessage(t("commonSettings.saved"));
    } catch (err) {
      setProviderConfigMessage(t("commonSettings.saveFailedColon", { reason: err instanceof Error ? err.message : String(err) }));
    } finally {
      setProviderConfigSaving(false);
    }
  }, [defProv, draft, onSave, providerConfigDirty, providerConfigSaving]);

  const onValidateKey = async () => {
    if (!providerCredentialed(current)) return;
    setKeyStatus((p) => ({ ...p, [active]: "checking" }));
    setKeyError((p) => ({ ...p, [active]: "" }));
    setKeyWarning((p) => ({ ...p, [active]: "" }));
    const res = await window.agenticxDesktop.validateKey({ provider: active, apiKey: current.apiKey, baseUrl: current.baseUrl || undefined });
    setKeyStatus((p) => ({ ...p, [active]: res.ok ? "ok" : "fail" }));
    if (res.ok && res.warning) {
      setKeyWarning((p) => ({ ...p, [active]: res.warning ?? "" }));
    }
    if (!res.ok) setKeyError((p) => ({ ...p, [active]: res.error ?? t("commonSettings.unknownError") }));
  };

  const onFetchModels = async () => {
    if (!providerCredentialed(current)) return;
    const requestProvider = active;
    const requestId = fetchModelsRequestSeqRef.current + 1;
    fetchModelsRequestSeqRef.current = requestId;
    const requestApiKey = current.apiKey;
    const requestBaseUrl = current.baseUrl || undefined;
    setFetchModelsError(null);
    setFetchModelsWarning(null);
    setFetchingModels(true);
    try {
      const res = await window.agenticxDesktop.fetchModels({
        provider: requestProvider,
        apiKey: requestApiKey,
        baseUrl: requestBaseUrl,
      });
      const isLatestRequest = fetchModelsRequestSeqRef.current === requestId;
      const providerUnchanged = activeProviderRef.current === requestProvider;
      if (!isLatestRequest || !providerUnchanged) return;
      if (!res.ok) {
        setFetchModelsError(res.error ?? t("provider.fetchModelsFailed"));
        return;
      }
      if (res.warning) {
        setFetchModelsWarning(res.warning);
      }
      if (res.models.length === 0) return;
      const normalized = Array.from(
        new Set(
          [...current.models, ...res.models].map((m) => String(m).trim()).filter(Boolean),
        ),
      );
      setFetchedModels(normalized);
      setFetchModelsSearch("");
      setFetchModelsModalOpen(true);
      // Probe the full catalog (incl. already-visible): mark unauthorized, and
      // auto-purge historically "+" models the key can no longer call.
      if (normalized.length > 0) {
        void runAuthProbeQueue(
          requestProvider,
          normalized,
          requestApiKey,
          requestBaseUrl,
          { purgeVisibleUnauthorized: true, visibleModels: [...current.models] },
        );
      }
    } catch (err) {
      if (
        fetchModelsRequestSeqRef.current === requestId &&
        activeProviderRef.current === requestProvider
      ) {
        setFetchModelsError(t("provider.fetchModelsFailedReason", { reason: String(err) }));
      }
    } finally {
      if (
        fetchModelsRequestSeqRef.current === requestId &&
        activeProviderRef.current === requestProvider
      ) {
        setFetchingModels(false);
      }
    }
  };

  const closeFetchModelsModal = () => {
    authProbeGenerationRef.current += 1;
    setAuthProbeProgress(null);
    setFetchModelsModalOpen(false);
    setFetchModelsSearch("");
  };

  const makeModelVisible = (model: string) => {
    if (!model || current.models.includes(model)) return;
    updateField("models", [...current.models, model]);
  };

  const onRemoveModel = (model: string) => {
    setDraft((prev) => {
      const prevEntry = prev[active] ?? {
        apiKey: "",
        baseUrl: "",
        model: "",
        models: [],
        enabled: false,
        dropParams: false,
      };
      const nextModels = prevEntry.models.filter((m) => m !== model);
      let nextModel = prevEntry.model;
      if (nextModel === model || (nextModels.length > 0 && !nextModels.includes(nextModel))) {
        nextModel = nextModels[0] ?? "";
      }
      return {
        ...prev,
        [active]: normalizeProviderEntry({ ...prevEntry, models: nextModels, model: nextModel }),
      };
    });
  };

  /**
   * Drop an unauthorized model from the visible list and persist immediately so
   * chat pickers cannot keep selecting it if the user closes settings without Save.
   */
  const purgeUnauthorizedVisibleModel = async (model: string) => {
    let nextEntry: ProviderEntry | null = null;
    let didRemove = false;
    setDraft((prev) => {
      const prevEntry = prev[active] ?? {
        apiKey: "",
        baseUrl: "",
        model: "",
        models: [],
        enabled: false,
        dropParams: false,
      };
      if (!prevEntry.models.includes(model)) {
        return prev;
      }
      const nextModels = prevEntry.models.filter((m) => m !== model);
      let nextModel = prevEntry.model;
      if (nextModel === model || (nextModels.length > 0 && !nextModels.includes(nextModel))) {
        nextModel = nextModels[0] ?? "";
      }
      nextEntry = normalizeProviderEntry({ ...prevEntry, models: nextModels, model: nextModel });
      didRemove = true;
      return { ...prev, [active]: nextEntry };
    });
    if (!didRemove || !nextEntry) return;
    try {
      await window.agenticxDesktop.saveProvider({
        name: active,
        apiKey: nextEntry.apiKey || undefined,
        baseUrl: nextEntry.baseUrl || undefined,
        model: nextEntry.model || undefined,
        models: nextEntry.models,
        enabled: nextEntry.enabled,
        dropParams: nextEntry.dropParams,
        ...(nextEntry.displayName !== undefined
          ? { displayName: nextEntry.displayName.trim() }
          : {}),
        ...(nextEntry.interface === "openai" || nextEntry.interface === "ollama"
          ? { interface: nextEntry.interface }
          : {}),
      });
      const store = useAppStore.getState();
      store.updateSettings({
        providers: {
          ...store.settings.providers,
          [active]: nextEntry,
        },
      });
      setProviderSavedSnapshot((prev) => ({
        ...prev,
        [active]: { ...nextEntry! },
      }));
    } catch (err) {
      console.warn("[SettingsPanel] persist unauthorized model purge failed:", err);
    }
  };

  /**
   * Sequentially probes auth for catalog models. Marks "未授权" for add-blocking;
   * optionally purges models that were already visible but fail Model Auth.
   * Skips models already present in modelHealthMap. Cancellable via generation ref.
   */
  const runAuthProbeQueue = useCallback(
    async (
      provider: string,
      models: string[],
      apiKey: string,
      baseUrl: string | undefined,
      options?: { purgeVisibleUnauthorized?: boolean; visibleModels?: string[] },
    ) => {
      const generation = ++authProbeGenerationRef.current;
      const pending = models.filter((m) => !modelHealthMap[`${provider}:${m}`]);
      if (pending.length === 0) {
        setAuthProbeProgress(null);
        return;
      }
      const visibleSet = new Set(options?.visibleModels ?? []);
      setAuthProbeProgress({ done: 0, total: pending.length });
      for (let i = 0; i < pending.length; i += 1) {
        if (authProbeGenerationRef.current !== generation) return;
        const model = pending[i];
        const key = `${provider}:${model}`;
        setModelHealthMap((p) => (p[key] ? p : { ...p, [key]: { phase: "checking" } }));
        // Sequential avoids hammering the same endpoint in parallel.
        // eslint-disable-next-line no-await-in-loop
        const res = await window.agenticxDesktop.healthCheckModel({ provider, apiKey, baseUrl, model });
        if (authProbeGenerationRef.current !== generation) return;
        const health = healthEntryFromCheckResult(res);
        setModelHealthMap((p) => ({ ...p, [key]: health }));
        if (
          options?.purgeVisibleUnauthorized
          && health.phase === "unauthorized"
          && visibleSet.has(model)
        ) {
          // eslint-disable-next-line no-await-in-loop
          await purgeUnauthorizedVisibleModel(model);
        }
        setAuthProbeProgress({ done: i + 1, total: pending.length });
      }
      if (authProbeGenerationRef.current === generation) setAuthProbeProgress(null);
    },
    // purgeUnauthorizedVisibleModel closes over latest active/draft; omit from deps
    // to avoid re-creating the queue on every draft keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelHealthMap, active],
  );

  const onHealthCheck = async (model: string) => {
    const key = `${active}:${model}`;
    setModelHealthMap((p) => ({ ...p, [key]: { phase: "checking" } }));
    const res = await window.agenticxDesktop.healthCheckModel({
      provider: active,
      apiKey: current.apiKey,
      baseUrl: current.baseUrl || undefined,
      model,
    });
    const health = healthEntryFromCheckResult(res);
    setModelHealthMap((p) => ({
      ...p,
      [key]: health,
    }));
    // Historically "+" visible models may lose key permission later; drop them
    // from the visible list as soon as Model Auth denies the probe.
    if (health.phase === "unauthorized" && current.models.includes(model)) {
      await purgeUnauthorizedVisibleModel(model);
    }
  };

  const onBatchHealthCheck = async () => {
    if (!providerCredentialed(current) || current.models.length === 0) return;
    // Snapshot: purge mutates draft.models mid-loop.
    const modelsSnapshot = [...current.models];
    for (const m of modelsSnapshot) {
      const key = `${active}:${m}`;
      setModelHealthMap((p) => ({ ...p, [key]: { phase: "checking" } }));
      // Sequential avoids hammering the same endpoint in parallel.
      // eslint-disable-next-line no-await-in-loop
      const res = await window.agenticxDesktop.healthCheckModel({
        provider: active,
        apiKey: current.apiKey,
        baseUrl: current.baseUrl || undefined,
        model: m,
      });
      const health = healthEntryFromCheckResult(res);
      setModelHealthMap((p) => ({
        ...p,
        [key]: health,
      }));
      if (health.phase === "unauthorized") {
        // eslint-disable-next-line no-await-in-loop
        await purgeUnauthorizedVisibleModel(m);
      }
    }
  };

  const closeAddModelModal = () => {
    setAddModelModalOpen(false);
    setAddModelFormId("");
    setAddModelFormName("");
  };

  const submitAddModelFromModal = () => {
    const id = addModelFormId.trim();
    if (!id || current.models.includes(id)) return;
    updateField("models", [...current.models, id]);
    closeAddModelModal();
  };

  const closeAddServiceVendorModal = () => {
    setAddServiceVendorModalOpen(false);
    setAddVendorFormName("");
    setAddVendorFormType("openai");
  };

  const submitAddServiceVendorFromModal = () => {
    const name = addVendorFormName.trim();
    if (!name) return;
    const isOllama = addVendorFormType === "ollama";
    const id = isOllama
      ? makeCustomOllamaProviderId(name, Object.keys(draft))
      : makeCustomOpenAIProviderId(name, Object.keys(draft));
    setDraft((prev) => ({
      ...prev,
      [id]: {
        apiKey: "",
        baseUrl: "",
        model: "",
        models: [],
        enabled: false,
        dropParams: false,
        displayName: name,
        interface: addVendorFormType,
      },
    }));
    setActive(id);
    setAddServiceVendorModalOpen(false);
    setAddVendorFormName("");
    setProviderEnableHint(null);
    setDefaultProvHint(null);
  };

  const closeEditModelModal = () => {
    setEditModelModalOpen(false);
    setEditModelOriginalId("");
    setEditModelFormId("");
    setEditModelError(null);
  };

  const openEditModelModal = (modelId: string) => {
    setEditModelOriginalId(modelId);
    setEditModelFormId(modelId);
    setEditModelError(null);
    setEditModelModalOpen(true);
  };

  const submitEditModelFromModal = () => {
    const newId = editModelFormId.trim();
    const oldId = editModelOriginalId;
    if (!newId || !oldId) return;
    if (newId !== oldId && current.models.includes(newId)) {
      setEditModelError(t("provider.duplicateModelId"));
      return;
    }
    if (newId === oldId) {
      closeEditModelModal();
      return;
    }
    setEditModelError(null);
    setDraft((prev) => {
      const prevEntry = prev[active];
      if (!prevEntry) return prev;
      const nextModels = prevEntry.models.map((m) => (m === oldId ? newId : m));
      const next: ProviderEntry = {
        ...prevEntry,
        models: nextModels,
        model: prevEntry.model === oldId ? newId : prevEntry.model,
      };
      return { ...prev, [active]: next };
    });
    setModelHealthMap((p) => {
      const next = { ...p };
      delete next[`${active}:${oldId}`];
      delete next[`${active}:${newId}`];
      return next;
    });
    closeEditModelModal();
  };

  const beginInlineProviderRename = useCallback(
    (providerId: string) => {
      const entry = draft[providerId];
      if (!isProviderDisplayNameEditable(providerId, entry)) return;
      setActive(providerId);
      setInlineRenameProviderId(providerId);
      setInlineRenameValue(getProviderDisplayName(providerId, entry));
      setProviderEnableHint(null);
      setDefaultProvHint(null);
    },
    [draft],
  );

  const cancelInlineProviderRename = useCallback(() => {
    setInlineRenameProviderId(null);
    setInlineRenameValue("");
  }, []);

  const commitInlineProviderRename = useCallback(() => {
    const providerId = inlineRenameProviderId;
    if (!providerId) return;
    const trimmed = inlineRenameValue.trim();
    if (!trimmed) {
      cancelInlineProviderRename();
      return;
    }
    setDraft((prev) => {
      const prevEntry = prev[providerId];
      if (!prevEntry) return prev;
      return {
        ...prev,
        [providerId]: { ...prevEntry, displayName: trimmed },
      };
    });
    cancelInlineProviderRename();
  }, [inlineRenameProviderId, inlineRenameValue, cancelInlineProviderRename]);

  const confirmDeleteProvider = useCallback(async () => {
    const providerId = providerDeleteConfirmId?.trim();
    if (!providerId || providerDeleteBusy) return;
    setProviderDeleteBusy(true);
    try {
      await window.agenticxDesktop.deleteProvider(providerId);
      const remainingNames = providerNames.filter((n) => n !== providerId);
      const fallbackActive =
        remainingNames.find((n) => n !== providerId && providerCredentialed(draft[n])) ??
        remainingNames.find((n) => n !== providerId) ??
        ALL_PROVIDERS[0];
      let nextDefault = defProv;
      if (defProv === providerId) {
        nextDefault = fallbackActive;
        await window.agenticxDesktop.setDefaultProvider(nextDefault);
        setDefProv(nextDefault);
      }
      setDraft((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      setKeyStatus((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      setKeyError((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      setKeyWarning((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      setModelHealthMap((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${providerId}:`)) delete next[key];
        }
        return next;
      });
      cancelInlineProviderRename();
      setActive(fallbackActive);
      setProviderEnableHint(null);
      setDefaultProvHint(null);
      setProviderDeleteConfirmId(null);
      const nextProviders = { ...providers, ...draft };
      delete nextProviders[providerId];
      updateSettingsSlice({
        providers: nextProviders,
        ...(defProv === providerId ? { defaultProvider: nextDefault } : {}),
      });
    } catch {
      window.alert(t("provider.deleteVendorFailed"));
    } finally {
      setProviderDeleteBusy(false);
    }
  }, [
    cancelInlineProviderRename,
    defProv,
    draft,
    providerDeleteBusy,
    providerDeleteConfirmId,
    providerNames,
    providers,
    updateSettingsSlice,
  ]);

  const handleSave = async () => {
    try {
    const permRes = await securityTabRef.current?.flushPermissions?.();
    if (permRes && !permRes.ok) {
      const msg =
        permRes.error ||
        t("provider.permWriteFailedTitle");
      const still = window.confirm(
        t("provider.permWriteFailedBody", { msg }),
      );
      if (!still) return;
    }
    // ToolsTab stays mounted (hidden when inactive); always flush so tool_search /
    // runtime knobs persist even if the user left the Tools tab before Exit.
    {
      const toolsRes = await toolsTabRef.current?.saveAll();
      if (toolsRes && !toolsRes.ok) {
        window.alert(toolsRes.error || t("provider.toolsSaveFailed"));
        return;
      }
    }
    const kbRes = await knowledgeRef.current?.flushIfDirty();
    if (kbRes && !kbRes.ok) {
      const cont = window.confirm(
        t("provider.kbSaveFailed", { reason: kbRes.error ?? t("commonSettings.unknownError") }),
      );
      if (!cont) return;
    }
    const voiceRes = await voiceSettingsRef.current?.persist();
    if (voiceRes && !voiceRes.ok) {
      window.alert(voiceRes.error || t("provider.voiceSaveFailed"));
      return;
    }
    const normalized: Record<string, ProviderEntry> = {};
    for (const [name, entry] of Object.entries(draft)) {
      normalized[name] = normalizeProviderEntry({
        ...entry,
        baseUrl: normalizeProviderBaseUrlForSave(name, entry.baseUrl, entry),
      });
    }
    await onSave({ defaultProvider: defProv, providers: normalized });
    const remoteSave = await window.agenticxDesktop.saveRemoteServer({
      enabled: serverMode === "remote",
      url: serverUrl.trim().replace(/\/+$/, ""),
      token: serverToken.trim(),
    });
    await window.agenticxDesktop.saveGatewayIm({
      enabled: gwEnabled,
      url: gwUrl.trim().replace(/\/+$/, ""),
      deviceId: gwDeviceId.trim(),
      token: gwToken.trim(),
      studioBaseUrl: gwStudioBase.trim().replace(/\/+$/, ""),
    });
    await window.agenticxDesktop.saveFeishuConfig({
      enabled: feishuEnabled,
      appId: feishuAppId.trim(),
      appSecret: feishuAppSecret.trim(),
    });
    if (remoteSave.mode_changed) {
      const restartDlg = await window.agenticxDesktop.confirmDialog({
        title: t("server.modeSwitchTitle"),
        message: t("server.modeSwitchBody"),
        detail:
          t("server.modeSwitchDetail"),
        confirmText: t("commonSettings.restartNow"),
        cancelText: t("commonSettings.restartLater"),
      });
      if (restartDlg.confirmed) {
        await window.agenticxDesktop.appRelaunch();
        return;
      }
      await window.agenticxDesktop.confirmDialog({
        title: t("commonSettings.pleaseRestartLaterTitle"),
        message: t("commonSettings.pleaseRestartLaterBody"),
        confirmText: t("commonSettings.gotIt"),
      });
      onClose();
      return;
    }
    onClose();
    } catch (err) {
      window.alert(t("commonSettings.saveSettingsFailed", { reason: err instanceof Error ? err.message : String(err) }));
    }
  };

  const runMcpToggleRequest = useCallback(async (name: string, next: boolean) => {
    if (!sessionId) return;
    setMcpMessage("");
    const actionLabel = next ? t("mcp.connect") : t("mcp.disconnect");
    try {
      const result = next
        ? await window.agenticxDesktop.connectMcp({ sessionId, name })
        : await window.agenticxDesktop.disconnectMcp({ sessionId, name });
      if (result.ok) {
        await onRefreshMcp(sessionId);
        setMcpMessage(next ? t("mcp.connectedAuto", { name }) : t("mcp.disconnectedNoAuto", { name }));
      } else {
        const detail = String(result.error ?? t("commonSettings.unknownError"));
        if (detail.includes("连接已取消")) return;
        try {
          await onRefreshMcp(sessionId);
        } catch {
          // best-effort refresh
        }
        setMcpMessage(t("mcp.actionFailed", { action: actionLabel, detail }));
      }
    } catch (err) {
      const detail = String(err);
      if (detail.includes("连接已取消")) return;
      try {
        await onRefreshMcp(sessionId);
      } catch {
        // best-effort refresh
      }
      setMcpMessage(t("mcp.actionFailed", { action: actionLabel, detail }));
    }
  }, [onRefreshMcp, sessionId]);

  const handleToggleMcpTool = useCallback(
    (serverName: string, toolName: string, currentlyDisabled: boolean) => {
      setMcpDisabledTools((prev) => {
        const current = new Set(prev[serverName] ?? []);
        if (currentlyDisabled) {
          current.delete(toolName);
        } else {
          current.add(toolName);
        }
        const nextMap = { ...prev };
        if (current.size === 0) {
          delete nextMap[serverName];
        } else {
          nextMap[serverName] = Array.from(current);
        }
        void window.agenticxDesktop
          .putMcpSettings({ extraSearchPaths: mcpExtraPaths, disabledTools: nextMap })
          .catch(() => {
            // best-effort persist
          });
        return nextMap;
      });
    },
    [mcpExtraPaths],
  );

  const handleToggleMcp = useCallback((name: string, next: boolean) => {
    if (!sessionId) return;
    setMcpOptimisticChecked((prev) => ({ ...prev, [name]: next }));
    if (mcpServerInFlightRef.current[name]) {
      mcpQueuedToggleRef.current[name] = next;
      if (!next) {
        // 连接中立即关闭：立刻发起断开，触发后端对 in-flight connect 的取消。
        void window.agenticxDesktop
          .disconnectMcp({ sessionId, name })
          .then(async (result) => {
            if (!result?.ok) return;
            try {
              await onRefreshMcp(sessionId);
            } catch {
              // best-effort refresh
            }
          })
          .catch(() => {
            // best-effort cancel
          });
      }
      return;
    }
    mcpServerInFlightRef.current[name] = true;
    setMcpServerBusy((prev) => ({ ...prev, [name]: true }));
    const runLoop = async () => {
      let desired = next;
      while (true) {
        delete mcpQueuedToggleRef.current[name];
        await runMcpToggleRequest(name, desired);
        const queued = mcpQueuedToggleRef.current[name];
        if (typeof queued !== "boolean" || queued === desired) break;
        desired = queued;
        setMcpOptimisticChecked((prev) => ({ ...prev, [name]: desired }));
      }
    };
    void runLoop().finally(() => {
      mcpServerInFlightRef.current[name] = false;
      delete mcpQueuedToggleRef.current[name];
      setMcpServerBusy((prev) => ({ ...prev, [name]: false }));
      setMcpOptimisticChecked((prev) => {
        const nextState = { ...prev };
        delete nextState[name];
        return nextState;
      });
    });
  }, [runMcpToggleRequest, sessionId]);

  const refreshMcpDiscover = useCallback(async () => {
    setMcpDiscoverLoading(true);
    setMcpMessage("");
    const start = Date.now();
    try {
      const res = await window.agenticxDesktop.mcpDiscover();
      if (res?.ok && Array.isArray(res.hits)) {
        setMcpDiscoverHits(res.hits as MCPDiscoveryHit[]);
      } else {
        setMcpMessage(t("mcp.scanFailed", { reason: res?.error ?? t("commonSettings.unknownError") }));
      }
    } catch (err) {
      setMcpMessage(t("mcp.scanFailed", { reason: String(err) }));
    } finally {
      const elapsed = Date.now() - start;
      const MIN_MS = 800;
      if (elapsed < MIN_MS) {
        await new Promise((r) => setTimeout(r, MIN_MS - elapsed));
      }
      setMcpDiscoverLoading(false);
    }
  }, []);

  const extractMarketplaceMcpServerNames = useCallback((item: Record<string, unknown> | undefined): string[] => {
    const serverConfig = item?.server_config as unknown;
    if (!Array.isArray(serverConfig) || serverConfig.length === 0) return [];
    const names: string[] = [];
    for (const cfg of serverConfig) {
      if (!cfg || typeof cfg !== "object") continue;
      const mcpServers = (cfg as { mcpServers?: unknown }).mcpServers;
      if (!mcpServers || typeof mcpServers !== "object") continue;
      for (const key of Object.keys(mcpServers as Record<string, unknown>)) {
        if (key.trim()) names.push(key.trim());
      }
    }
    return Array.from(new Set(names));
  }, []);

  const updateMarketplaceIdMapping = useCallback((serverId: string, names: string[]) => {
    if (!serverId || names.length === 0) return;
    setMcpMarketplaceIdToNames((prev) => {
      const existing = prev[serverId] ?? [];
      const merged = Array.from(new Set([...existing, ...names]));
      if (
        merged.length === existing.length &&
        merged.every((n, i) => n === existing[i])
      ) {
        return prev;
      }
      return { ...prev, [serverId]: merged };
    });
  }, []);

  const refreshMcpMarketplace = useCallback(async () => {
    const requestSeq = ++mcpMarketplaceRequestSeqRef.current;
    const isStale = () => requestSeq !== mcpMarketplaceRequestSeqRef.current;
    setMcpMarketplaceLoading(true);
    setMcpMessage("");
    setMcpMarketplaceSummary("");
    try {
      const keyword = mcpMarketplaceSearch.trim();
      const hasKeyword = keyword.length > 0;
      const pageSize = hasKeyword ? 100 : 20;
      const res = await window.agenticxDesktop.mcpMarketplaceList({
        search: keyword,
        page: 1,
        pageSize,
      });
      if (isStale()) return;
      if (res?.ok && Array.isArray(res.items)) {
        let rawItems = res.items as Array<Record<string, unknown>>;
        const totalCount = Number(res.total_count ?? rawItems.length);
        if (hasKeyword && totalCount > rawItems.length) {
          const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
          const pagePromises: Array<Promise<{ ok: boolean; items?: Array<Record<string, unknown>> }>> = [];
          for (let page = 2; page <= totalPages; page += 1) {
            pagePromises.push(
              window.agenticxDesktop.mcpMarketplaceList({
                search: keyword,
                page,
                pageSize,
              }),
            );
          }
          const pageResults = await Promise.all(pagePromises);
          if (isStale()) return;
          for (const pageRes of pageResults) {
            if (pageRes?.ok && Array.isArray(pageRes.items)) {
              rawItems = rawItems.concat(pageRes.items as Array<Record<string, unknown>>);
            }
          }
        }
        const dedupedMap = new Map<string, Record<string, unknown>>();
        for (const item of rawItems) {
          const id = String((item as { id?: unknown }).id ?? "").trim();
          if (!id) continue;
          if (!dedupedMap.has(id)) dedupedMap.set(id, item);
        }
        const dedupedItems = Array.from(dedupedMap.values());
        const enriched = await Promise.all(
          dedupedItems.map(async (raw) => {
            const id = String((raw as { id?: unknown }).id ?? "").trim();
            if (!id) return raw;
            try {
              const detail = await window.agenticxDesktop.mcpMarketplaceDetail({ serverId: id });
              const detailItem = (detail?.item as Record<string, unknown> | undefined) ?? undefined;
              const names = extractMarketplaceMcpServerNames(detailItem);
              if (names.length > 0) updateMarketplaceIdMapping(id, names);
              return {
                ...raw,
                ...(detailItem ?? {}),
              } as Record<string, unknown>;
            } catch {
              return raw;
            }
          }),
        );
        if (isStale()) return;
        if (hasKeyword) {
          setMcpMarketplaceItems(enriched);
          setMcpMarketplaceSummary(t("mcp.listedAll", { total: totalCount }));
          return;
        }
        const filtered = enriched.filter((item) => {
          const isVerified = Boolean(item.is_verified);
          const isHosted = Boolean(item.is_hosted);
          const names = extractMarketplaceMcpServerNames(item);
          return isVerified && isHosted && names.length > 0;
        });
        setMcpMarketplaceItems(filtered);
        setMcpMarketplaceSummary(
          t("mcp.listedFiltered", { total: totalCount, filtered: filtered.length }),
        );
        if (totalCount > filtered.length) {
          setMcpMessage(t("mcp.filteredOut", { count: totalCount - filtered.length }));
        }
      } else {
        setMcpMessage(t("mcp.marketLoadFailed", { reason: res?.error ?? t("commonSettings.unknownError") }));
      }
    } catch (err) {
      setMcpMessage(t("mcp.marketLoadFailed", { reason: String(err) }));
    } finally {
      if (!isStale()) {
        setMcpMarketplaceLoading(false);
      }
    }
  }, [extractMarketplaceMcpServerNames, mcpMarketplaceSearch, updateMarketplaceIdMapping]);

  const handleInstallMarketplaceMcp = useCallback(
    async (serverId: string, env: Record<string, string>) => {
      setMcpMarketplaceInstallBusy(true);
      setMcpMarketplaceInstallingId(serverId);
      setMcpMarketplaceStatus({ message: t("mcp.installingNamed", { id: serverId }), kind: "info", serverId });
      setMcpMessage("");
      try {
        const detail = await window.agenticxDesktop.mcpMarketplaceDetail({ serverId });
        const requiredRaw = (detail?.item as { env_schema?: { required?: unknown } } | undefined)?.env_schema?.required;
        const required = (Array.isArray(requiredRaw) ? requiredRaw : []).filter(
          (x): x is string => typeof x === "string",
        );
        setMcpMarketplaceEnvSchema({ required });

        const res = await window.agenticxDesktop.mcpMarketplaceInstall({ serverId, env });
        if (!res.ok) {
          const errMsg = t("mcp.installFailedReason", { reason: res.error ?? t("commonSettings.unknownError") });
          setMcpMessage(errMsg);
          setMcpMarketplaceStatus({ message: errMsg, kind: "error", serverId });
          return;
        }
        const installedNames = [...(res.installed ?? []), ...(res.updated ?? [])];
        const installedLabel = installedNames.join("、") || serverId;
        const okMsg = t("mcp.installOk", { label: installedLabel });
        setMcpMessage(okMsg);
        setMcpMarketplaceStatus({ message: okMsg, kind: "success", serverId });
        setMcpMarketplaceInstalledIds((prev) => new Set([...prev, serverId]));
        if (installedNames.length > 0) {
          updateMarketplaceIdMapping(serverId, installedNames);
        }
        if (sessionId) await onRefreshMcp(sessionId);
        await refreshMcpDiscover();
      } catch (err) {
        const errMsg = t("mcp.installFailedReason", { reason: String(err) });
        setMcpMessage(errMsg);
        setMcpMarketplaceStatus({ message: errMsg, kind: "error", serverId });
      } finally {
        setMcpMarketplaceInstallBusy(false);
        setMcpMarketplaceInstallingId(null);
      }
    },
    [onRefreshMcp, refreshMcpDiscover, sessionId, updateMarketplaceIdMapping],
  );

  useEffect(() => {
    if (!mcpMarketplaceStatus || mcpMarketplaceStatus.kind !== "success") return;
    const timer = window.setTimeout(() => setMcpMarketplaceStatus(null), 4000);
    return () => window.clearTimeout(timer);
  }, [mcpMarketplaceStatus]);

  useEffect(() => {
    writeScopedLocalStorage(MCP_MARKETPLACE_ID_MAP_KEY, JSON.stringify(mcpMarketplaceIdToNames));
  }, [mcpMarketplaceIdToNames]);

  useEffect(() => {
    if (!open || tab !== "mcp") return;
    if (mcpMarketplaceItems.length === 0) return;
    const installedServerNames = new Set(mcpServers.map((s) => s.name));
    if (installedServerNames.size === 0) return;
    const resolveDetail = async (serverId: string) => {
      if (!serverId) return;
      if (mcpMarketplaceIdToNames[serverId]) return;
      if (mcpMarketplaceDetailInFlightRef.current.has(serverId)) return;
      mcpMarketplaceDetailInFlightRef.current.add(serverId);
      try {
        const detail = await window.agenticxDesktop.mcpMarketplaceDetail({ serverId });
        const names = extractMarketplaceMcpServerNames(detail?.item as Record<string, unknown> | undefined);
        if (names.length === 0) return;
        updateMarketplaceIdMapping(serverId, names);
      } catch {
        // best-effort; skip this item
      } finally {
        mcpMarketplaceDetailInFlightRef.current.delete(serverId);
      }
    };
    for (const raw of mcpMarketplaceItems) {
      const id = String((raw as { id?: unknown }).id ?? "").trim();
      if (!id) continue;
      if (mcpMarketplaceIdToNames[id]) continue;
      void resolveDetail(id);
    }
  }, [open, tab, mcpMarketplaceItems, mcpServers, mcpMarketplaceIdToNames, extractMarketplaceMcpServerNames, updateMarketplaceIdMapping]);

  const mcpEditorFilePaths = useMemo(
    () => [MCP_PRIMARY_CONFIG_PATH, ...mcpExtraPaths.filter(Boolean)],
    [mcpExtraPaths],
  );

  const locateMcpServerPath = useCallback(async (serverName: string): Promise<string> => {
    for (const path of mcpEditorFilePaths) {
      try {
        const result = await window.agenticxDesktop.mcpGetRaw({ path });
        if (!result?.ok || typeof result.text !== "string") continue;
        const text = result.text;
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
          const nested = parsed.mcpServers;
          if (
            nested &&
            typeof nested === "object" &&
            !Array.isArray(nested) &&
            Object.prototype.hasOwnProperty.call(nested, serverName)
          ) {
            return path;
          }
          if (Object.prototype.hasOwnProperty.call(parsed, serverName)) {
            return path;
          }
        } catch {
          if (text.includes(`"${serverName}"`)) return path;
        }
      } catch {
        // keep scanning
      }
    }
    return MCP_PRIMARY_CONFIG_PATH;
  }, [mcpEditorFilePaths]);

  const openMcpEditor = useCallback((path: string, focusServerName?: string) => {
    setMcpEditorPath(path);
    setMcpEditorFocusServerName(focusServerName);
    setMcpEditorFocusToken((prev) => prev + 1);
    setMcpEditorOpen(true);
  }, []);

  const openMcpEditorForServer = useCallback(async (serverName: string) => {
    const path = await locateMcpServerPath(serverName);
    openMcpEditor(path, serverName);
  }, [locateMcpServerPath, openMcpEditor]);

  const handleDeleteMcpServer = useCallback(async (serverName: string) => {
    const name = serverName.trim();
    if (!name) return;
    setMcpServerBusy((prev) => ({ ...prev, [name]: true }));
    setMcpMessage("");
    try {
      const path = await locateMcpServerPath(name);
      const raw = await window.agenticxDesktop.mcpGetRaw({ path });
      if (!raw?.ok || typeof raw.text !== "string") {
        setMcpMessage(t("mcp.deleteReadFailed", { path }));
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw.text) as Record<string, unknown>;
      } catch (err) {
        setMcpMessage(t("mcp.deleteBadJson", { reason: String(err) }));
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setMcpMessage(t("mcp.deleteBadStruct", { path }));
        return;
      }
      let changed = false;
      const nested = parsed.mcpServers;
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const mcpServersObj = nested as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(mcpServersObj, name)) {
          delete mcpServersObj[name];
          changed = true;
        }
      }
      if (
        !changed &&
        name !== "mcpServers" &&
        Object.prototype.hasOwnProperty.call(parsed, name)
      ) {
        delete parsed[name];
        changed = true;
      }
      if (!changed) {
        setMcpMessage(t("mcp.notInFile", { path, name }));
        return;
      }
      const isDefaultEntry = new Set(mcpDefaultEntryNames).has(name);
      let skipAddedForThisDelete = false;
      let rollbackSkipNames = [...mcpSkipDefaultNames];
      if (isDefaultEntry) {
        let baseSkipNames = [...mcpSkipDefaultNames];
        const latestSettings = await window.agenticxDesktop.getMcpSettings().catch(() => null);
        if (latestSettings?.ok && Array.isArray(latestSettings.skip_default_names)) {
          baseSkipNames = latestSettings.skip_default_names.map((x) => String(x).trim()).filter(Boolean);
          setMcpSkipDefaultNames(baseSkipNames);
        }
        const baseSkipSet = new Set(baseSkipNames);
        const hadSkipAlready = baseSkipSet.has(name);
        const nextSkipNames = hadSkipAlready ? [...baseSkipNames] : [...baseSkipNames, name];
        rollbackSkipNames = [...baseSkipNames];
        const skipPersist = await window.agenticxDesktop.putMcpSettings({
          extraSearchPaths: mcpExtraPaths,
          skipDefaultNames: nextSkipNames,
        });
        if (!skipPersist?.ok) {
          setMcpMessage(t("mcp.deleteSkipFailed", { reason: skipPersist?.error ?? t("commonSettings.unknownError") }));
          return;
        }
        setMcpSkipDefaultNames(nextSkipNames);
        skipAddedForThisDelete = !hadSkipAlready;
      }
      const save = await window.agenticxDesktop.mcpPutRaw({
        path,
        text: `${JSON.stringify(parsed, null, 2)}\n`,
      });
      if (!save?.ok) {
        if (skipAddedForThisDelete) {
          const rollback = await window.agenticxDesktop.putMcpSettings({
            extraSearchPaths: mcpExtraPaths,
            skipDefaultNames: rollbackSkipNames,
          });
          if (rollback?.ok) {
            setMcpSkipDefaultNames(rollbackSkipNames);
          }
        }
        setMcpMessage(t("mcp.deleteFailed", { reason: save?.error ?? t("commonSettings.saveFailed") }));
        return;
      }
      setMcpMessage(t("mcp.deleted", { name }));
      setMcpExpandedServers((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      if (sessionId) await onRefreshMcp(sessionId);
      await refreshMcpDiscover();
    } catch (err) {
      setMcpMessage(t("mcp.deleteFailed", { reason: String(err) }));
    } finally {
      setMcpServerBusy((prev) => ({ ...prev, [name]: false }));
    }
  }, [locateMcpServerPath, mcpDefaultEntryNames, mcpExtraPaths, mcpSkipDefaultNames, onRefreshMcp, refreshMcpDiscover, sessionId]);

  const confirmDeleteMcpServer = useCallback(() => {
    const name = mcpDeleteConfirmServerName?.trim();
    if (!name) return;
    setMcpDeleteConfirmServerName(null);
    void handleDeleteMcpServer(name);
  }, [handleDeleteMcpServer, mcpDeleteConfirmServerName]);

  const mcpMarketplaceAllInstalledIds = useMemo(() => {
    const serverNames = new Set(mcpServers.map((s) => s.name));
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const normalizedServerNames = new Set<string>();
    for (const n of serverNames) {
      const nn = normalize(n);
      if (nn) normalizedServerNames.add(nn);
    }
    const installed = new Set<string>(mcpMarketplaceInstalledIds);
    for (const raw of mcpMarketplaceItems) {
      const id = String((raw as { id?: unknown }).id ?? "").trim();
      if (!id || installed.has(id)) continue;
      const mapped = mcpMarketplaceIdToNames[id];
      if (mapped && mapped.some((n) => serverNames.has(n))) {
        installed.add(id);
        continue;
      }
      const candidates = [
        id,
        id.split("/").pop() ?? "",
        String((raw as { name?: unknown }).name ?? ""),
        String((raw as { chinese_name?: unknown }).chinese_name ?? ""),
      ]
        .map(normalize)
        .filter(Boolean);
      if (candidates.some((c) => normalizedServerNames.has(c))) {
        installed.add(id);
      }
    }
    return installed;
  }, [mcpServers, mcpMarketplaceInstalledIds, mcpMarketplaceItems, mcpMarketplaceIdToNames]);

  useEffect(() => {
    if (!open || tab !== "mcp") return;
    if (capabilityLocks.allowMcpAutoDiscovery && mcpDiscoverHits.length === 0) {
      void refreshMcpDiscover();
    }
    if (mcpMarketplaceItems.length === 0) {
      void refreshMcpMarketplace();
    }
  }, [open, tab, capabilityLocks.allowMcpAutoDiscovery, mcpDiscoverHits.length, mcpMarketplaceItems.length, refreshMcpDiscover, refreshMcpMarketplace]);

  useEffect(() => {
    if (!open || tab !== "mcp") return;
    // sessionId may be empty (no session yet); backend falls back to
    // process-level configs in that case, so we still poll.
    void onRefreshMcp(sessionId);
    const timer = window.setInterval(() => {
      void onRefreshMcp(sessionId);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [onRefreshMcp, open, sessionId, tab]);

  if (!open) return null;

  const ks = keyStatus[active] ?? "idle";

  return (
    <>
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-none">
      {/* 默认更宽；右下角可拖拽调整尺寸并持久化，切换 tab 时尺寸不变 */}
      <div
        className="agx-settings-panel relative flex shrink-0 overflow-hidden rounded-2xl border border-border shadow-2xl"
        style={{
          width: panelSize.width,
          height: panelSize.height,
          backgroundColor: "var(--surface-base-fallback, var(--surface-panel))",
        }}
      >
        {/* Left: tab navigation */}
        <div
          className="relative flex h-full min-h-0 shrink-0 flex-col bg-surface-sidebar py-4 pl-4 pr-0"
          style={{ width: navWidth }}
        >
          <div className="mb-4 pr-2 text-[15px] font-semibold text-text-strong">{t("title")}</div>
          <nav className="agx-settings-nav-scroll flex flex-1 flex-col gap-1 overflow-y-auto">
            {tabs.map((item) => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  className={`flex w-full min-w-0 items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left ${SETTINGS_NAV_ITEM_CLASS} transition-all ${
                    isActive
                      ? "border-transparent bg-btnPrimary text-btnPrimary-text"
                      : "border-transparent text-text-primary hover:bg-surface-card hover:text-text-strong"
                  }`}
                  onClick={() => setTab(item.id)}
                  title={item.label}
                >
                  {Icon ? (
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-sm bg-surface-hover" aria-hidden />
                  )}
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div
            className="group absolute right-0 top-0 z-20 h-full w-3 cursor-col-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("navResize")}
            title={t("navResize")}
            onMouseDown={onNavResizeMouseDown}
          >
            <div className="absolute inset-y-0 right-0 w-px bg-[var(--ui-accent-divider)] transition-all duration-200 group-hover:w-[2px] group-hover:bg-[var(--ui-btn-primary-bg)]" />
          </div>
        </div>

        {/* Right: content */}
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-panel pl-5 pr-5 py-3">
            <h3 className={`min-w-0 flex-1 truncate ${SETTINGS_PAGE_TITLE_CLASS}`}>
              {tabs.find((item) => item.id === tab)?.label ?? t("title")}
            </h3>
            <button
              type="button"
              aria-label={tCommon("close")}
              className="no-drag inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-text-faint transition hover:border-border-strong hover:bg-surface-card hover:text-text-strong"
              onClick={onClose}
            >
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          </div>

          <div
            className={`min-h-0 flex-1 pl-5 pr-4 ${
              tab === "provider"
                ? "flex flex-col overflow-hidden pt-4 pb-3"
                : tab === "knowledge"
                  ? "flex flex-col overflow-hidden py-3"
                  : "overflow-y-auto py-3"
            }`}
          >
            {tab === "account" && <AccountTab />}

            {/* === GENERAL TAB ===（保持挂载以便底部「保存」能刷入权限 API，避免仅失焦写入） */}
            <div className={tab === "general" ? "space-y-4" : "hidden"}>
                <Panel title={t("display.title")}>
                  <div className="flex flex-col">
                    <div className="flex min-h-14 items-center justify-between gap-6 py-1">
                      <div>
                        <div className={SETTINGS_LABEL_CLASS}>{t("display.language")}</div>
                        <div className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t("display.languageHint")}</div>
                      </div>
                      {(() => {
                        const options = [
                          { value: "zh", label: t("display.languageZh") },
                          { value: "en", label: t("display.languageEn") },
                        ] as const;
                        return (
                          <SettingsDropdown
                            value={locale}
                            displayLabel={options.find((option) => option.value === locale)?.label ?? locale}
                            options={options}
                            onChange={(next) => setLocale(next as AppLocale)}
                            className="w-40 shrink-0"
                            size="compact"
                            menuPortal
                          />
                        );
                      })()}
                    </div>

                    <div className="h-px bg-[var(--border-muted)]" aria-hidden="true" />

                    <div className="flex min-h-14 items-center justify-between gap-6 py-1">
                      <div>
                        <div className={SETTINGS_LABEL_CLASS}>{t("display.appearance")}</div>
                        <div className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t("display.appearanceHint")}</div>
                      </div>
                      {(() => {
                        const options = [
                          { value: "light", label: t("display.themeLight") },
                          { value: "dim", label: t("display.themeDim") },
                          { value: "dark", label: t("display.themeDark") },
                        ] as const;
                        return (
                          <SettingsDropdown
                            value={theme}
                            displayLabel={options.find((option) => option.value === theme)?.label ?? theme}
                            options={options}
                            onChange={(next) => onThemeChange(next as "dark" | "light" | "dim")}
                            className="w-40 shrink-0"
                            size="compact"
                            menuPortal
                          />
                        );
                      })()}
                    </div>

                    <div className="h-px bg-[var(--border-muted)]" aria-hidden="true" />

                    <div className="flex min-h-14 items-center justify-between gap-6 py-1">
                      <div>
                        <div className={SETTINGS_LABEL_CLASS}>{t("display.messageLayout")}</div>
                        <div className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t("display.messageLayoutHint")}</div>
                      </div>
                      {(() => {
                        const options = [
                          { value: "im", label: t("display.layoutIm") },
                          { value: "terminal", label: t("display.layoutTerminal") },
                          { value: "clean", label: t("display.layoutClean") },
                        ] as const;
                        return (
                          <SettingsDropdown
                            value={chatStyle}
                            displayLabel={options.find((option) => option.value === chatStyle)?.label ?? chatStyle}
                            options={options}
                            onChange={(next) => onChatStyleChange(next as ChatStyle)}
                            className="w-40 shrink-0"
                            size="compact"
                            menuPortal
                          />
                        );
                      })()}
                    </div>

                    <div className="h-px bg-[var(--border-muted)]" aria-hidden="true" />

                    <div className="flex min-h-14 items-center justify-between gap-6 py-1">
                      <div>
                        <div className={SETTINGS_LABEL_CLASS}>{t("display.accent")}</div>
                        <div className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t("display.accentHint")}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {[
                          { id: "blue", color: "bg-blue-500", label: t("display.accentBlue") },
                          { id: "green", color: "bg-emerald-500", label: t("display.accentGreen") },
                          { id: "pink", color: "bg-pink-500", label: t("display.accentPink") },
                          { id: "yellow", color: "bg-amber-500", label: t("display.accentYellow") },
                          {
                            id: "white",
                            color: theme === "light" ? "bg-slate-900" : "bg-white",
                            label: t("display.accentMono"),
                          },
                        ].map((color) => {
                          const selected = themeColor === color.id;
                          return (
                            <button
                              key={color.id}
                              type="button"
                              className={`flex h-7 w-7 items-center justify-center rounded-full border transition-transform active:scale-95 ${
                                selected
                                  ? "border-text-primary bg-surface-panel shadow-sm"
                                  : "border-transparent hover:bg-surface-hover"
                              }`}
                              onClick={() =>
                                setThemeColor(color.id as "blue" | "green" | "pink" | "yellow" | "white")
                              }
                              aria-label={color.label}
                              aria-pressed={selected}
                            >
                              <span className={`h-4 w-4 rounded-full ${color.color}`} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </Panel>
                <Panel title={t("profile.title")}>
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      {userAvatarUrl ? (
                        <img
                          src={userAvatarUrl}
                          alt={t("profile.myAvatar")}
                          className="h-12 w-12 rounded-full border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(var(--theme-color-rgb),0.9)] text-base font-semibold text-[var(--theme-color-text)]">
                          {(userNicknameDraft.trim().slice(0, 1) || t("profile.me")).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate ${SETTINGS_LABEL_CLASS}`}>
                        {userNicknameDraft.trim() || t("profile.me")}
                      </div>
                      <p className={`mt-0.5 line-clamp-2 ${SETTINGS_HINT_CLASS}`}>
                        {userPreferenceDraft.trim() || t("profile.prefUnset")}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-panel px-3 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary active:scale-[0.98]"
                      onClick={() => setUserProfileEditing((editing) => !editing)}
                    >
                      <SquarePen className="h-3.5 w-3.5" />
                      {userProfileEditing ? t("commonSettings.collapse") : tCommon("edit")}
                    </button>
                  </div>

                  {userProfileEditing ? (
                    <div className="mt-4 border-t border-[var(--border-muted)] pt-4">
                      <div className="mb-4 flex items-center gap-3">
                        <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-surface-panel px-3 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary">
                          {t("profile.changeAvatar")}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) handleProfileAvatarUpload(file);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {userAvatarUrl ? (
                          <button
                            type="button"
                            className="text-xs text-text-faint transition-colors hover:text-text-muted"
                            onClick={() => {
                              setUserAvatarUrl("");
                              setUserAvatarMessage(t("profile.resetDefaultDone"));
                            }}
                          >
                            {t("profile.resetDefault")}
                          </button>
                        ) : null}
                        {userAvatarMessage ? (
                          <span className="text-[11px] text-text-faint">{userAvatarMessage}</span>
                        ) : null}
                      </div>

                      <div className="space-y-4">
                      <div>
                        <div className="mb-1.5 text-xs font-medium text-text-muted">{t("profile.nickname")}</div>
                        <input
                          type="text"
                          className="w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:border-[rgba(var(--theme-color-rgb),0.5)] focus:outline-none focus:ring-1 focus:ring-[rgba(var(--theme-color-rgb),0.5)] transition-shadow"
                          value={userNicknameDraft}
                          onChange={(e) => {
                            setUserNicknameDraft(e.target.value);
                            setUserProfileMessage("");
                          }}
                          placeholder={t("profile.nicknamePlaceholder")}
                          maxLength={48}
                        />
                      </div>

                      <div>
                        <div className="mb-1.5 text-xs font-medium text-text-muted">{t("profile.preference")}</div>
                        <textarea
                          className="w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:border-[rgba(var(--theme-color-rgb),0.5)] focus:outline-none focus:ring-1 focus:ring-[rgba(var(--theme-color-rgb),0.5)] transition-shadow"
                          rows={3}
                          value={userPreferenceDraft}
                          onChange={(e) => {
                            setUserPreferenceDraft(e.target.value);
                            setUserProfileMessage("");
                          }}
                          placeholder={t("profile.preferencePlaceholder")}
                          maxLength={500}
                        />
                        <div className="mt-1.5 flex items-start justify-between gap-3">
                          <span className="text-[11px] text-text-faint">{userPreferenceDraft.length}/500</span>
                          <div className="flex shrink-0 items-center gap-2">
                            {userProfileMessage ? (
                              <span
                                className={`max-w-[180px] text-right text-[11px] leading-snug ${
                                  userProfileMessage.startsWith(t("profile.saved")) || userProfileMessage.startsWith(t("profile.aiDonePrefix"))
                                    ? "text-text-subtle"
                                    : "text-rose-400"
                                }`}
                              >
                                {userProfileMessage}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              disabled={aiAssistLoading === "preference"}
                              className="flex items-center gap-1 text-xs text-[rgba(var(--theme-color-rgb),0.85)] transition-opacity hover:opacity-80 disabled:opacity-40"
                              onClick={() => void callAiAssist("preference")}
                            >
                              {aiAssistLoading === "preference" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3" />
                              )}
                              {aiAssistLoading === "preference" ? t("profile.generating") : (userPreferenceDraft.trim() ? t("profile.aiPolish") : t("profile.aiGenerate"))}
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-btnPrimary px-4 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
                              disabled={!userProfileDirty}
                              onClick={saveUserProfile}
                            >
                              {tCommon("save")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    </div>
                  ) : null}
                </Panel>
                <Panel title={t("meta.title")}>
                  <p className={SETTINGS_INTRO_CLASS}>
                    {t("meta.intro")}
                  </p>

                  <div className="mt-4 overflow-hidden rounded-lg border border-[var(--border-subtle)]">
                    {[
                      {
                        kind: "identity" as const,
                        title: t("meta.identity"),
                        description: t("meta.identityHint"),
                        preview: metaIdentity,
                      },
                      {
                        kind: "soul" as const,
                        title: t("meta.soul"),
                        description: t("meta.soulHint"),
                        preview: metaSoul,
                      },
                    ].map((item, index) => {
                      const open = metaEditorKind === item.kind;
                      const preview =
                        item.preview
                          .split("\n")
                          .map((line) => line.replace(/^#+\s*/, "").trim())
                          .find(Boolean) || t("meta.unset");
                      return (
                        <div
                          key={item.kind}
                          className={index > 0 ? "border-t border-[var(--border-muted)]" : ""}
                        >
                          <button
                            type="button"
                            className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors ${
                              open ? "bg-surface-hover/80" : "bg-surface-panel/45 hover:bg-surface-hover"
                            }`}
                            onClick={() => setMetaEditorKind(open ? null : item.kind)}
                            aria-expanded={open}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-hover text-text-muted">
                              {item.kind === "identity" ? (
                                <User className="h-4 w-4" />
                              ) : (
                                <Compass className="h-4 w-4" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={SETTINGS_LABEL_CLASS}>{item.title}</div>
                              <div className={`mt-0.5 truncate ${SETTINGS_HINT_CLASS}`} title={preview}>
                                {item.description}
                              </div>
                            </div>
                            <span className="hidden max-w-[32%] truncate text-[11px] text-text-faint md:block">
                              {preview}
                            </span>
                            <ChevronRight
                              className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${
                                open ? "rotate-90" : ""
                              }`}
                            />
                          </button>

                          {open ? (
                            <div className="border-t border-[var(--border-muted)] bg-surface-hover/30 px-3 pb-3 pt-2.5">
                              {item.kind === "identity" ? (
                                <MetaMarkdownField
                                  label={t("meta.identity")}
                                  showLabel={false}
                                  value={metaIdentity}
                                  rows={5}
                                  externalHint={metaExternalHintIdentity}
                                  externalHintText={t("meta.identityExternal")}
                                  placeholder={t("meta.identityPlaceholder")}
                                  onAiAssist={() => void callAiAssist("identity")}
                                  aiAssistLoading={aiAssistLoading === "identity"}
                                  onOpenInEditor={() => void openMetaWorkspaceInEditor("identity")}
                                  onChange={(value) => {
                                    setMetaIdentity(value);
                                    setMetaWorkspaceMessage("");
                                    setMetaExternalHintIdentity(false);
                                  }}
                                />
                              ) : (
                                <MetaMarkdownField
                                  label={t("meta.soul")}
                                  showLabel={false}
                                  value={metaSoul}
                                  rows={7}
                                  externalHint={metaExternalHintSoul}
                                  externalHintText={t("meta.soulExternal")}
                                  placeholder={t("meta.soulPlaceholder")}
                                  onAiAssist={() => void callAiAssist("soul")}
                                  aiAssistLoading={aiAssistLoading === "soul"}
                                  onOpenInEditor={() => void openMetaWorkspaceInEditor("soul")}
                                  onChange={(value) => {
                                    setMetaSoul(value);
                                    setMetaWorkspaceMessage("");
                                    setMetaExternalHintSoul(false);
                                  }}
                                />
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-muted"
                        onClick={() => setMetaHistoryOpen((open) => !open)}
                      >
                        <History className="h-3.5 w-3.5" />
                        {t("meta.history")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-btnPrimary px-4 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
                        disabled={
                          (metaSoulSaving || metaIdentitySaving) ||
                          (!metaSoulDirty && !metaIdentityDirty)
                        }
                        onClick={() => void saveMetaWorkspace()}
                      >
                        {(metaSoulSaving || metaIdentitySaving) ? t("commonSettings.saving") : tCommon("save")}
                      </button>
                    </div>
                  </div>

                  {metaWorkspaceMessage ? (
                    <div className="mt-2 text-right text-[11px] text-text-subtle">{metaWorkspaceMessage}</div>
                  ) : null}

                  {metaHistoryOpen ? (
                    <div className="mt-3 border-t border-[var(--border-muted)] pt-3">
                      <div className="space-y-3 rounded-md border border-[var(--border-muted)] bg-surface-panel/50 p-2">
                        {metaHistoryLoading ? (
                          <div className="text-[11px] text-text-faint">{t("commonSettings.loadingEllipsis")}</div>
                        ) : null}
                        {metaHistoryMessage ? (
                          <div className="text-[11px] text-red-400">{metaHistoryMessage}</div>
                        ) : null}
                        <div>
                          <div className="mb-1 text-[11px] font-medium text-text-muted">{t("meta.identity")}</div>
                          {metaHistoryIdentityItems.length === 0 ? (
                            <div className="text-[10px] text-text-faint">{t("meta.noIdentityHistory")}</div>                          ) : (
                            <ul className="space-y-1">
                              {metaHistoryIdentityItems.map((item) => (
                                <li key={item.id} className="flex items-start gap-2 text-[11px]">
                                  <span className="shrink-0 text-text-faint">
                                    {formatMetaWorkspaceHistoryTime(item.id, item.savedAt)}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-text-subtle">
                                    {item.preview || t("meta.empty")}
                                  </span>
                                  <button
                                    type="button"
                                    className="shrink-0 text-theme hover:underline"
                                    onClick={() => void restoreMetaWorkspaceHistoryItem("identity", item.id)}
                                  >
                                    {t("meta.restore")}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] font-medium text-text-muted">{t("meta.soul")}</div>
                          {metaHistorySoulItems.length === 0 ? (
                            <div className="text-[10px] text-text-faint">{t("meta.noIdentityHistory")}</div>                          ) : (
                            <ul className="space-y-1">
                              {metaHistorySoulItems.map((item) => (
                                <li key={item.id} className="flex items-start gap-2 text-[11px]">
                                  <span className="shrink-0 text-text-faint">
                                    {formatMetaWorkspaceHistoryTime(item.id, item.savedAt)}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate text-text-subtle">
                                    {item.preview || t("meta.empty")}
                                  </span>
                                  <button
                                    type="button"
                                    className="shrink-0 text-theme hover:underline"
                                    onClick={() => void restoreMetaWorkspaceHistoryItem("soul", item.id)}
                                  >
                                    {t("meta.restore")}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </Panel>
                <WebSearchSettingsPanel />
                <SuggestedQuestionsSettingsPanel />
                <SessionMemoryPanel />
                <Panel title={t("profile.workspaceTitle")}>
                  <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                    {t("profile.workspaceLabel")}
                    <div className="mt-1 flex gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                        value={workspaceDirDraft}
                        onChange={(e) => {
                          setWorkspaceDirDraft(e.target.value);
                          setWorkspaceDirMessage("");
                        }}
                        placeholder="~/.agenticx/workspace"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                        onClick={() => void chooseWorkspaceDirectory()}
                      >
                        {t("profile.chooseDir")}
                      </button>
                    </div>
                    {workspaceDirResolved ? (
                      <span className="mt-1 block text-[11px] text-text-faint">
                        {t("profile.resolvedPath", { path: workspaceDirResolved })}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-xs text-text-faint">
                      {t("profile.workspaceHint")}
                    </span>
                  </label>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!workspaceDirDirty || workspaceDirSaving}
                      onClick={() => void saveWorkspaceDirectory()}
                    >
                      {workspaceDirSaving ? t("commonSettings.saving") : t("profile.saveWorkspace")}
                    </button>
                    {workspaceDirDirty ? (
                      <button
                        type="button"
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover"
                        onClick={() => {
                          setWorkspaceDirDraft(workspaceDirSaved);
                          setWorkspaceDirMessage("");
                        }}
                      >
                        {t("profile.undo")}
                      </button>
                    ) : null}
                  </div>
                  {workspaceDirMessage ? (
                    <p className="mt-2 text-xs text-text-muted">{workspaceDirMessage}</p>
                  ) : null}
                  <div className="mt-3 rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs text-text-subtle">
                    {t("profile.avatarWorkspaceHint")}
                  </div>
                </Panel>
                <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs text-text-subtle">
                  {t("profile.appVersion")}
                </div>
            </div>

            {/* === PROVIDER TAB === */}
            {tab === "provider" && (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <RemoteBackendHintBanner kind="synced" />
              <div className="flex min-h-0 flex-1 gap-4">
                {/* Provider sub-list */}
                <div className="flex w-[176px] shrink-0 flex-col self-stretch rounded-xl border border-border bg-surface-card">
                  <div
                    ref={providerListScrollRef}
                    className="agx-scrollbar-on-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-1.5 pt-2.5"
                  >
                    {providerNames.map((name) => {
                      const entry = draft[name];
                      const isOn = providerEffectiveOn(entry);
                      const isSelected = active === name;
                      return (
                        <button
                          key={name}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition ${
                            isSelected
                              ? "bg-[var(--settings-accent-row-bg)]"
                              : "hover:bg-surface-hover"
                          }`}
                          onClick={() => {
                            if (name !== active) cancelInlineProviderRename();
                            setActive(name);
                            setProviderEnableHint(null);
                            setDefaultProvHint(null);
                            setAddModelModalOpen(false);
                            setAddModelFormId("");
                            setAddModelFormName("");
                            setAddServiceVendorModalOpen(false);
                            setAddVendorFormName("");
                            setEditModelModalOpen(false);
                            setEditModelOriginalId("");
                            setEditModelFormId("");
                            setEditModelError(null);
                          }}
                        >
                          <ProviderAvatar providerId={name} size={28} entry={entry} />
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-xs font-medium ${isSelected ? "text-[var(--settings-accent-fg)]" : "text-text-primary"}`}>
                              {getProviderDisplayName(name, entry)}
                            </span>
                            <span className={`block text-[10px] ${isOn ? "text-emerald-500" : "text-text-faint"}`}>
                              {isOn ? t("commonSettings.enabled") : t("commonSettings.notEnabled")}
                            </span>
                          </span>
                          {name === defProv && (
                            <span className="shrink-0 rounded bg-[var(--settings-accent-badge-bg)] px-1 py-0.5 text-[9px] font-medium text-[var(--settings-accent-fg)]">
                              {t("commonSettings.defaultBadge")}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="border-t border-border p-1.5">
                    <button
                      type="button"
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                      onClick={() => {
                        setAddVendorFormName("");
                        setAddVendorFormType("openai");
                        setAddServiceVendorModalOpen(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t("provider.addVendor")}
                    </button>
                  </div>
                </div>

                {/* Provider detail */}
                <div className="min-h-0 flex-1 min-w-0 space-y-3 overflow-y-auto pr-0.5">
                  {/* ── Header: logo + name + toggles ── */}
                  <div className="flex items-center gap-3 pt-1">
                    <ProviderAvatar providerId={active} size={40} entry={current} />
                    <div className="min-w-0 flex-1">
                      {inlineRenameProviderId === active && isProviderDisplayNameEditable(active, current) ? (
                        <input
                          ref={inlineRenameInputRef}
                          className="w-full rounded-md border border-[var(--settings-accent-badge-bg)] bg-surface-panel px-2 py-1 text-base font-semibold text-text-primary outline-none ring-1 ring-[var(--settings-accent-badge-bg)]"
                          value={inlineRenameValue}
                          onChange={(e) => setInlineRenameValue(e.target.value)}
                          onBlur={commitInlineProviderRename}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.key === "Process" || e.keyCode === 229) return;
                            if (e.key === "Enter") { e.preventDefault(); commitInlineProviderRename(); }
                            if (e.key === "Escape") { e.preventDefault(); cancelInlineProviderRename(); }
                          }}
                          aria-label={t("provider.renameAria")}
                        />
                      ) : (
                        <h2
                          className={`flex items-center gap-1.5 text-base font-semibold leading-snug text-text-primary ${
                            isProviderDisplayNameEditable(active, current)
                              ? "cursor-text rounded px-0.5 transition hover:bg-surface-hover"
                              : ""
                          }`}
                          onClick={() => {
                            if (isProviderDisplayNameEditable(active, current)) beginInlineProviderRename(active);
                          }}
                          title={isProviderDisplayNameEditable(active, current) ? t("provider.renameTitle") : undefined}
                        >
                          {getProviderDisplayName(active, current)}
                          {isProviderDisplayNameEditable(active, current) && (
                            <SquarePen className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
                          )}
                        </h2>
                      )}
                    </div>
                    {/* 启用 / 设为默认 toggles */}
                    <div className="flex shrink-0 items-center gap-4">
                      <label className="flex cursor-pointer flex-col items-center gap-1">
                        <span className="text-[10px] text-text-faint">{t("provider.enable")}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={currentEffectiveOn}
                          aria-label={currentEffectiveOn ? t("provider.turnOff", { name: getProviderDisplayName(active, current) }) : t("provider.turnOn", { name: getProviderDisplayName(active, current) })}
                          className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-accent-badge-bg)] focus-visible:ring-offset-2 ${
                            currentEffectiveOn ? "bg-btnPrimary" : "bg-[var(--ui-switch-track-off)]"
                          }`}
                          onClick={() => {
                            if (currentEffectiveOn) {
                              updateField("enabled", false);
                              setProviderEnableHint(null);
                            } else if (!providerCredentialed(current)) {
                              setProviderEnableHint(t("provider.needCredsToEnable"));
                            } else {
                              updateField("enabled", true);
                              setProviderEnableHint(null);
                            }
                          }}
                        >
                          <span
                            className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full shadow-md ring-0 transition-transform duration-200 ${
                              currentEffectiveOn ? "bg-[var(--ui-btn-primary-text)]" : "bg-white"
                            } ${currentEffectiveOn ? "translate-x-[18px]" : "translate-x-[2px]"} mt-[2px]`}
                          />
                        </button>
                      </label>
                      <label className="flex cursor-pointer flex-col items-center gap-1">
                        <span className="text-[10px] text-text-faint">{t("provider.setDefault")}</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={defProv === active}
                          aria-label={defProv === active ? t("provider.unsetDefault", { name: getProviderDisplayName(active, current) }) : t("provider.setDefaultNamed", { name: getProviderDisplayName(active, current) })}
                          className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-accent-badge-bg)] focus-visible:ring-offset-2 ${
                            defProv === active ? "bg-btnPrimary" : "bg-[var(--ui-switch-track-off)]"
                          }`}
                          onClick={() => {
                            if (defProv === active) {
                              const fallback =
                                providerNames.find((n) => n !== active && providerCredentialed(draft[n])) ??
                                providerNames.find((n) => n !== active) ??
                                ALL_PROVIDERS.find((n) => n !== active);
                              if (fallback && fallback !== active) {
                                setDefaultProvHint(null);
                                setDefProv(fallback);
                              } else {
                                setDefaultProvHint(t("provider.keepOneDefault"));
                              }
                            } else if (!providerCredentialed(current)) {
                              setDefaultProvHint(t("provider.needCredsToDefault"));
                            } else {
                              setDefaultProvHint(null);
                              setDefProv(active);
                            }
                          }}
                        >
                          <span
                            className={`pointer-events-none inline-block h-[18px] w-[18px] rounded-full shadow-md ring-0 transition-transform duration-200 ${
                              defProv === active ? "bg-[var(--ui-btn-primary-text)]" : "bg-white"
                            } ${defProv === active ? "translate-x-[18px]" : "translate-x-[2px]"} mt-[2px]`}
                          />
                        </button>
                      </label>
                      {isProviderDeletable(active) && (
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-rose-400/70 transition hover:border-rose-500/60 hover:bg-rose-500/10 hover:text-rose-400"
                          onClick={() => setProviderDeleteConfirmId(active)}
                          aria-label={t("provider.deleteVendor")}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>
                  {(providerEnableHint || defaultProvHint) && (
                    <div className="text-xs text-rose-400">{providerEnableHint || defaultProvHint}</div>
                  )}
                      <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                        {t("provider.apiKey")}
                        <div className="mt-1 flex gap-2">
                          <div className="relative min-w-0 flex-1">
                            <input
                              type={apiKeyVisible ? "text" : "password"}
                              autoComplete="off"
                              className="w-full rounded-md border border-border bg-surface-panel py-1.5 pl-2 pr-11 text-sm"
                              value={current.apiKey}
                              onChange={(e) => updateField("apiKey", e.target.value)}
                              placeholder="sk-..."
                            />
                            <button
                              type="button"
                              tabIndex={-1}
                              aria-label={apiKeyVisible ? t("commonSettings.hideKey") : t("commonSettings.showKey")}
                              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-subtle"
                              onClick={() => setApiKeyVisible((v) => !v)}
                            >
                              {apiKeyVisible ? (
                                <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
                              ) : (
                                <Eye className="h-4 w-4 shrink-0" aria-hidden />
                              )}
                            </button>
                          </div>
                          <button
                            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                              ks === "checking" ? "border-amber-500/50 text-amber-400"
                                : ks === "ok" ? "border-emerald-500/50 text-emerald-400"
                                : ks === "fail" ? "border-rose-500/50 text-rose-400"
                                : "border-border text-text-subtle hover:text-text-strong"
                            }`}
                            disabled={ks === "checking" || !providerCredentialed(current)}
                            onClick={onValidateKey}
                          >
                            {ks === "checking" ? t("provider.checking") : ks === "ok" ? t("provider.valid") : ks === "fail" ? t("provider.failedMark") : t("provider.check")}
                          </button>
                        </div>
                        {ks === "fail" && keyError[active] && <div className="mt-1 text-xs text-rose-400">{keyError[active]}</div>}
                        {ks === "ok" && keyWarning[active] && (
                          <div className="mt-1 text-xs text-amber-400/90">{keyWarning[active]}</div>
                        )}
                        {!current.apiKey.trim() && current.baseUrl.trim() && (
                          <div className="mt-1 text-xs text-text-faint">{t("provider.probeHint")}</div>
                        )}
                      </label>
                      <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                        {t("provider.apiUrl")} <span className="text-xs text-text-faint">{t("provider.leaveDefault")}</span>
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                          value={current.baseUrl}
                          onChange={(e) => updateField("baseUrl", e.target.value)}
                          placeholder={
                            isOllamaLikeProvider(active, current)
                              ? "http://192.168.x.x:11434"
                              : "https://..."
                          }
                        />
                        {isOllamaLikeProvider(active, current) && (
                          <div className="mt-1 text-xs text-text-faint">
                            <Trans t={t} i18nKey="provider.ollamaNativeHint" components={{ strong: <strong className="font-medium text-text-subtle" />, code: <code className="text-[10px]" /> }} />
                          </div>
                        )}
                        {current.baseUrl.trim() && (
                          <div className="mt-1 text-xs text-text-faint">
                            {t("provider.preview")}<span className="text-text-subtle">
                              {previewProviderApiEndpoint(active, current.baseUrl, current)}
                            </span>
                          </div>
                        )}
                      </label>
                      
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">{t("provider.modelList")}</span>
                          <span className="truncate text-[10px] text-text-faint">{t("provider.starHint")}</span>
                          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium tabular-nums text-text-subtle">
                            {current.models.length}
                          </span>
                        </div>
                        <div />
                        <div className="flex shrink-0 items-center gap-1">
                          <HoverTip label={t("provider.batchHealth")}>
                            <button
                              type="button"
                              aria-label={t("provider.batchHealth")}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-40"
                              disabled={!providerCredentialed(current) || current.models.length === 0}
                              onClick={() => void onBatchHealthCheck()}
                            >
                              <Activity className="h-4 w-4" aria-hidden />
                            </button>
                          </HoverTip>
                          <HoverTip label={t("provider.fetchFromApi")}>
                            <button
                              type="button"
                              aria-label={t("provider.fetchFromApi")}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-40"
                              disabled={fetchingModels || !providerCredentialed(current)}
                              onClick={() => void onFetchModels()}
                            >
                              {fetchingModels ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <RefreshCw className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                          </HoverTip>
                          <HoverTip label={t("provider.addModel")}>
                            <button
                              type="button"
                              aria-label={t("provider.addModel")}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                              onClick={() => {
                                setAddModelFormId("");
                                setAddModelFormName("");
                                setAddModelModalOpen(true);
                              }}
                            >
                              <Plus className="h-4 w-4" aria-hidden />
                            </button>
                          </HoverTip>
                        </div>
                      </div>
                      {fetchModelsError ? (
                        <div className="text-xs text-rose-400">{fetchModelsError}</div>
                      ) : fetchModelsWarning ? (
                        <div className="text-xs text-amber-400/90">{fetchModelsWarning}</div>
                      ) : null}
                      <div className="space-y-1.5">
                        {current.models.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-text-faint">
                            {t("provider.emptyModels")}
                          </div>
                        ) : null}
                        {current.models.map((model) => {
                          const hk = `${active}:${model}`;
                          const entry = modelHealthMap[hk];
                          const checking = entry?.phase === "checking";
                          const unauthorized = entry?.phase === "unauthorized";
                          const defaultModelId = (current.model || current.models[0] || "").trim();
                          const isDefaultModel = model === defaultModelId;
                          return (
                            <div
                              key={model}
                              className={`grid grid-cols-[2rem_minmax(0,1fr)_minmax(6.5rem,auto)_2rem_2rem] items-center gap-2 rounded-lg border border-border bg-surface-panel px-3 py-2.5 transition hover:border-[var(--settings-accent-border-muted)]${unauthorized ? " opacity-80" : ""}`}
                            >
                              <HoverTip label={isDefaultModel ? t("provider.currentDefaultModel") : t("provider.setDefaultModel")}>
                                <button
                                  type="button"
                                  aria-label={isDefaultModel ? t("provider.currentDefaultModel") : t("provider.setDefaultModelNamed", { model })}
                                  aria-pressed={isDefaultModel}
                                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                                    isDefaultModel
                                      ? "text-amber-400"
                                      : "text-text-faint hover:bg-surface-hover hover:text-text-primary"
                                  }`}
                                  onClick={() => {
                                    if (!isDefaultModel) updateField("model", model);
                                  }}
                                >
                                  <Star
                                    className={`h-4 w-4 ${isDefaultModel ? "fill-current" : ""}`}
                                    aria-hidden
                                  />
                                </button>
                              </HoverTip>
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-sm text-text-primary">
                                    {formatModelOptionLabel(active, model, current)}
                                  </span>
                                  {isDefaultModel ? (
                                    <span className="shrink-0 rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-400/90">
                                      {t("commonSettings.defaultBadge")}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex min-w-0 items-center justify-end gap-2">
                                <ModelCapabilityBadges provider={active} model={model} />
                                {entry?.phase === "ok" ? (
                                  <>
                                    <span className="tabular-nums text-xs text-text-subtle">{formatHealthLatencyMs(entry.ms)}</span>
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                                  </>
                                ) : entry?.phase === "unauthorized" ? (
                                  <HoverTip label={unauthorizedHoverLabel(entry.error, t)}>
                                    <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-amber-400/90">
                                      {t("provider.unauthorized")}
                                    </span>
                                  </HoverTip>
                                ) : entry?.phase === "error" ? (
                                  <span className="text-xs text-rose-400/90">{t("provider.failed")}</span>
                                ) : checking ? (
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" aria-hidden />
                                ) : (
                                  <button
                                    type="button"
                                    className="shrink-0 text-xs text-text-faint transition hover:text-[var(--settings-accent-fg)] disabled:opacity-40"
                                    disabled={checking || !providerCredentialed(current)}
                                    onClick={() => void onHealthCheck(model)}
                                  >
                                    {t("provider.checkShort")}
                                  </button>
                                )}
                              </div>
                              <HoverTip label={t("provider.editModel")}>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-text-faint transition hover:bg-surface-hover hover:text-text-primary"
                                  aria-label={t("provider.editModel")}
                                  onClick={() => openEditModelModal(model)}
                                >
                                  <SquarePen className="h-4 w-4" aria-hidden />
                                </button>
                              </HoverTip>
                              <HoverTip label={t("provider.removeModel")}>
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-rose-400/70 transition hover:border-rose-400/50 hover:bg-rose-500/5 hover:text-rose-400"
                                  aria-label={t("provider.removeModel")}
                                  onClick={() => onRemoveModel(model)}
                                >
                                  <CircleMinus className="h-4 w-4" aria-hidden />
                                </button>
                              </HoverTip>
                            </div>
                          );
                        })}
                      </div>
                      <Modal
                        open={fetchModelsModalOpen}
                        title={t("provider.fetchTitle")}
                        onClose={closeFetchModelsModal}
                        backdropClassName="bg-black/78"
                        panelClassName="w-full max-w-[min(90vw,720px)] bg-[var(--surface-base-fallback)]"
                        footer={(
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-text-faint">
                              {t("provider.fetchCount", { total: fetchedModels.length, visible: current.models.length })}
                              {authProbeProgress
                                ? t("provider.autoChecking", { done: authProbeProgress.done, total: authProbeProgress.total })
                                : ""}
                            </span>
                            <button
                              type="button"
                              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)]"
                              onClick={closeFetchModelsModal}
                            >
                              {t("provider.done")}
                            </button>
                          </div>
                        )}
                      >
                        <div className="space-y-3">
                          <input
                            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                            value={fetchModelsSearch}
                            onChange={(e) => setFetchModelsSearch(e.target.value)}
                            placeholder={t("provider.searchModels")}
                          />
                          <div className="max-h-[min(56vh,460px)] space-y-1 overflow-y-auto pr-1">
                            {filteredFetchedModels.length === 0 ? (
                              <div className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-text-faint">
                                {fetchedModels.length === 0 ? t("provider.noApiModels") : t("provider.noMatch")}
                              </div>
                            ) : (
                              filteredFetchedModels.map((model) => {
                                const isVisible = current.models.includes(model);
                                const authEntry = modelHealthMap[`${active}:${model}`];
                                const unauthorized = authEntry?.phase === "unauthorized";
                                const checkingAuth = authEntry?.phase === "checking";
                                const addDisabled = isVisible || unauthorized;
                                return (
                                  <div
                                    key={model}
                                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md border border-border bg-surface-panel/60 px-3 py-2"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm text-text-muted">{model}</div>
                                      <div className="mt-0.5 flex items-center gap-1.5">
                                        <span className="text-[11px] text-text-faint">
                                          {isVisible ? t("provider.visibleState") : t("provider.hiddenState")}
                                        </span>
                                        {unauthorized ? (
                                          <HoverTip label={unauthorizedHoverLabel(authEntry?.error, t)}>
                                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400">
                                              <TriangleAlert className="h-3 w-3" aria-hidden />
                                              {t("provider.unauthorized")}
                                            </span>
                                          </HoverTip>
                                        ) : checkingAuth ? (
                                          <span className="text-[11px] text-text-faint">{t("provider.checkingShort")}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <ModelCapabilityBadges className="justify-end" provider={active} model={model} />
                                    <div className="flex items-center gap-1.5">
                                      <HoverTip
                                        label={
                                          unauthorized
                                            ? unauthorizedHoverLabel(authEntry?.error, t)
                                            : isVisible
                                              ? t("provider.alreadyVisible")
                                              : t("provider.makeVisible")
                                        }
                                      >
                                        <button
                                          type="button"
                                          aria-label={t("provider.makeVisibleNamed", { model })}
                                          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${
                                            isVisible
                                              ? "border-emerald-500/40 text-emerald-400/80"
                                              : unauthorized
                                                ? "border-border text-text-faint opacity-40"
                                                : "border-border text-text-subtle hover:bg-surface-hover hover:text-emerald-400"
                                          }`}
                                          disabled={addDisabled}
                                          onClick={() => makeModelVisible(model)}
                                        >
                                          <Plus className="h-4 w-4" aria-hidden />
                                        </button>
                                      </HoverTip>
                                      <button
                                        type="button"
                                        aria-label={t("provider.makeHiddenNamed", { model })}
                                        className={`inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${
                                          isVisible
                                            ? "border-border text-text-subtle hover:bg-surface-hover hover:text-rose-400"
                                            : "border-rose-500/40 text-rose-400/65"
                                        }`}
                                        disabled={!isVisible}
                                        onClick={() => onRemoveModel(model)}
                                      >
                                        <CircleMinus className="h-4 w-4" aria-hidden />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </Modal>
                      <Modal
                        open={addServiceVendorModalOpen}
                        title={t("provider.addVendorTitle")}
                        onClose={closeAddServiceVendorModal}
                        backdropClassName="bg-black/75"
                        panelClassName="w-full max-w-[min(92vw,400px)] bg-[var(--surface-base-fallback)]"
                        footer={(
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                              onClick={closeAddServiceVendorModal}
                            >
                              {tCommon("cancel")}
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
                              disabled={!addVendorFormName.trim()}
                              onClick={submitAddServiceVendorFromModal}
                            >
                              {tCommon("ok")}
                            </button>
                          </div>
                        )}
                      >
                        <div className="space-y-4">
                          <div className="flex justify-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface-card-strong text-lg font-semibold text-text-muted">
                              {(addVendorFormName.trim().charAt(0) || "P").toUpperCase()}
                            </div>
                          </div>
                          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                            {t("provider.vendorName")}
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-card-strong px-2 py-1.5 text-sm"
                              value={addVendorFormName}
                              onChange={(e) => setAddVendorFormName(e.target.value)}
                              placeholder={t("provider.vendorNamePh")}
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing || e.key === "Process" || e.keyCode === 229) return;
                                if (e.key === "Enter" && addVendorFormName.trim()) submitAddServiceVendorFromModal();
                              }}
                            />
                          </label>
                          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                            {t("provider.vendorType")}
                            <select
                              className="mt-1 w-full rounded-md border border-border bg-surface-card-strong px-2 py-1.5 text-sm"
                              value={addVendorFormType}
                              aria-label={t("provider.vendorType")}
                              onChange={(e) => setAddVendorFormType(e.target.value as ProviderInterfaceKind)}
                            >
                              <option value="openai">{t("provider.openaiCompat")}</option>
                              <option value="ollama">Ollama</option>
                            </select>
                            <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
                              {addVendorFormType === "ollama"
                                ? t("provider.ollamaHint")
                                : t("provider.openaiHint")}
                            </p>
                          </label>
                        </div>
                      </Modal>
                      <Modal
                        open={addModelModalOpen}
                        title={t("provider.addModel")}
                        onClose={closeAddModelModal}
                        footer={(
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                              onClick={closeAddModelModal}
                            >
                              {tCommon("cancel")}
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
                              disabled={!addModelFormId.trim()}
                              onClick={submitAddModelFromModal}
                            >
                              {t("provider.addModel")}
                            </button>
                          </div>
                        )}
                      >
                        <div className="space-y-3">
                          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                            <span className="text-rose-400">*</span> {t("provider.modelId")}
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                              value={addModelFormId}
                              onChange={(e) => setAddModelFormId(e.target.value)}
                              placeholder={t("provider.modelIdRequiredPh")}
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing || e.key === "Process" || e.keyCode === 229) return;
                                if (e.key === "Enter" && addModelFormId.trim()) submitAddModelFromModal();
                              }}
                            />
                          </label>
                          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                            {t("provider.modelName")}
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                              value={addModelFormName}
                              onChange={(e) => setAddModelFormName(e.target.value)}
                              placeholder={t("provider.modelNamePh")}
                            />
                          </label>
                          <p className="text-[11px] leading-relaxed text-text-faint">
                            {t("provider.modelNameHint")}
                          </p>
                        </div>
                      </Modal>
                      <Modal
                        open={editModelModalOpen}
                        title={t("provider.editModel")}
                        onClose={closeEditModelModal}
                        footer={(
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                              onClick={closeEditModelModal}
                            >
                              {tCommon("cancel")}
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
                              disabled={!editModelFormId.trim()}
                              onClick={submitEditModelFromModal}
                            >
                              {tCommon("save")}
                            </button>
                          </div>
                        )}
                      >
                        <div className="space-y-3">
                          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                            <span className="text-rose-400">*</span> {t("provider.modelId")}
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                              value={editModelFormId}
                              onChange={(e) => {
                                setEditModelFormId(e.target.value);
                                setEditModelError(null);
                              }}
                              placeholder={t("provider.modelIdPh")}
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing || e.key === "Process" || e.keyCode === 229) return;
                                if (e.key === "Enter" && editModelFormId.trim()) submitEditModelFromModal();
                              }}
                            />
                          </label>
                          {editModelError ? <div className="text-[11px] text-rose-400">{editModelError}</div> : null}
                          <p className="text-[11px] leading-relaxed text-text-faint">
                            {t("provider.editHint")}
                          </p>
                        </div>
                      </Modal>
                      <Modal
                        open={Boolean(providerDeleteConfirmId)}
                        title={t("provider.deleteVendorTitle")}
                        onClose={() => {
                          if (providerDeleteBusy) return;
                          setProviderDeleteConfirmId(null);
                        }}
                        backdropClassName="bg-black/75"
                        panelClassName="w-full max-w-[min(92vw,400px)] bg-[var(--surface-base-fallback)]"
                        footer={(
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-40"
                              disabled={providerDeleteBusy}
                              onClick={() => setProviderDeleteConfirmId(null)}
                            >
                              {tCommon("cancel")}
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-rose-500 disabled:opacity-40"
                              disabled={providerDeleteBusy}
                              onClick={() => void confirmDeleteProvider()}
                            >
                              {providerDeleteBusy ? t("provider.deleting") : tCommon("delete")}
                            </button>
                          </div>
                        )}
                      >
                        <p className="text-sm leading-relaxed text-text-muted">
                          {t("provider.deleteConfirmBefore")}
                          {providerDeleteConfirmId
                            ? getProviderDisplayName(providerDeleteConfirmId, draft[providerDeleteConfirmId])
                            : ""}
                          {t("provider.deleteConfirmAfter")}
                        </p>
                      </Modal>
                </div>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2 pt-2">
                {providerConfigMessage ? (
                  <span
                    className={`mr-auto text-xs ${
                      providerConfigMessage.startsWith(t("commonSettings.saved")) ? "text-text-muted" : "text-rose-400"
                    }`}
                  >
                    {providerConfigMessage}
                  </span>
                ) : providerConfigDirty ? (
                  <span className="mr-auto text-xs text-text-subtle">{t("provider.unsaved")}</span>
                ) : null}
                <button
                  type="button"
                  className="rounded-md px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-transparent disabled:text-text-faint bg-btnPrimary text-btnPrimary-text hover:bg-btnPrimary-hover disabled:opacity-100"
                  disabled={!providerConfigDirty || providerConfigSaving}
                  onClick={() => void saveProviderConfig()}
                >
                  {providerConfigSaving ? t("commonSettings.saving") : tCommon("save")}
                </button>
              </div>
              </div>
            )}

            {/* === MCP TAB === */}
            {tab === "mcp" && (() => {
              return (
              <div className="space-y-5">
                <RemoteBackendHintBanner />
                <div className="space-y-1">
                  <div className="text-sm text-text-subtle">
                    {t("mcp.intro")}
                  </div>
                  <div className="text-[11px] text-text-faint">
                    <Trans t={t} i18nKey="mcp.processHint" components={{ strong: <strong /> }} />
                  </div>
                  <div className="text-[11px] text-status-warning">
                    <Trans t={t} i18nKey="mcp.keyHint" components={{ code: <code className="text-[10px]" /> }} />
                  </div>
                </div>

                {mcpMessage && <div className="text-xs text-text-subtle">{mcpMessage}</div>}

                {/* —— 配置文件路径 —— */}
                {capabilityLocks.allowLocalMcpInstall ? (
                <div className="space-y-2">
                  <div className="text-xs text-text-faint">
                    {t("mcp.pathsHint")}
                  </div>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      className="flex-1 cursor-not-allowed rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-muted"
                      value={MCP_PRIMARY_CONFIG_PATH}
                      aria-label={t("mcp.primaryPath")}
                    />
                    <span className="shrink-0 self-center text-[10px] text-text-faint">{t("mcp.primary")}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-border p-2 text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                      title={t("mcp.editThisFile")}
                      onClick={() => openMcpEditor(MCP_PRIMARY_CONFIG_PATH)}
                    >
                      <SquarePen className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {mcpExtraPaths.map((row, idx) => (
                    <div key={`mcp-path-${idx}`} className="flex gap-2">
                      <input
                        className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                        value={row}
                        placeholder={t("mcp.extraPathPh")}
                        disabled={mcpPathSaving}
                        onChange={(e) => {
                          const v = e.target.value;
                          setMcpExtraPaths((prev) => prev.map((p, i) => (i === idx ? v : p)));
                        }}
                        onBlur={(e) => {
                          const v = e.target.value;
                          const next = mcpExtraPaths.map((p, i) => (i === idx ? v : p));
                          void persistMcpExtraPaths(next);
                        }}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-border p-2 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                        title={t("mcp.removePath")}
                        disabled={mcpPathSaving}
                        onClick={() => {
                          const next = mcpExtraPaths.filter((_, i) => i !== idx);
                          setMcpExtraPaths(next);
                          void persistMcpExtraPaths(next);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-border p-2 text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                        title={t("mcp.editThisFile")}
                        disabled={!row.trim()}
                        onClick={() => openMcpEditor(row.trim())}
                      >
                        <SquarePen className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                    disabled={mcpPathSaving}
                    onClick={() => setMcpExtraPaths((prev) => [...prev, ""])}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    {t("mcp.addPath")}
                  </button>
                </div>
                ) : null}

                {/* —— MCP 服务列表 —— */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-text-muted">{t("mcp.servers")}</div>
                    {capabilityLocks.allowMcpAutoDiscovery ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
                      onClick={() => void refreshMcpDiscover()}
                      disabled={mcpDiscoverLoading}
                      title={t("mcp.scanLocal")}
                    >
                      <RefreshCw
                        className="h-3.5 w-3.5"
                        style={{ animation: mcpDiscoverLoading ? "spin 1s linear infinite" : "none" }}
                        aria-hidden
                      />
                      {mcpDiscoverLoading ? t("mcp.scanning") : t("mcp.scanDiscover")}
                    </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-faint">
                    <span className="text-text-faint">{t("mcp.note")}</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500" />
                      {t("mcp.healthyNote")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      {t("mcp.errorNote")}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#6b7280]" />
                      {t("mcp.disconnected")}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {mcpServers.length === 0 ? (
                      <div className="py-6 text-center text-sm text-text-faint">
                        <Trans t={t} i18nKey="mcp.empty" components={{ code: <code /> }} />
                      </div>
                    ) : null}
                    {mcpServers.map((server) => {
                      const pres = resolveMcpRowPresentation(server, t);
                      const isRemote = Boolean(server.url?.trim());
                      const optimisticChecked = mcpOptimisticChecked[server.name];
                      const switchChecked = typeof optimisticChecked === "boolean" ? optimisticChecked : server.connected;
                      const forceDisconnectedMessage = Boolean(mcpServerBusy[server.name]) && !switchChecked;
                      const latestOpMessage = forceDisconnectedMessage
                        ? t("mcp.disconnected")
                        : server.op_message?.trim() || t("mcp.statusAria", { line: pres.statusLine });
                      const toolNames = server.tool_names ?? [];
                      const disabledForServer = mcpDisabledTools[server.name] ?? [];
                      const isToolsExpanded = mcpExpandedServers.has(server.name);
                      const isRemoteDetailExpanded = mcpRemoteDetailExpanded.has(server.name);
                      const canExpandTools = toolNames.length > 0;
                      const canExpandRemoteDetail = isRemote;
                      return (
                        <div
                          key={server.name}
                          className="rounded-md border border-border bg-surface-card"
                        >
                          {/* 主行 */}
                          <div className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-2">
                            <div className="flex min-w-0 flex-1 items-start gap-2">
                              <span
                                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${pres.dotClass}`}
                                title={pres.statusLine}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-sm font-medium text-text-muted">{server.name}</span>
                                  {isRemote ? (
                                    <>
                                      <span
                                        className="shrink-0 text-[10px] text-text-faint"
                                        title={server.url}
                                      >
                                        🌐 {mcpRemoteHostLabel(server.url)}
                                      </span>
                                      <span className="shrink-0 rounded border border-border bg-surface-panel px-1 py-0 text-[9px] uppercase tracking-wide text-text-muted">
                                        {mcpTransportBadgeLabel(server.transport)}
                                      </span>
                                    </>
                                  ) : null}
                                  {canExpandTools ? (
                                    <button
                                      type="button"
                                      className="shrink-0 rounded p-0.5 text-text-faint transition hover:bg-surface-hover hover:text-text-subtle"
                                      title={isToolsExpanded ? t("mcp.collapseTools") : t("mcp.expandTools", { count: toolNames.length })}
                                      onClick={() =>
                                        setMcpExpandedServers((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(server.name)) next.delete(server.name);
                                          else next.add(server.name);
                                          return next;
                                        })
                                      }
                                    >
                                      <ChevronRight
                                        className={`h-3.5 w-3.5 transition-transform ${isToolsExpanded ? "rotate-90" : ""}`}
                                        aria-hidden
                                      />
                                    </button>
                                  ) : null}
                                  {canExpandTools ? (
                                    <span className="shrink-0 text-[10px] text-text-faint">
                                      {t("mcp.enabledCount", { on: toolNames.length - disabledForServer.length, total: toolNames.length })}
                                    </span>
                                  ) : null}
                                  {canExpandRemoteDetail ? (
                                    <button
                                      type="button"
                                      className="shrink-0 rounded px-1 py-0.5 text-[10px] text-text-faint transition hover:bg-surface-hover hover:text-text-subtle"
                                      title={isRemoteDetailExpanded ? t("mcp.collapseRemote") : t("mcp.expandRemote")}
                                      onClick={() =>
                                        setMcpRemoteDetailExpanded((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(server.name)) next.delete(server.name);
                                          else next.add(server.name);
                                          return next;
                                        })
                                      }
                                    >
                                      {isRemoteDetailExpanded ? t("commonSettings.collapse") : t("commonSettings.details")}
                                    </button>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span className="text-[11px] text-text-subtle">{pres.statusLine}</span>
                                  {pres.detail ? (
                                    <>
                                      <button
                                        type="button"
                                        className="text-[11px] text-rose-400 underline decoration-dotted hover:text-rose-300"
                                        onClick={() =>
                                          setMcpErrorInspect({ title: t("mcp.errorTitle", { name: server.name }), body: pres.detail! })
                                        }
                                      >
                                        {t("mcp.viewDetails")}
                                      </button>
                                      <button
                                        type="button"
                                        className="text-[11px] text-[var(--settings-accent-text)] underline decoration-dotted"
                                        onClick={() => openMcpEditor(MCP_PRIMARY_CONFIG_PATH)}
                                      >
                                        {t("mcp.fixInEditor")}
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                                {server.command && !isRemote ? (
                                  <div className="truncate text-[10px] text-text-faint">{server.command}</div>
                                ) : isRemote && server.url && !isRemoteDetailExpanded ? (
                                  <div className="truncate text-[10px] text-text-faint" title={server.url}>
                                    remote: {server.url}
                                  </div>
                                ) : null}
                                {latestOpMessage ? (
                                  <div
                                    className={`truncate text-[11px] ${
                                      server.op_phase === "failed" ? "text-rose-400" : "text-text-faint"
                                    }`}
                                    title={latestOpMessage}
                                  >
                                    {latestOpMessage}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-1 sm:pl-2">
                              <button
                                type="button"
                                className="rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                                title={t("mcp.editNamed", { name: server.name })}
                                disabled={Boolean(mcpServerBusy[server.name])}
                                onClick={() => {
                                  if (isRemote) {
                                    setMcpRemoteModalMode("edit");
                                    setMcpRemoteEditName(server.name);
                                    setMcpRemoteModalOpen(true);
                                    return;
                                  }
                                  void openMcpEditorForServer(server.name);
                                }}
                              >
                                <SquarePen className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                                title={t("mcp.deleteNamed", { name: server.name })}
                                disabled={Boolean(mcpServerBusy[server.name])}
                                onClick={() => {
                                  setMcpDeleteConfirmServerName(server.name);
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                              <SettingsSwitch
                                checked={switchChecked}
                                disabled={shouldDisableMcpToggle({
                                  hasSession: Boolean(sessionId),
                                  isBusy: Boolean(mcpServerBusy[server.name]),
                                })}
                                onChange={(next) => {
                                  handleToggleMcp(server.name, next);
                                }}
                                aria-label={
                                  switchChecked ? t("mcp.connectedToggle", { name: server.name }) : t("mcp.connectNamed", { name: server.name })
                                }
                              />
                            </div>
                          </div>

                          {isRemoteDetailExpanded && isRemote ? (
                            <McpRemoteServerDetail
                              serverName={server.name}
                              url={server.url}
                              transport={server.transport}
                              locateServerPath={locateMcpServerPath}
                            />
                          ) : null}

                          {/* 展开的工具列表 */}
                          {isToolsExpanded && canExpandTools ? (
                            <div className="border-t border-border px-3 pb-2.5 pt-2">
                              <div className="flex flex-wrap gap-1.5">
                                {toolNames.map((tool) => {
                                  const isDisabled = disabledForServer.includes(tool);
                                  return (
                                    <button
                                      key={tool}
                                      type="button"
                                      title={isDisabled ? t("mcp.enableTool", { tool }) : t("mcp.disableTool", { tool })}
                                      onClick={() => handleToggleMcpTool(server.name, tool, isDisabled)}
                                      className={`rounded-md border px-2 py-0.5 text-[11px] transition ${
                                        isDisabled
                                          ? "border-border bg-surface-panel text-text-faint line-through opacity-50"
                                          : "border-border bg-surface-hover text-text-subtle hover:border-[var(--settings-accent-text)] hover:text-text-primary"
                                      }`}
                                    >
                                      {tool}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {capabilityLocks.allowLocalMcpInstall ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-md border border-dashed border-border bg-surface-panel px-3 py-2 text-left text-sm text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                        onClick={() => {
                          setMcpRemoteModalMode("add");
                          setMcpRemoteEditName(undefined);
                          setMcpRemoteModalOpen(true);
                        }}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border">
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="flex flex-col">
                          <span className="font-medium text-text-muted">{t("mcp.addRemote")}</span>
                          <span className="text-[11px] text-text-faint">URL + Headers（Tushare / Gateway）</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 rounded-md border border-dashed border-border bg-surface-panel px-3 py-2 text-left text-sm text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                        onClick={() => openMcpEditor(MCP_PRIMARY_CONFIG_PATH)}
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border">
                          <SquarePen className="h-3.5 w-3.5" aria-hidden />
                        </span>
                        <span className="flex flex-col">
                          <span className="font-medium text-text-muted">{t("mcp.editJson")}</span>
                          <span className="text-[11px] text-text-faint">{t("mcp.stdioHint")}</span>
                        </span>
                      </button>
                    </div>
                    ) : null}

                    <McpGatewayImportPanel
                      configPath={MCP_PRIMARY_CONFIG_PATH}
                      existingServerNames={new Set(mcpServers.map((s) => s.name))}
                      onImported={async (msg) => {
                        setMcpMessage(msg);
                        if (sessionId) await onRefreshMcp(sessionId);
                      }}
                    />
                  </div>
                </div>

                {/* —— MCP 市场 —— */}
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="text-sm font-medium text-text-muted">{t("mcp.marketplace")}</div>
                  {/* <div className="text-[11px] leading-relaxed text-text-faint">
                    仅展示官方认证且可安装的托管 MCP（已过滤第三方/不可安装条目），点「添加」直接合并到主配置。
                  </div> */}
                  <MCPMarketplacePanel
                    loading={mcpMarketplaceLoading}
                    items={mcpMarketplaceItems as Array<Record<string, unknown> & { id: string }>}
                    summary={mcpMarketplaceSummary}
                    search={mcpMarketplaceSearch}
                    onSearchChange={setMcpMarketplaceSearch}
                    onRefresh={refreshMcpMarketplace}
                    onInstall={handleInstallMarketplaceMcp}
                    resolving={mcpMarketplaceInstallBusy}
                    envSchema={mcpMarketplaceEnvSchema}
                    installedIds={mcpMarketplaceAllInstalledIds}
                    installingId={mcpMarketplaceInstallingId}
                    statusMessage={mcpMarketplaceStatus?.message}
                    statusKind={mcpMarketplaceStatus?.kind}
                    statusTargetId={mcpMarketplaceStatus?.serverId}
                  />
                </div>
              </div>
              );
            })()}

            {tab === "connectors" && (
              <ConnectorsTab
                sessionId={sessionId}
                tapdConnected={mcpServers.some(
                  (server) => server.name === "tapd" && server.connected,
                )}
                onRefreshMcp={onRefreshMcp}
              />
            )}
            <div className={tab === "tools" ? "space-y-4" : "hidden"}>
              <ToolsTab ref={toolsTabRef} />
            </div>

            {/* === SKILLS TAB === */}
            {tab === "skills" && (
              <div className="space-y-4">
                <RemoteBackendHintBanner />
                <SkillsTab />
                <SkillAdvancedPanel />
              </div>
            )}

            {/* === KNOWLEDGE TAB === Plan-Id: machi-kb-stage1-local-mvp */}
            {tab === "knowledge" && <KnowledgeSettings ref={knowledgeRef} />}

            {tab === "data_sources" && <DataSourcesSettings />}

            {/* === MEMORY TAB === Plan-Id: 2026-05-31-near-memory-graph-graphiti */}
            {tab === "memory" && (
              <div className="space-y-4">
                <Panel title={t("memory.notesTitle")}>
                  <p className="text-[11px] leading-relaxed text-text-subtle">
                    <Trans t={t} i18nKey="memory.notesIntro" components={{ strong: <strong className="font-medium text-text-muted" /> }} />
                  </p>
                </Panel>
                <TurnArchiveSettingsPanel />
                <MemoryGraphExplorer
                  apiBase={apiBase}
                  apiToken={apiToken}
                  avatarId={memoryContextPane?.avatarId ?? null}
                  sessionId={memoryContextPane?.sessionId ?? ""}
                  layout="dashboard"
                  showConfig
                  initialScope="meta"
                  providerOptions={providerNames}
                />
              </div>
            )}

            {/* === SECURITY TAB ===（保持挂载：底部「保存」需 flushPermissions，勿改为条件渲染） */}
            <div className={tab === "security" ? "space-y-4" : "hidden"}>
              <SecurityCenterTab
                ref={securityTabRef}
                runMode={runMode}
                onRunModeChange={onRunModeChange}
                focus={securityFocus}
                focusSeq={securityFocusSeq}
              />
            </div>

            {tab === "automation" && (
              <div className="space-y-4">
                <AutomationTab />
              </div>
            )}

            {tab === "voice" && <VoiceSettingsPanel ref={voiceSettingsRef} />}

            {/* === EMAIL TAB === */}
            {tab === "email" && <EmailSettingsTab />}

            {tab === "favorites" && (
              <FavoritesTab
                apiBase={apiBase}
                apiToken={apiToken}
                sessionId={sessionId}
                panes={panes}
                avatars={avatars}
                groups={groups}
                onForwardFavorite={onForwardFavorite}
              />
            )}

            {tab === "server" && (
              <div className="space-y-4">
                <Panel title={t("server.mode")}>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-text-subtle cursor-pointer">
                      <input
                        type="radio"
                        name="server-mode"
                        checked={serverMode === "local"}
                        onChange={() => setServerMode("local")}
                        className="accent-[var(--ui-btn-primary-bg)]"
                      />
                      {t("server.localDefault")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text-subtle cursor-pointer">
                      <input
                        type="radio"
                        name="server-mode"
                        checked={serverMode === "remote"}
                        onChange={() => setServerMode("remote")}
                        className="accent-[var(--ui-btn-primary-bg)]"
                      />
                      {t("server.remote")}
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-text-faint">
                    {t("server.modeHint")}
                  </p>
                </Panel>

                <Panel title={t("server.remoteConfig")}>
                  <fieldset disabled={serverMode === "local"} className={serverMode === "local" ? "opacity-50" : ""}>
                    <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                      {t("server.serverUrl")}
                      <input
                        className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                        placeholder="https://your-server:8080"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                      />
                    </label>
                    <label className={`mt-3 block ${SETTINGS_LABEL_CLASS}`}>
                      {t("server.authToken")}
                      <div className="relative mt-1">
                        <input
                          className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 pr-16 text-sm text-text-subtle"
                          type={serverShowToken ? "text" : "password"}
                          placeholder={t("server.tokenPh")}
                          value={serverToken}
                          onChange={(e) => setServerToken(e.target.value)}
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-text-faint hover:text-text-subtle"
                          onClick={() => setServerShowToken(!serverShowToken)}
                        >
                          {serverShowToken ? tCommon("hide") : tCommon("show")}
                        </button>
                      </div>
                    </label>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        className="rounded-md border border-border px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-hover disabled:opacity-50"
                        disabled={!serverUrl.trim() || serverTestStatus === "testing"}
                        onClick={async () => {
                          setServerTestStatus("testing");
                          setServerTestError("");
                          try {
                            const res = await window.agenticxDesktop.testRemoteServer({
                              url: serverUrl.trim().replace(/\/+$/, ""),
                              token: serverToken.trim(),
                            });
                            setServerTestStatus(res.ok ? "ok" : "fail");
                            if (!res.ok) setServerTestError(res.error || `HTTP ${res.status}`);
                          } catch (err) {
                            setServerTestStatus("fail");
                            setServerTestError(String(err));
                          }
                        }}
                      >
                        {serverTestStatus === "testing" ? t("commonSettings.testing") : t("server.testConn")}
                      </button>
                      {serverTestStatus === "ok" && (
                        <span className="text-sm text-green-500">{t("server.connOk")}</span>
                      )}
                      {serverTestStatus === "fail" && (
                        <span className="text-sm text-red-400" title={serverTestError}>{t("server.connFail")}</span>
                      )}
                    </div>
                  </fieldset>
                </Panel>

                <Panel title={t("server.feishu")}>
                  {/* Tab switcher */}
                  <div className="mb-4 flex gap-1 rounded-lg bg-surface-hover p-0.5">
                    {(["feishu", "webhook"] as const).map((imKind) => (
                      <button
                        key={imKind}
                        type="button"
                        className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition ${
                          imTab === imKind
                            ? "bg-surface-panel text-text-strong shadow-sm"
                            : "text-text-faint hover:text-text-subtle"
                        }`}
                        onClick={() => setImTab(imKind)}
                      >
                        {imKind === "feishu" ? t("server.feishuLong") : t("server.webhook")}
                      </button>
                    ))}
                  </div>

                  {/* Feishu long-connection tab */}
                  {imTab === "feishu" && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">
                        {t("server.feishuLongHint")}
                      </p>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-text-subtle">{t("server.enableFeishuBot")}</span>
                        <SettingsSwitch
                          checked={feishuEnabled}
                          onChange={setFeishuEnabled}
                          aria-label={t("server.enableFeishuLong")}
                        />
                      </div>
                      {feishuEnabled && (
                        <>
                          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                            App ID
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                              placeholder="cli_xxxxxxxxxxxxxx"
                              value={feishuAppId}
                              onChange={(e) => setFeishuAppId(e.target.value)}
                            />
                          </label>
                          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                            App Secret
                            <div className="relative mt-1">
                              <input
                                className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 pr-16 text-sm text-text-subtle"
                                type={feishuShowSecret ? "text" : "password"}
                                placeholder="••••••••••••••••"
                                value={feishuAppSecret}
                                onChange={(e) => setFeishuAppSecret(e.target.value)}
                              />
                              <button
                                type="button"
                                className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-text-faint hover:text-text-subtle"
                                onClick={() => setFeishuShowSecret(!feishuShowSecret)}
                              >
                                {feishuShowSecret ? tCommon("hide") : tCommon("show")}
                              </button>
                            </div>
                          </label>
                          <p className="text-xs text-text-faint">
                            {t("server.feishuSaveHint")}{" "}
                            <Trans t={t} i18nKey="server.feishuEventHint" components={{ code: <code className="rounded bg-surface-hover px-1" /> }} />
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Webhook mode tab */}
                  {imTab === "webhook" && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">
                        {t("server.webhookHint")}
                      </p>
                      <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                        {t("server.gatewayUrl")}
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="https://gateway.example.com"
                          value={gwUrl}
                          onChange={(e) => setGwUrl(e.target.value)}
                        />
                      </label>
                      <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                        {t("server.deviceId")}
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="my-macbook"
                          value={gwDeviceId}
                          onChange={(e) => setGwDeviceId(e.target.value)}
                        />
                      </label>
                      <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                        {t("server.deviceToken")}
                        <div className="relative mt-1">
                          <input
                            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 pr-16 text-sm text-text-subtle"
                            type={gwShowToken ? "text" : "password"}
                            value={gwToken}
                            onChange={(e) => setGwToken(e.target.value)}
                          />
                          <button
                            type="button"
                            className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-text-faint hover:text-text-subtle"
                            onClick={() => setGwShowToken(!gwShowToken)}
                          >
                            {gwShowToken ? tCommon("hide") : tCommon("show")}
                          </button>
                        </div>
                      </label>
                    </div>
                  )}
                  {imTab === "webhook" && (
                  <><div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-btnPrimary px-3 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
                      disabled={!gwUrl.trim() || !gwDeviceId.trim() || !gwToken.trim()}
                      onClick={() => setGwQrOpen(true)}
                    >
                      {t("server.qrBind")}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-hover disabled:opacity-50"
                      disabled={!gwUrl.trim() || !gwDeviceId.trim() || !gwToken.trim() || gwBindingsLoading}
                      onClick={() => void refreshGwBindings()}
                    >
                      {gwBindingsLoading ? t("server.refreshing") : t("server.refreshBindings")}
                    </button>
                  </div>
                  {gwBindingsErr && (
                    <p className="mt-2 text-xs text-red-400" title={gwBindingsErr}>
                      {t("server.bindingsError", { error: gwBindingsErr.slice(0, 120) })}
                    </p>
                  )}
                  {gwBindings.length > 0 && (
                    <ul className="mt-3 space-y-2 text-sm text-text-subtle">
                      {gwBindings.map((b) => (
                        <li
                          key={`${b.platform}:${b.sender_id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-card px-2 py-1.5"
                        >
                          <span>
                            <span className="text-text-muted">{b.platform}</span>
                            <span className="mx-1 text-text-faint">·</span>
                            <span className="font-mono text-xs">{b.sender_id}</span>
                          </span>
                          <button
                            type="button"
                            className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-text-faint hover:bg-surface-hover hover:text-text-subtle"
                            onClick={async () => {
                              const base = gwUrl.trim().replace(/\/+$/, "");
                              const did = gwDeviceId.trim();
                              const tok = gwToken.trim();
                              try {
                                const r = await fetch(
                                  `${base}/api/device/${encodeURIComponent(did)}/bindings?token=${encodeURIComponent(tok)}&platform=${encodeURIComponent(b.platform)}&sender_id=${encodeURIComponent(b.sender_id)}`,
                                  { method: "DELETE" },
                                );
                                if (!r.ok) {
                                  const body = await r.text();
                                  throw new Error(body.slice(0, 120) || `HTTP ${r.status}`);
                                }
                                await refreshGwBindings();
                              } catch (e) {
                                alert(t("server.unbindFailed", { reason: String(e) }));
                              }
                            }}
                          >
                            {t("server.unbind")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="mt-4 text-sm text-text-faint underline decoration-dotted hover:text-text-subtle"
                    onClick={() => setGwAdvancedOpen(!gwAdvancedOpen)}
                  >
                    {gwAdvancedOpen ? t("server.collapseAdvanced") : t("server.expandAdvanced")}
                  </button>
                  {gwAdvancedOpen && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-text-subtle">
                          {t("server.enableGateway")}
                        </span>
                        <SettingsSwitch
                          checked={gwEnabled}
                          onChange={setGwEnabled}
                          aria-label={t("server.enableGatewayAria")}
                        />
                      </div>
                      <label className={`block ${SETTINGS_LABEL_CLASS}`}>
                        {t("server.studioBase")}
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="http://127.0.0.1:8000"
                          value={gwStudioBase}
                          onChange={(e) => setGwStudioBase(e.target.value)}
                        />
                      </label>
                      <p className="mt-1 text-xs text-text-faint">
                        {t("server.applyHint")}
                      </p>
                    </div>
                  )}
                  </>)}
                </Panel>

                <Panel title={t("server.wechat")}>
                  {wechatStatus === "idle" && !wechatBotId && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">
                        {t("server.wechatHint")}
                      </p>
                      <button
                        type="button"
                        className="rounded-md bg-btnPrimary px-3 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
                        disabled={wechatStatus === "binding"}
                        onClick={async () => {
                          setWechatBindMsg("");
                          try {
                            const { port, running } = await window.agenticxDesktop.wechatSidecarPort();
                            let sidecarPort = port;
                            if (!running) {
                              const startRes = await window.agenticxDesktop.wechatSidecarStart();
                              sidecarPort = startRes.port;
                              await new Promise((r) => setTimeout(r, 1500));
                            }
                            if (!sidecarPort) { setWechatBindMsg(t("server.sidecarDown")); return; }
                            const resp = await fetch(`http://127.0.0.1:${sidecarPort}/bind/start`, { method: "POST" });
                            const data = await resp.json() as { session_id: string; qr_url?: string };
                            const sid = String(data.session_id || "").trim();
                            if (!sid) { setWechatBindMsg(t("server.sessionCreateFailed")); return; }
                            const proxyQrUrl = `http://127.0.0.1:${sidecarPort}/bind/${sid}/qr?ts=${Date.now()}`;
                            setWechatBindSessionId(sid);
                            setWechatBindSidecarPort(sidecarPort);
                            setWechatQrFallbackUrl(String(data.qr_url || "").trim());
                            setWechatQrUrl(proxyQrUrl);
                            setWechatStatus("binding");
                            const ws = new WebSocket(`ws://127.0.0.1:${sidecarPort}/bind/${sid}/ws`);
                            ws.onmessage = (ev) => {
                              const msg = JSON.parse(ev.data as string) as { event: string; status?: string; bot_id?: string; qr_url?: string; error?: string };
                              if (msg.event === "status") {
                                if (msg.status === "scanned") setWechatBindMsg(t("server.scannedConfirm"));
                                if (msg.status === "expired") {
                                  const fallback = String(msg.qr_url || "").trim();
                                  if (fallback) setWechatQrFallbackUrl(fallback);
                                  setWechatQrUrl(`http://127.0.0.1:${sidecarPort}/bind/${sid}/qr?ts=${Date.now()}`);
                                  setWechatBindMsg(t("server.qrRefreshed"));
                                }
                                if (msg.status === "confirmed") {
                                  setWechatStatus("connected");
                                  setWechatBotId(msg.bot_id || "");
                                  setWechatQrUrl("");
                                  setWechatQrFallbackUrl("");
                                  setWechatBindSessionId("");
                                  setWechatBindSidecarPort(0);
                                  setWechatBindMsg("");
                                  ws.close();
                                  void (async () => {
                                    try {
                                      const createRes = await window.agenticxDesktop.createSession({});
                                      if (createRes.ok && createRes.session_id) {
                                        await window.agenticxDesktop.saveWechatDesktopBinding({
                                          sessionId: createRes.session_id,
                                        });
                                      }
                                    } catch { /* noop */ }
                                  })();
                                }
                                if (msg.status === "timeout") {
                                  setWechatStatus("idle");
                                  setWechatQrUrl("");
                                  setWechatQrFallbackUrl("");
                                  setWechatBindSessionId("");
                                  setWechatBindSidecarPort(0);
                                  setWechatBindMsg(t("server.bindTimeout"));
                                  ws.close();
                                }
                              }
                              if (msg.event === "error") { setWechatBindMsg(msg.error || t("server.bindError")); }
                            };
                            ws.onerror = () => {
                              setWechatBindMsg(t("server.wsFailed"));
                              setWechatStatus("idle");
                              setWechatQrUrl("");
                              setWechatQrFallbackUrl("");
                              setWechatBindSessionId("");
                              setWechatBindSidecarPort(0);
                            };
                            ws.onclose = () => { if (wechatStatus === "binding") { /* keep state */ } };
                          } catch (e) {
                            setWechatBindMsg(String(e));
                            setWechatStatus("idle");
                            setWechatQrFallbackUrl("");
                            setWechatBindSessionId("");
                            setWechatBindSidecarPort(0);
                          }
                        }}
                      >
                        {t("server.bindWechat")}
                      </button>
                    </div>
                  )}

                  {wechatStatus === "binding" && wechatQrUrl && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">{t("server.scanBelow")}</p>
                      <div className="flex justify-center">
                        <img
                          src={wechatQrUrl}
                          alt="WeChat QR"
                          className="h-48 w-48 rounded-md border border-border"
                          onError={() => {
                            const proxyPrefix = wechatBindSessionId && wechatBindSidecarPort
                              ? `http://127.0.0.1:${wechatBindSidecarPort}/bind/${wechatBindSessionId}/qr`
                              : "";
                            const isProxySrc = proxyPrefix && wechatQrUrl.startsWith(proxyPrefix);
                            const fallback = String(wechatQrFallbackUrl || "").trim();
                            if (isProxySrc && fallback && fallback !== wechatQrUrl) {
                              setWechatQrUrl(fallback);
                              setWechatBindMsg(t("server.qrProxyFallback"));
                              return;
                            }
                            setWechatBindMsg(t("server.qrLoadFailed"));
                          }}
                        />
                      </div>
                      {wechatBindMsg && <p className="text-center text-xs text-text-subtle">{wechatBindMsg}</p>}
                    </div>
                  )}

                  {(wechatStatus === "connected" || (wechatStatus === "idle" && wechatBotId) || wechatStatus === "stale" || wechatStatus === "recovering") && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${wechatStatus === "connected" ? "bg-green-500" : wechatStatus === "recovering" ? "bg-[var(--status-warning)] animate-pulse" : wechatStatus === "stale" ? "bg-[var(--status-warning)]" : "bg-yellow-500"}`} />
                        <span className={`text-sm ${wechatStatus === "stale" || wechatStatus === "recovering" ? "text-status-warning" : "text-text-subtle"}`}>
                          {wechatStatus === "connected" ? t("server.connected") : wechatStatus === "recovering" ? t("server.recovering") : wechatStatus === "stale" ? t("server.connExpired") : t("server.boundDisconnected")}
                        </span>
                      </div>
                      {wechatBotId && (
                        <p className="text-xs text-text-faint">Bot ID: <code className="rounded bg-surface-hover px-1">{wechatBotId}</code></p>
                      )}
                      {wechatStatus === "recovering" && (
                        <p className="text-xs text-status-warning">{t("server.reconnectingIlink")}</p>
                      )}
                      {wechatStatus === "stale" && (
                        <p className="text-xs text-status-warning">{t("server.channelDegraded")}</p>
                      )}
                      <div className="flex items-center gap-3 pt-1">
                        {wechatStatus === "stale" && (
                          <button
                            type="button"
                            className="rounded-md bg-btnPrimary px-3 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
                            onClick={async () => {
                              setWechatBindMsg("");
                              setWechatStatus("recovering");
                              try {
                                let { port, running } = await window.agenticxDesktop.wechatSidecarPort();
                                if (!running || !port) {
                                  const started = await window.agenticxDesktop.wechatSidecarStart();
                                  port = started.port;
                                  await new Promise((r) => setTimeout(r, 1200));
                                }
                                if (port) {
                                  const rc = await fetch(`http://127.0.0.1:${port}/reconnect`, { method: "POST" });
                                  const j = await rc.json().catch(() => ({}));
                                  if (j && j.ok) {
                                    // Poll a couple of times with direct status check so we can give clear feedback.
                                    // The "恢复中..." text is driven by wechatStatus === "recovering".
                                    const doRefreshAndMaybeClear = async (delay: number, final: boolean) => {
                                      await new Promise(r => setTimeout(r, delay));
                                      try {
                                        const p = await window.agenticxDesktop.wechatSidecarPort();
                                        if (p.running && p.port) {
                                          const s = await fetch(`http://127.0.0.1:${p.port}/status`);
                                          if (s.ok) {
                                            const d: any = await s.json();
                                            const conn = !!d.connected;
                                            const stl = !!d.stale;
                                            if (conn && !stl) {
                                              setWechatStatus("connected");
                                              setWechatBotId(d.bot_id || "");
                                              setWechatBindMsg(t("server.recoverOk"));
                                              setTimeout(() => setWechatBindMsg(""), 1800);
                                              return true;
                                            } else if (stl) {
                                              setWechatStatus("stale");
                                              setWechatBotId(d.bot_id || "");
                                            }
                                          }
                                        }
                                      } catch {}
                                      if (final) {
                                        setWechatStatus("stale");
                                        setWechatBindMsg(t("server.recoverStillDown"));
                                        setTimeout(() => setWechatBindMsg(""), 2200);
                                      }
                                      return false;
                                    };
                                    void doRefreshAndMaybeClear(1200, false);
                                    void doRefreshAndMaybeClear(3800, true);
                                    return;
                                  }
                                }
                                setWechatStatus("stale");
                                setWechatBindMsg(t("server.recoverFailed"));
                              } catch (e) {
                                setWechatStatus("stale");
                                setWechatBindMsg(t("server.recoverError") + String(e));
                              }
                            }}
                          >
                            {t("server.tryRecover")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700"
                          onClick={async () => {
                            try {
                              const { port, running } = await window.agenticxDesktop.wechatSidecarPort();
                              if (running && port) await fetch(`http://127.0.0.1:${port}/unbind`, { method: "POST" });
                            } catch { /* noop */ }
                            try {
                              await window.agenticxDesktop.saveWechatDesktopBinding({ sessionId: null });
                            } catch { /* noop */ }
                            // Ensure creds file cleared even if sidecar not running
                            try {
                              await window.agenticxDesktop.wechatClearCredentials?.();
                            } catch {}
                            setWechatStatus("idle");
                            setWechatBotId("");
                            setWechatQrUrl("");
                            setWechatQrFallbackUrl("");
                            setWechatBindSessionId("");
                            setWechatBindSidecarPort(0);
                            setWechatBindMsg("");
                          }}
                        >
                          {t("server.unbindWechat")}
                        </button>
                      </div>
                    </div>
                  )}

                  {wechatStatus === "expired" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                        <span className="text-sm text-red-400">{t("server.sessionExpired")}</span>
                      </div>
                      <p className="text-xs text-text-faint">
                        {t("server.ilinkExpired")}
                      </p>
                      <button
                        type="button"
                        className="rounded-md bg-btnPrimary px-3 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
                        onClick={() => {
                          setWechatStatus("idle");
                          setWechatBotId("");
                          setWechatQrUrl("");
                          setWechatQrFallbackUrl("");
                          setWechatBindSessionId("");
                          setWechatBindSidecarPort(0);
                        }}
                      >
                        {t("server.rebind")}
                      </button>
                    </div>
                  )}

                  {wechatBindMsg && wechatStatus !== "binding" && (
                    <p className="mt-2 text-xs text-text-faint">{wechatBindMsg}</p>
                  )}
                </Panel>

                <QrConnectModal
                  open={gwQrOpen}
                  gatewayBaseUrl={gwUrl.trim().replace(/\/+$/, "")}
                  deviceId={gwDeviceId.trim()}
                  token={gwToken.trim()}
                  onClose={() => setGwQrOpen(false)}
                  onBound={() => void refreshGwBindings()}
                />

                <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs text-text-subtle space-y-1">
                  <p>{t("server.remoteRef")}</p>
                  <p>{t("server.remoteStep1")} <code className="text-text-muted">pip install agenticx</code></p>
                  <p>{t("server.remoteStep2")} <code className="text-text-muted">agx serve --host 0.0.0.0 --port 8080 --token YOUR_TOKEN</code></p>
                  <p>{t("server.remoteStep3")}</p>
                  <p className="text-text-faint">{t("server.remoteApply")}</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5">
            <span className="min-w-0 truncate text-[11px] text-text-faint">
              {t("commonSettings.footerHint")}
            </span>
            <button
              className="shrink-0 rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
              onClick={handleSave}
            >
              {t("commonSettings.exit")}
            </button>
          </div>
        </div>
        <div
          className="agx-settings-panel-resize-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("commonSettings.resizeWindow")}
          title={t("commonSettings.resize")}
          onMouseDown={onPanelResizeMouseDown}
        />
      </div>
    </div>
    {mcpErrorInspect ? (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-error-inspect-title"
        onClick={() => setMcpErrorInspect(null)}
      >
        <div
          className="max-h-[min(70vh,32rem)] w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface-panel shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="border-b border-border px-4 py-3">
            <h2 id="mcp-error-inspect-title" className="text-sm font-semibold text-text-strong">
              {mcpErrorInspect.title}
            </h2>
          </div>
          <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-xs text-text-subtle">
            {mcpErrorInspect.body}
          </pre>
          <div className="flex justify-end border-t border-border px-4 py-2.5">
            <button
              type="button"
              className="rounded-md bg-btnPrimary px-3 py-1.5 text-sm font-medium text-btnPrimary-text hover:bg-btnPrimary-hover"
              onClick={() => setMcpErrorInspect(null)}
            >
              {tCommon("close")}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    <Modal
      open={Boolean(mcpDeleteConfirmServerName)}
      onClose={() => setMcpDeleteConfirmServerName(null)}
      panelClassName="w-full max-w-[min(92vw,560px)] bg-surface-panel"
      footer={(
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-4 py-1.5 text-sm text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
            onClick={() => setMcpDeleteConfirmServerName(null)}
          >
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            className="rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
            onClick={confirmDeleteMcpServer}
          >
            {tCommon("ok")}
          </button>
        </div>
      )}
    >
      <div className="space-y-5 text-center">
        <div className="relative mx-auto h-[120px] w-[120px]">
          <svg
            viewBox="0 0 120 120"
            className="h-full w-full drop-shadow-[0_10px_24px_rgba(0,0,0,0.45)]"
            aria-hidden
          >
            <path
              d="M60 9 L110 100 H10 Z"
              fill="#FACC15"
              stroke="#F8FAFC"
              strokeWidth="8"
              strokeLinejoin="round"
            />
            <rect x="54" y="40" width="12" height="36" rx="6" fill="#F8FAFC" />
            <circle cx="60" cy="88" r="6" fill="#F8FAFC" />
          </svg>
          <div className="absolute -bottom-1 -right-1 flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-[#0f172a] bg-[#0f172a] shadow-lg">
            <img src={effectiveMetaAvatarUrl} alt="" className="h-full w-full object-cover" />
          </div>
        </div>
        <p className="text-[38px] font-semibold leading-tight text-text-strong">
          <Trans t={t} i18nKey="mcp.deleteConfirm" values={{ name: mcpDeleteConfirmServerName ?? "" }} />
        </p>
      </div>
    </Modal>
    <MCPJsonEditorModal
      open={mcpEditorOpen}
      selectedPath={mcpEditorPath}
      filePaths={mcpEditorFilePaths}
      focusServerName={mcpEditorFocusServerName}
      focusRequestToken={mcpEditorFocusToken}
      onClose={() => {
        setMcpEditorOpen(false);
        setMcpEditorFocusServerName(undefined);
      }}
      onPickPath={setMcpEditorPath}
      onLoad={async (path) => {
        const result = await window.agenticxDesktop.mcpGetRaw({ path });
        if (!result.ok) return { ok: false, error: result.error };
        return {
          ok: true,
          text: result.text,
          format: result.format,
          parse_error: result.parse_error,
        };
      }}
      onSave={async (path, text) => {
        const result = await window.agenticxDesktop.mcpPutRaw({ path, text });
        if (!result.ok) return { ok: false, error: result.error };
        if (sessionId) await onRefreshMcp(sessionId);
        return { ok: true };
      }}
    />
    <McpRemoteServerModal
      open={mcpRemoteModalOpen}
      mode={mcpRemoteModalMode}
      configPath={MCP_PRIMARY_CONFIG_PATH}
      serverName={mcpRemoteEditName}
      locateServerPath={locateMcpServerPath}
      onClose={() => {
        setMcpRemoteModalOpen(false);
        setMcpRemoteEditName(undefined);
      }}
      onSaved={async (msg) => {
        setMcpMessage(msg);
        if (sessionId) await onRefreshMcp(sessionId);
      }}
    />
    </>
  );
}
