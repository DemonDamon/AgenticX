import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Settings2,
  Cpu,
  Plug,
  Mail,
  FolderOpen,
  Bookmark,
  Sparkles,
  Globe,
  Plus,
  Trash2,
  Wrench,
  Loader2,
  ChevronRight,
  Anchor,
  Clock,
  User,
  Activity,
  RefreshCw,
  SquarePen,
  CircleMinus,
  CheckCircle2,
  Eye,
  EyeOff,
  Library,
} from "lucide-react";
import { Panel } from "./ds/Panel";
import { Modal } from "./ds/Modal";
import { HoverTip } from "./ds/HoverTip";
import type { Avatar, ChatPane, ChatStyle, GroupChat, McpServer } from "../store";
import { useAppStore } from "../store";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { RECOMMENDED_SKILLS } from "../data/recommended-skills";
import { buildSkillHubAgentInstallPrompt } from "../utils/skillhub-install-prompt";
import { shouldDisableMcpToggle } from "../utils/mcp-toggle-state";
import { ForwardPicker, type ForwardConfirmPayload } from "./ForwardPicker";
import { QrConnectModal } from "./QrConnectModal";
import { AutomationTab } from "./automation/AutomationTab";
import {
  RuntimeConfigSection,
  RUNTIME_MAX_TOOL_ROUNDS,
  RUNTIME_MIN_TOOL_ROUNDS,
} from "./automation/RuntimeConfigSection";
import { AccountTab } from "./AccountTab";
import { KnowledgeSettings, type KnowledgeSettingsHandle } from "./settings/knowledge/KnowledgeSettings";
import { getProviderDisplayName, makeCustomOpenAIProviderId } from "../utils/provider-display";
import type { SettingsTab } from "../settings-tab";
import type { MCPDiscoveryHit } from "./settings/mcp/MCPDiscoveryPanel";
import { MCPMarketplacePanel } from "./settings/mcp/MCPMarketplacePanel";
import { MCPJsonEditorModal } from "./settings/mcp/MCPJsonEditorModal";
export type { SettingsTab } from "../settings-tab";

export type FavoriteForwardContext = {
  sourceSessionId: string;
  content: string;
  role?: string;
};

const ALL_PROVIDERS = [
  "openai", "anthropic", "volcengine", "bailian",
  "zhipu", "qianfan", "minimax", "kimi", "ollama",
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
  /** 接口范式：当前仅支持 OpenAI 兼容 */
  interface?: "openai";
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
  const iface = saved?.interface === "openai" ? "openai" : undefined;
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

const MCP_PRIMARY_CONFIG_PATH = "~/.agenticx/mcp.json";

/** 与后端 `connection_state` 对齐；缺省时按 connected 推断（兼容旧 Studio） */
function resolveMcpRowPresentation(server: McpServer): {
  dotClass: string;
  statusLine: string;
  detail?: string;
} {
  const st =
    server.connection_state || (server.connected ? "healthy" : "disconnected");
  if (st === "error") {
    return {
      dotClass: "bg-rose-500",
      statusLine: "错误 — 仍标记已连接但未注册到可用工具",
      detail: server.error_detail?.trim(),
    };
  }
  if (st === "healthy") {
    const n = server.tool_count ?? 0;
    return {
      dotClass: "bg-emerald-400",
      statusLine: n > 0 ? `已连接 · ${n} 个工具` : "已连接",
    };
  }
  return {
    dotClass: "bg-zinc-500",
    statusLine: "未连接",
  };
}

type ConfirmMode = "manual" | "semi-auto" | "auto";
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

type TrinityConfigForm = {
  skill_protocol: boolean;
  session_summary: boolean;
  learning_enabled: boolean;
  skill_manage_enabled: boolean;
  learning_nudge_interval: number;
  learning_min_tool_calls: number;
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
  return inferSourceFromBaseDir(skill.base_dir) ?? (raw || "custom");
}

function effectiveSkillLocation(skill: SkillItem): "project" | "global" {
  const src = effectiveSkillSource(skill);
  if (["cursor", "claude", "agents", "agent_global", "skillhub", "registry", "bundle"].includes(src)) {
    return "global";
  }
  return skill.location === "project" ? "project" : "global";
}

function skillSourceBadge(source: string | undefined): { label: string; className: string } {
  const base = "shrink-0 rounded-full border px-1.5 text-[10px]";
  switch (source) {
    case "builtin":
      return { label: "内置", className: `${base} border-zinc-500/30 bg-zinc-500/10 text-zinc-400` };
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
        label: "Agents 全局",
        className: `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-400`,
      };
    case "agent_global":
      return {
        label: "全局 .agent",
        className: `${base} border-teal-500/30 bg-teal-500/10 text-teal-400`,
      };
    case "project_agents":
      return {
        label: "项目 .agents",
        className: `${base} border-cyan-500/30 bg-cyan-500/10 text-cyan-400`,
      };
    case "project_agent":
      return {
        label: "项目 .agent",
        className: `${base} border-cyan-500/30 bg-cyan-500/5 text-cyan-300`,
      };
    case "agenticx":
      return { label: "AgenticX", className: `${base} border-purple-500/30 bg-purple-500/10 text-purple-400` };
    case "agent_created":
      return { label: "智能体创建", className: `${base} border-purple-500/30 bg-purple-500/10 text-purple-300` };
    case "custom":
      return { label: "自定义", className: `${base} border-border bg-surface-panel text-text-faint` };
    default:
      return { label: "其他", className: `${base} border-border bg-surface-panel text-text-faint` };
  }
}

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
  const src = skillSourceBadge(effectiveSkillSource(skill));
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
      className={`w-full rounded-md border px-3 py-2 transition ${
        isExpanded || isActive
          ? "border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)]"
          : skill.name === recentMarketSkillName
            ? "border-amber-500/35 bg-amber-500/5"
            : "border-border bg-surface-card hover:bg-surface-hover"
      } ${!globalSkillEnabled ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onActivate(skill.name)}
        onDoubleClick={() => void onExpandDetail(skill.name)}
        title="双击展开当前技能"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">{skill.name}</span>
          {skill.name === recentMarketSkillName && (
            <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 text-[10px] text-amber-300">
              刚安装
            </span>
          )}
          <span className={src.className}>{src.label}</span>
          <span className={locClass}>{locationLabel}</span>
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
              同名冲突({conflictCount})
            </span>
          ) : null}
        </div>
        {skill.description ? (
          <p className="mt-0.5 truncate text-xs text-text-muted">{skill.description}</p>
        ) : null}
      </button>
      <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
        <span className="text-[10px] text-text-faint">全局</span>
        <SettingsSwitch
          checked={globalSkillEnabled}
          disabled={skillScanBusy}
          aria-label={`全局启用技能 ${skill.name}`}
          onChange={(next) => onToggleGlobalSkill(skill.name, next)}
        />
      </div>
      </div>
      {conflictCount > 1 ? (
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-faint">
          <span>默认来源</span>
          <select
            className="rounded border border-border bg-surface-panel px-1.5 py-0.5 text-[11px] text-text-primary"
            value={selectedSource}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation();
              onChoosePreferredSource(skill.name, e.target.value);
            }}
          >
            {uniqueSources.map((source) => (
              <option key={`${skill.name}:${source}`} value={source}>
                {skillSourceBadge(source).label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {isExpanded ? (
        <div className="mt-2 rounded-md border border-[var(--settings-accent-border-muted)] bg-surface-card">
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
              关闭 ✕
            </button>
          </div>
          {detailLoading ? (
            <div className="px-3 py-3 text-xs text-text-faint">加载详情...</div>
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

function SkillsLocationSection({
  skills,
  title,
  locationLabel,
  activeSkillName,
  expandedSkillName,
  detail,
  loadingDetail,
  recentMarketSkillName,
  preferredSources,
  onChoosePreferredSource,
  onActivate,
  onExpandDetail,
  onCollapseDetail,
  disabledSkillNames,
  skillScanBusy,
  onToggleGlobalSkill,
}: {
  skills: SkillItem[];
  title: string;
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
  if (skills.length === 0) return null;
  const PREVIEW_COUNT = 10;
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = skills.length > PREVIEW_COUNT;
  const visibleSkills = expanded || !shouldCollapse ? skills : skills.slice(0, PREVIEW_COUNT);
  const remaining = Math.max(0, skills.length - visibleSkills.length);

  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
        {title} ({skills.length})
      </div>
      <div className="space-y-1">
        {visibleSkills.map((skill) => (
          <SkillRowButton
            key={skill.name}
            skill={skill}
            isActive={activeSkillName === skill.name}
            isExpanded={expandedSkillName === skill.name}
            detailLoading={expandedSkillName === skill.name && loadingDetail && detail?.name !== skill.name}
            detailContent={expandedSkillName === skill.name && detail?.name === skill.name ? detail.content : null}
            recentMarketSkillName={recentMarketSkillName}
            locationLabel={locationLabel}
            preferredSource={preferredSources[skill.name]}
            onChoosePreferredSource={onChoosePreferredSource}
            onActivate={onActivate}
            onExpandDetail={onExpandDetail}
            onCollapseDetail={onCollapseDetail}
            globalSkillEnabled={!disabledSkillNames.includes(skill.name)}
            skillScanBusy={skillScanBusy}
            onToggleGlobalSkill={onToggleGlobalSkill}
          />
        ))}
        {shouldCollapse ? (
          <button
            type="button"
            className="w-full rounded-md border border-border bg-surface-panel px-2.5 py-2 text-left text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less" : `Show all (${remaining} more)`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

type BundleItem = {
  name: string;
  version: string;
  description: string;
  skills: string[];
  mcp_servers: string[];
  avatars: string[];
  memory_templates: string[];
};

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
  confirmStrategy: ConfirmMode;
  theme: "dark" | "light" | "dim";
  chatStyle: ChatStyle;
  onThemeChange: (theme: "dark" | "light" | "dim") => void;
  onChatStyleChange: (style: ChatStyle) => void;
  onConfirmStrategyChange: (strategy: ConfirmMode) => Promise<void> | void;
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
  | { phase: "error" };

function formatHealthLatencyMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

const TABS: { id: SettingsTab; label: string; icon: typeof Settings2 }[] = [
  { id: "account", label: "账号", icon: User },
  { id: "general", label: "通用", icon: Settings2 },
  { id: "provider", label: "模型服务", icon: Cpu },
  { id: "mcp", label: "MCP 服务", icon: Plug },
  { id: "tools", label: "工具", icon: Wrench },
  { id: "skills", label: "技能", icon: Sparkles },
  // Plan-Id: machi-kb-stage1-local-mvp
  { id: "knowledge", label: "知识库", icon: Library },
  { id: "hooks", label: "钩子", icon: Anchor },
  { id: "automation", label: "自动化", icon: Clock },
  { id: "email", label: "邮件通知", icon: Mail },
  { id: "workspace", label: "工作区", icon: FolderOpen },
  { id: "favorites", label: "收藏", icon: Bookmark },
  { id: "server", label: "服务器连接", icon: Globe },
];

const EMAIL_PRESETS: Array<{
  id: EmailPresetId;
  label: string;
  smtp_host: string;
  smtp_port: number;
  smtp_use_tls: boolean;
}> = [
  { id: "qq", label: "QQ 邮箱", smtp_host: "smtp.qq.com", smtp_port: 587, smtp_use_tls: true },
  { id: "163", label: "163 邮箱", smtp_host: "smtp.163.com", smtp_port: 465, smtp_use_tls: true },
  { id: "gmail", label: "Gmail", smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_use_tls: true },
  { id: "outlook", label: "Outlook", smtp_host: "smtp.office365.com", smtp_port: 587, smtp_use_tls: true },
  { id: "custom", label: "自定义", smtp_host: "", smtp_port: 587, smtp_use_tls: true },
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

const CATEGORY_LABELS: Record<string, string> = {
  system: "系统",
  filesystem: "文件系统",
  code: "代码与 LSP",
  mcp: "MCP",
  skill: "技能",
  agent: "Agent 辅助",
  memory: "记忆与搜索",
  document: "文档解析",
  scheduling: "后台任务",
  meta: "元智能体专用",
  other: "其他",
};

const CATEGORY_ORDER = ["system", "filesystem", "code", "document", "agent", "memory", "scheduling", "mcp", "skill", "meta", "other"];

const TOOL_LABELS: Record<string, string> = {
  bash_exec: "Bash",
  file_read: "Read",
  file_write: "Write",
  file_edit: "Edit",
  list_files: "Glob",
  codegen: "CodeGen",
  lsp_goto_definition: "LSP GoTo",
  lsp_find_references: "LSP References",
  lsp_hover: "LSP Hover",
  lsp_diagnostics: "LSP Diagnostics",
  mcp_connect: "MCP Connect",
  mcp_call: "MCP Call",
  mcp_import: "MCP Import",
  skill_use: "Skill Use",
  skill_list: "Skill List",
  skill_manage: "Skill Manage",
  todo_write: "TodoWrite",
  scratchpad_write: "Scratchpad Write",
  scratchpad_read: "Scratchpad Read",
  memory_append: "Memory Append",
  memory_search: "Memory Search",
  session_search: "Session Search",
  liteparse: "LiteParse",
  schedule_task: "Task",
  list_scheduled_tasks: "List Tasks",
  cancel_scheduled_task: "Cancel Task",
  spawn_subagent: "Spawn SubAgent",
  cancel_subagent: "Cancel SubAgent",
  retry_subagent: "Retry SubAgent",
  query_subagent_status: "Query SubAgent",
  check_resources: "Check Resources",
  recommend_subagent_model: "Recommend Model",
  list_skills: "List Skills",
  list_mcps: "List MCPs",
  send_bug_report_email: "Bug Report Email",
  update_email_config: "Update Email Config",
  set_taskspace: "Set Taskspace",
  delegate_to_avatar: "Delegate to Avatar",
  read_avatar_workspace: "Read Avatar Workspace",
  chat_with_avatar: "Chat with Avatar",
};

/** 设置页展示用中文说明（不改后端发给模型的英文 tool schema） */
const TOOL_DESCRIPTIONS_ZH: Record<string, string> = {
  bash_exec: "在当前工作区执行 Shell 命令。",
  file_read: "读取文件内容，可指定行号范围。",
  file_write: "写入完整文件内容；会先展示统一 diff，写入前需确认。",
  file_edit: "在文件中替换指定文本；会先展示统一 diff，写入前需确认。",
  list_files: "列出指定路径下的文件与目录，可选递归。",
  codegen: "使用内置 CodeGen 引擎生成代码产物（agent / workflow / tool / skill 等）。",
  mcp_connect: "按配置连接一个 MCP 服务。",
  mcp_call: "调用已连接 MCP 上的工具，传入 JSON 参数。",
  mcp_import: "从外部 mcp.json 导入 MCP 配置到 AgenticX 工作区。",
  skill_use: "将某个技能激活到当前对话上下文。",
  skill_list: "列出本地/远程可用技能的摘要。",
  skill_manage:
    "在 ~/.agenticx/skills/ 下创建、修改或删除技能（SKILL.md）；支持 create / patch / delete（需显式开启环境开关）。",
  todo_write: "更新当前会话的结构化任务列表。",
  scratchpad_write: "将会话中间结果写入草稿板（scratchpad）。",
  scratchpad_read: "读取草稿板某键内容，或列出全部键。",
  memory_append: "向工作区日记或长期 MEMORY.md 追加一条记忆（跨会话保留）。",
  memory_search: "用全文 / 向量 / 混合模式检索已索引的工作区记忆。",
  session_search: "按关键词检索历史会话消息，空查询则返回最近会话。",
  liteparse: "通过 LiteParse 解析 PDF、Office、图片等文档并提取文本。",
  lsp_goto_definition: "在指定文件位置跳转到符号定义（LSP）。",
  lsp_find_references: "查找符号在工程内的所有引用（LSP）。",
  lsp_hover: "获取光标处符号的类型信息与文档说明（LSP）。",
  lsp_diagnostics: "读取文件或已打开文件的诊断/类型与 Lint 信息（LSP）。",
  schedule_task: "安排后台异步任务，即使用户未在聊天也会执行。",
  list_scheduled_tasks: "列出所有后台/计划任务及其状态。",
  cancel_scheduled_task: "按 task_id 取消后台任务。",
  spawn_subagent: "为委派任务启动一个子智能体工作进程。",
  cancel_subagent: "按 ID 或分身名取消正在运行的子智能体。",
  retry_subagent: "对已完成或失败的子智能体重试，可附带修正后的任务描述。",
  query_subagent_status: "查询单个或全部子智能体状态（支持 agent_id、分身名或 avatar_id）。",
  check_resources: "在调度前查看当前主机资源占用情况。",
  recommend_subagent_model: "根据任务复杂度与已配置 Provider 为子智能体推荐模型。",
  list_skills: "列出 AgenticX 中所有可用技能及简介。",
  list_mcps: "列出已配置的 MCP 服务及其连接状态。",
  send_bug_report_email: "使用用户配置的 SMTP 发送问题反馈邮件。",
  update_email_config: "在严格校验下更新 notifications.email.* 邮件通知配置。",
  set_taskspace: "为当前会话设置或追加工作区（taskspace）路径，本回合结束后注册生效。",
  delegate_to_avatar: "将任务委派给指定分身，在其独立工作区中执行。",
  read_avatar_workspace: "不启动子智能体的情况下读取分身工作区中的文件。",
  chat_with_avatar: "向分身发送内部问题并返回其回复，供元智能体汇总给用户。",
};

function toolDisplayDescription(name: string, apiDescription: string): string {
  return TOOL_DESCRIPTIONS_ZH[name] ?? apiDescription;
}

// ---------------------------------------------------------------------------
// Hooks Tab
// ---------------------------------------------------------------------------

type CuratedHookItem = {
  name: string;
  description: string;
  events: string[];
  enabled: boolean;
  source: string;
};

type ImportedHookItem = {
  name: string;
  source: string;
  event: string;
  type: string;
  command?: string;
  url?: string;
  prompt?: string;
  matcher?: string;
  block_on_failure?: boolean;
  timeout_seconds?: number;
  enabled: boolean;
  source_path?: string;
  discovered_via?: string;
  event_inferred?: boolean;
  duplicate_count?: number;
  duplicate_sources?: string[];
  usability?: string;
};

type HookSettings = {
  preset_paths: Record<string, { enabled: boolean }>;
  custom_paths: string[];
  declarative: unknown[];
  disabled: string[];
};

type HookScanPathItem = {
  source: string;
  path: string;
  exists: boolean;
};

type ScanSummary = {
  raw_total: number;
  deduped_total: number;
  source_counts: Record<string, number>;
};

const HOOK_PRIMARY_CONFIG_PATH = "~/.agenticx/hooks/";

const HOOK_PRESETS: { key: string; label: string; path: string }[] = [
  { key: "cursor_plugins", label: "Cursor 插件目录", path: "~/.cursor/plugins/" },
  { key: "claude_plugins", label: "Claude 插件目录", path: "~/.claude/plugins/" },
];

function hookSourceBadge(source: string): { label: string; className: string } {
  const base = "shrink-0 rounded-full border px-1.5 text-[10px]";
  switch (source) {
    case "bundled":
    case "agenticx":
      return { label: "内置", className: `${base} border-zinc-500/30 bg-zinc-500/10 text-zinc-400` };
    case "cursor":
      return { label: "Cursor", className: `${base} border-sky-500/30 bg-sky-500/10 text-sky-400` };
    case "claude":
      return { label: "Claude", className: `${base} border-orange-500/30 bg-orange-500/10 text-orange-400` };
    case "cursor_plugins":
      return { label: "Cursor 插件", className: `${base} border-sky-500/30 bg-sky-500/10 text-sky-400` };
    case "claude_plugins":
      return { label: "Claude 插件", className: `${base} border-emerald-500/30 bg-emerald-500/10 text-emerald-400` };
    case "managed":
      return { label: "用户", className: `${base} border-purple-500/30 bg-purple-500/10 text-purple-400` };
    case "workspace":
      return { label: "工作区", className: `${base} border-cyan-500/30 bg-cyan-500/10 text-cyan-400` };
    default:
      return { label: "自定义", className: `${base} border-border bg-surface-panel text-text-faint` };
  }
}

function hookTypeBadge(hookType: string): { label: string; className: string } {
  const base = "shrink-0 rounded-full border px-1.5 text-[10px]";
  switch (hookType) {
    case "command":
      return { label: "命令", className: `${base} border-amber-500/30 bg-amber-500/10 text-amber-400` };
    case "http":
      return { label: "HTTP", className: `${base} border-blue-500/30 bg-blue-500/10 text-blue-400` };
    case "prompt":
      return { label: "提示词", className: `${base} border-green-500/30 bg-green-500/10 text-green-400` };
    case "agent":
      return { label: "智能体", className: `${base} border-rose-500/30 bg-rose-500/10 text-rose-400` };
    default:
      return { label: hookType, className: `${base} border-border bg-surface-panel text-text-faint` };
  }
}

const EVENT_LABELS: Record<string, string> = {
  before_tool_call: "preToolUse",
  after_tool_call: "postToolUse",
  session_start: "sessionStart",
  session_end: "sessionEnd",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
};

function HooksTab() {
  const [curatedHooks, setCuratedHooks] = useState<CuratedHookItem[]>([]);
  const [importedHooks, setImportedHooks] = useState<ImportedHookItem[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary>({ raw_total: 0, deduped_total: 0, source_counts: {} });
  const [scanPaths, setScanPaths] = useState<HookScanPathItem[]>([]);
  const [hookError, setHookError] = useState<string>("");
  const [settingsError, setSettingsError] = useState<string>("");
  const [settings, setSettings] = useState<HookSettings>({
    preset_paths: {},
    custom_paths: [],
    declarative: [],
    disabled: [],
  });
  const [customPaths, setCustomPaths] = useState<string[]>([]);
  const [importExpanded, setImportExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);

  const fetchAll = useCallback(async () => {
    try {
      const token = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
      const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
      const headers: Record<string, string> = {};
      if (token) headers["x-agx-desktop-token"] = token;

      const [hooksRes, settingsRes] = await Promise.all([
        fetch(`${effectiveBase}/api/hooks`, { headers }),
        fetch(`${effectiveBase}/api/hooks/settings`, { headers }),
      ]);
      const hooksData = await hooksRes.json();
      const settingsData = await settingsRes.json();

      if (hooksData.ok) {
        setCuratedHooks(hooksData.curated_hooks ?? []);
        setImportedHooks(hooksData.imported_hooks ?? []);
        setScanSummary(hooksData.scan_summary ?? { raw_total: 0, deduped_total: 0, source_counts: {} });
        setScanPaths(hooksData.scan_paths ?? []);
        setHookError("");
      } else {
        setCuratedHooks([]);
        setImportedHooks([]);
        setScanPaths(hooksData.scan_paths ?? []);
        setHookError(
          String(hooksData.error ?? hooksData.detail ?? `/api/hooks 请求失败（HTTP ${hooksRes.status || "unknown"}）`),
        );
      }
      if (settingsData.ok) {
        setSettings(settingsData);
        setCustomPaths(settingsData.custom_paths ?? []);
        setSettingsError("");
      } else {
        setSettingsError(String(settingsData.error ?? settingsData.detail ?? "/api/hooks/settings 拉取失败"));
      }
    } catch (err) {
      setCuratedHooks([]);
      setImportedHooks([]);
      setScanPaths([]);
      setHookError(err instanceof Error ? err.message : "拉取 Hook 配置失败");
      setSettingsError("");
    } finally {
      setLoading(false);
    }
  }, [apiToken, backendUrl]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  const persistSettings = useCallback(
    async (patch: Partial<HookSettings>) => {
      setBusy(true);
      try {
        const token = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
        const effectiveBase = backendUrl || (await window.agenticxDesktop.getApiBase());
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["x-agx-desktop-token"] = token;
        const resp = await fetch(`${effectiveBase}/api/hooks/settings`, {
          method: "PUT",
          headers,
          body: JSON.stringify(patch),
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data?.ok) {
          throw new Error(String(data?.detail ?? data?.error ?? `HTTP ${resp.status}`));
        }
        await fetchAll();
      } finally {
        setBusy(false);
      }
    },
    [apiToken, backendUrl, fetchAll],
  );

  const togglePreset = useCallback(
    (key: string, enabled: boolean) => {
      void persistSettings({ preset_paths: { ...settings.preset_paths, [key]: { enabled } } });
    },
    [settings.preset_paths, persistSettings],
  );

  const persistCustomPaths = useCallback(
    (paths: string[]) => void persistSettings({ custom_paths: paths.filter((p) => p.trim()) }),
    [persistSettings],
  );

  const toggleHookEnabled = useCallback(
    (hookName: string, enabled: boolean) => {
      const current = Array.isArray(settings.disabled) ? settings.disabled : [];
      const next = enabled ? current.filter((id) => id !== hookName) : Array.from(new Set([...current, hookName]));
      setSettings((prev) => ({ ...prev, disabled: next }));
      setCuratedHooks((prev) => prev.map((h) => (h.name === hookName ? { ...h, enabled } : h)));
      setImportedHooks((prev) => prev.map((h) => (h.name === hookName ? { ...h, enabled } : h)));
      void persistSettings({ disabled: next }).catch(() => void fetchAll());
    },
    [fetchAll, persistSettings, settings.disabled],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-text-subtle">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在加载钩子配置...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-subtle">
        钩子（Hooks）是智能体在执行的特定节点运行自定义脚本，可用于修改行为、执行策略或记录日志。
      </div>

      {hookError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">{hookError}</div>
      ) : null}

      {/* Block A: 预置钩子 */}
      <Panel title={`预置钩子 (${curatedHooks.length})`}>
        {curatedHooks.length === 0 ? (
          <div className="py-3 text-center text-xs text-text-faint">暂无预置钩子</div>
        ) : (
          <div className="divide-y divide-border">
            {curatedHooks.map((hook) => (
              <div key={hook.name} className="flex items-center gap-3 px-1 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{hook.name}</span>
                    <span className="shrink-0 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-1.5 text-[10px] text-zinc-400">内置</span>
                  </div>
                  <div className="mt-0.5 text-xs text-text-faint truncate">{hook.description}</div>
                  {hook.events?.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {hook.events.map((ev) => (
                        <span key={ev} className="rounded bg-surface-hover px-1 py-0.5 text-[10px] font-mono text-text-subtle">{ev}</span>
                      ))}
                    </div>
                  )}
                </div>
                <SettingsSwitch
                  checked={hook.enabled}
                  disabled={busy}
                  size="sm"
                  aria-label={`启用 ${hook.name}`}
                  onChange={(next) => toggleHookEnabled(hook.name, next)}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Block B: 外部导入（默认折叠） */}
      <Panel
        title={
          <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setImportExpanded((v) => !v)}>
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${importExpanded ? "rotate-90" : ""}`} aria-hidden />
            <span>外部导入钩子{scanSummary.deduped_total > 0 ? ` (${scanSummary.deduped_total} 条，去重自 ${scanSummary.raw_total} 条)` : ""}</span>
          </button>
        }
      >
        {importExpanded ? (
          <div className="space-y-3">
            <div className="space-y-2">
              {settingsError ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">配置路径读取异常：{settingsError}</div>
              ) : null}
              <div className="text-xs text-text-faint">勾选预设路径可自动导入 Cursor / Claude Code 等工具的 Hooks。</div>
              {HOOK_PRESETS.map((preset) => {
                const isOn = settings.preset_paths?.[preset.key]?.enabled !== false;
                return (
                  <label key={preset.key} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2 py-1.5">
                    <input type="checkbox" checked={isOn} disabled={busy} onChange={(e) => togglePreset(preset.key, e.target.checked)} className="h-3.5 w-3.5 accent-[var(--ui-btn-primary-bg)]" />
                    <span className="flex-1 text-sm text-text-primary">{preset.label}</span>
                    <span className="text-xs text-text-faint">{preset.path}</span>
                  </label>
                );
              })}
              {customPaths.map((row, idx) => (
                <div key={`hook-path-${idx}`} className="flex gap-2">
                  <input className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm" value={row} placeholder="例如 /path/to/hooks/" onChange={(e) => setCustomPaths((prev) => prev.map((p, i) => (i === idx ? e.target.value : p)))} onBlur={() => persistCustomPaths(customPaths)} disabled={busy} />
                  <button type="button" className="shrink-0 rounded-md border border-border p-2 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40" title="移除此路径" disabled={busy} onClick={() => { const next = customPaths.filter((_, i) => i !== idx); setCustomPaths(next); persistCustomPaths(next); }}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              ))}
              <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40" disabled={busy} onClick={() => setCustomPaths((prev) => [...prev, ""])}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                添加配置路径
              </button>
            </div>
            {importedHooks.length === 0 ? (
              <div className="py-2 text-center text-xs text-text-faint">未发现外部钩子</div>
            ) : (
              <div className="divide-y divide-border rounded-md border border-border">
                {importedHooks.map((hook, idx) => {
                  const srcBadge = hookSourceBadge(hook.source || "custom");
                  const typeBadge = hookTypeBadge(hook.type);
                  const snippet = hook.command?.slice(0, 100) ?? hook.url?.slice(0, 100) ?? "";
                  const eventLabel = EVENT_LABELS[hook.event] ?? hook.event;
                  return (
                    <div key={`${hook.name}-${idx}`} className="px-3 py-2">
                      <div className="flex items-center gap-2 justify-between">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-surface-hover px-1 py-0.5 text-[10px] font-mono text-text-subtle">{eventLabel}</span>
                          <span className={srcBadge.className}>{srcBadge.label}</span>
                          <span className={typeBadge.className}>{typeBadge.label}</span>
                          {(hook.duplicate_count ?? 1) > 1 && (
                            <span className="text-[10px] text-text-faint">x{hook.duplicate_count} 来自 {(hook.duplicate_sources ?? []).join(", ")}</span>
                          )}
                          {hook.usability === "needs_env" && (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">需要外部环境</span>
                          )}
                        </div>
                        <SettingsSwitch checked={hook.enabled} disabled={busy} size="sm" aria-label={`启用 ${hook.name}`} onChange={(next) => toggleHookEnabled(hook.name, next)} />
                      </div>
                      {snippet && <div className="mt-1 truncate font-mono text-[11px] text-text-faint">{snippet}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions Advanced Panel
// ---------------------------------------------------------------------------

type PathRule = { pattern: string; allow: boolean };

type RegistryToolRow = { name: string; description?: string; category?: string; is_meta?: boolean };

export type PermissionsAdvancedPanelHandle = {
  /** 将路径/命令/工具拒绝列表写入后端；与输入框失焦保存等效，供窗口底部「保存」统一触发。 */
  flushPermissions: () => Promise<{ ok: boolean; error?: string }>;
};

const PermissionsAdvancedPanel = forwardRef<PermissionsAdvancedPanelHandle>(function PermissionsAdvancedPanel(_props, ref) {
  const [pathRules, setPathRules] = useState<PathRule[]>([]);
  const [deniedCommands, setDeniedCommands] = useState<string[]>([]);
  const [deniedTools, setDeniedTools] = useState<string[]>([]);
  const [registryTools, setRegistryTools] = useState<RegistryToolRow[]>([]);
  const [toolInsertFilter, setToolInsertFilter] = useState("");
  const [permMode, setPermMode] = useState("default");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const apiToken = useAppStore((s) => s.apiToken);
  const backendUrl = useAppStore((s) => s.backendUrl);

  /** 与 CC Bridge / Hooks 等面板一致：未配置远程 URL 时用本机内置 Studio 的 API 根地址，避免请求落到 `/api/...` 相对路径导致 HTTP 404。 */
  const resolveApiBase = useCallback(async () => {
    const u = (backendUrl ?? "").trim();
    if (u) return u.replace(/\/+$/, "");
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [backendUrl]);

  const filteredRegistryTools = useMemo(() => {
    const q = toolInsertFilter.trim().toLowerCase();
    const rows = registryTools.filter((t) => t.name);
    if (!q) return rows;
    return rows.filter((t) => {
      const d = (t.description ?? "").toLowerCase();
      return t.name.toLowerCase().includes(q) || d.includes(q) || (t.category ?? "").toLowerCase().includes(q);
    });
  }, [registryTools, toolInsertFilter]);

  const fetchPerms = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (apiToken) headers["x-agx-desktop-token"] = apiToken;
      const base = await resolveApiBase();
      const [permRes, regRes] = await Promise.all([
        fetch(`${base}/api/permissions`, { headers }),
        fetch(`${base}/api/tools/registry`, { headers }),
      ]);
      const data = await permRes.json();
      if (data.ok) {
        setPermMode(data.mode ?? "default");
        setPathRules(
          (data.path_rules ?? []).map((r: any) => ({
            pattern: r.pattern ?? "",
            allow: r.allow !== false,
          })),
        );
        setDeniedCommands(data.denied_commands ?? []);
        setDeniedTools(data.denied_tools ?? []);
      }
      try {
        const reg = await regRes.json();
        if (reg.ok && Array.isArray(reg.tools)) {
          setRegistryTools(
            reg.tools.map((t: any) => ({
              name: String(t.name ?? "").trim(),
              description: typeof t.description === "string" ? t.description : "",
              category: typeof t.category === "string" ? t.category : "",
              is_meta: Boolean(t.is_meta),
            })),
          );
        } else {
          setRegistryTools([]);
        }
      } catch {
        setRegistryTools([]);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [apiToken, resolveApiBase]);

  useEffect(() => { void fetchPerms(); }, [fetchPerms]);

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      setBusy(true);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiToken) headers["x-agx-desktop-token"] = apiToken;
        const base = await resolveApiBase();
        await fetch(`${base}/api/permissions`, {
          method: "PUT",
          headers,
          body: JSON.stringify(patch),
        });
        await fetchPerms();
      } finally {
        setBusy(false);
      }
    },
    [apiToken, resolveApiBase, fetchPerms],
  );

  const appendDeniedTool = useCallback(
    (rawName: string) => {
      const trimmed = rawName.trim();
      if (!trimmed) return;
      setDeniedTools((prev) => {
        if (prev.some((p) => p.trim() === trimmed)) return prev;
        const next = [...prev, trimmed];
        queueMicrotask(() => {
          void persist({ denied_tools: next });
        });
        return next;
      });
    },
    [persist],
  );

  useImperativeHandle(
    ref,
    () => ({
      flushPermissions: async () => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiToken) headers["x-agx-desktop-token"] = apiToken;
        const pathRulesPayload = pathRules.filter((r) => String(r.pattern ?? "").trim());
        const deniedCommandsPayload = deniedCommands.map((s) => String(s).trim()).filter(Boolean);
        const deniedToolsPayload = deniedTools.map((s) => String(s).trim()).filter(Boolean);
        try {
          const base = await resolveApiBase();
          const res = await fetch(`${base}/api/permissions`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              path_rules: pathRulesPayload,
              denied_commands: deniedCommandsPayload,
              denied_tools: deniedToolsPayload,
            }),
          });
          let detail = "";
          try {
            const j = (await res.json()) as { detail?: string; error?: string };
            if (!res.ok) {
              detail =
                (typeof j?.detail === "string" && j.detail) ||
                (typeof j?.error === "string" && j.error) ||
                "";
            }
          } catch {
            /* ignore */
          }
          if (!res.ok) {
            return { ok: false, error: detail || `HTTP ${res.status}` };
          }
          await fetchPerms();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
    [apiToken, resolveApiBase, pathRules, deniedCommands, deniedTools, fetchPerms],
  );

  if (loading) return null;

  return (
    <>
      <Panel title="路径权限规则">
        <div className="text-xs text-text-faint mb-2">
          按 glob 模式匹配文件路径，决定允许或拒绝访问。规则按顺序匹配，首个命中生效。
        </div>
        <div className="space-y-1.5">
          {pathRules.map((rule, idx) => (
            <div key={`pr-${idx}`} className="flex gap-2 items-center">
              <input
                className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1 text-sm font-mono"
                value={rule.pattern}
                placeholder="/etc/*"
                disabled={busy}
                onChange={(e) => {
                  const next = pathRules.map((r, i) => (i === idx ? { ...r, pattern: e.target.value } : r));
                  setPathRules(next);
                }}
                onBlur={() => void persist({ path_rules: pathRules })}
              />
              <select
                className="rounded-md border border-border bg-surface-panel px-1.5 py-1 text-xs"
                value={rule.allow ? "allow" : "deny"}
                disabled={busy}
                onChange={(e) => {
                  const next = pathRules.map((r, i) =>
                    i === idx ? { ...r, allow: e.target.value === "allow" } : r,
                  );
                  setPathRules(next);
                  void persist({ path_rules: next });
                }}
              >
                <option value="allow">允许</option>
                <option value="deny">拒绝</option>
              </select>
              <button
                type="button"
                className="shrink-0 rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  const next = pathRules.filter((_, i) => i !== idx);
                  setPathRules(next);
                  void persist({ path_rules: next });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => setPathRules((prev) => [...prev, { pattern: "", allow: false }])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            添加路径规则
          </button>
        </div>
      </Panel>

      <Panel title="命令拒绝列表">
        <div className="text-xs text-text-faint mb-2">
          fnmatch 模式匹配，命中的 shell 命令将被阻止执行。
        </div>
        <div className="space-y-1.5">
          {deniedCommands.map((cmd, idx) => (
            <div key={`dc-${idx}`} className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1 text-sm font-mono"
                value={cmd}
                placeholder="rm -rf *"
                disabled={busy}
                onChange={(e) => {
                  const next = deniedCommands.map((c, i) => (i === idx ? e.target.value : c));
                  setDeniedCommands(next);
                }}
                onBlur={() => void persist({ denied_commands: deniedCommands })}
              />
              <button
                type="button"
                className="shrink-0 rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  const next = deniedCommands.filter((_, i) => i !== idx);
                  setDeniedCommands(next);
                  void persist({ denied_commands: next });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => setDeniedCommands((prev) => [...prev, ""])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            添加命令模式
          </button>
        </div>
      </Panel>

      <Panel title="工具拒绝列表">
        <div className="text-xs text-text-faint mb-2">
          按 Studio 工具名做 fnmatch（例如 <code className="text-text-subtle">bash_exec</code>、
          <code className="text-text-subtle">mcp_call</code>、<code className="text-text-subtle">file_*</code>
          ）。命中后<strong className="text-text-primary">直接拒绝</strong>该工具调用，且<strong className="text-text-primary">不会</strong>再弹出执行确认（策略优先于询问）。
          工具名与<strong className="text-text-primary">设置 → 工具</strong>页预授权列表一致；亦可到该页查看说明。
        </div>
        {registryTools.length > 0 ? (
          <details className="mb-3 rounded-md border border-border bg-surface-panel px-2 py-1.5">
            <summary className="cursor-pointer text-xs font-medium text-text-primary">
              从已注册工具插入（共 {registryTools.length} 个）
            </summary>
            <div className="mt-2 space-y-2">
              <input
                type="search"
                className="w-full rounded-md border border-border bg-surface-card px-2 py-1 text-xs text-text-primary placeholder:text-text-faint"
                placeholder="筛选工具名或描述…"
                value={toolInsertFilter}
                disabled={busy}
                onChange={(e) => setToolInsertFilter(e.target.value)}
                aria-label="筛选工具列表"
              />
              <div className="max-h-40 overflow-y-auto rounded border border-border/60 bg-surface-card p-1.5">
                <div className="flex flex-wrap gap-1">
                  {filteredRegistryTools.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      disabled={busy}
                      title={t.description ? `${t.description.slice(0, 400)}` : t.name}
                      className="rounded border border-border bg-surface-panel px-1.5 py-0.5 font-mono text-[11px] text-text-primary transition hover:bg-surface-hover hover:border-text-subtle disabled:opacity-40"
                      onClick={() => appendDeniedTool(t.name)}
                    >
                      {t.name}
                      {t.is_meta ? (
                        <span className="ml-0.5 text-[9px] text-amber-400/90">meta</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {filteredRegistryTools.length === 0 ? (
                  <div className="py-2 text-center text-[11px] text-text-faint">无匹配项，清空筛选试试</div>
                ) : null}
              </div>
            </div>
          </details>
        ) : (
          <div className="mb-2 text-[11px] text-amber-400/90">
            未能加载工具注册表（需后端在线）。仍可手动输入工具名；完整列表见设置 → 工具页。
          </div>
        )}
        <datalist id="agx-studio-tool-names-datalist">
          {registryTools.map((t) => (
            <option key={t.name} value={t.name}>
              {(t.description ?? "").slice(0, 80)}
            </option>
          ))}
        </datalist>
        <div className="space-y-1.5">
          {deniedTools.map((toolPat, idx) => (
            <div key={`dt-${idx}`} className="flex gap-2">
              <input
                className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1 text-sm font-mono"
                value={toolPat}
                placeholder="bash_exec"
                list="agx-studio-tool-names-datalist"
                autoComplete="off"
                disabled={busy}
                onChange={(e) => {
                  const next = deniedTools.map((t, i) => (i === idx ? e.target.value : t));
                  setDeniedTools(next);
                }}
                onBlur={() => void persist({ denied_tools: deniedTools })}
              />
              <button
                type="button"
                className="shrink-0 rounded-md border border-border p-1.5 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  const next = deniedTools.filter((_, i) => i !== idx);
                  setDeniedTools(next);
                  void persist({ denied_tools: next });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => setDeniedTools((prev) => [...prev, ""])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            添加工具模式
          </button>
        </div>
      </Panel>
    </>
  );
});

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
        `后端返回非 JSON（可能是 API 地址不正确或未连到 agx serve）：HTTP ${res.status}，响应片段：${short}`,
      );
    }
  }, []);

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
          setMsg(`检测到环境变量覆盖：AGX_CC_BRIDGE_MODE=${envOverride}（当前生效模式：${effective}）`);
        }
        const idle = Number.isFinite(data.idle_stop_seconds as number)
          ? Math.max(0, Math.min(86400, Math.round(Number(data.idle_stop_seconds))))
          : 600;
        setIdleStopSeconds(String(idle));
      } else {
        setMsg(data.error || "加载失败");
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
          return { ok: false, error: "Bridge 配置仍在加载，请稍后再点窗口底部「保存」。" };
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
                ? `已保存（但当前被 AGX_CC_BRIDGE_MODE=${envOverride} 覆盖，生效模式：${effective}）`
                : "已保存";
            setMsg(hint);
            return { ok: true };
          }
          const d = data.detail;
          const errText = typeof d === "string" ? d : d != null ? JSON.stringify(d) : "保存失败";
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
    [apiToken, backendUrl, idleStopSeconds, loading, mode, parseJsonOrError, token, url],
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
        setMsg("已重新生成 token。请重启本机 `agx cc-bridge serve`（或下次启动 bridge）以使用相同 token。");
      } else {
        const d = data.detail;
        setMsg(typeof d === "string" ? d : d != null ? JSON.stringify(d) : "重新生成失败");
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Panel title="Claude Code 本机 Bridge">
        <div className="py-4 text-center text-xs text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="Claude Code 本机 Bridge">
      <div className="mb-2 space-y-1 text-xs text-text-subtle">
        <p>
          与终端中运行的 <code className="rounded bg-surface-panel px-0.5">agx cc-bridge serve</code>{" "}
          通信。首次使用会在本机配置中自动生成 token（与 Machi 工具 <code className="rounded bg-surface-panel px-0.5">cc_bridge_*</code>{" "}
          一致）。
        </p>
        <p className="text-text-faint">
          方式 B：先 <code className="rounded bg-surface-panel px-0.5">cc_bridge_start</code>，再{" "}
          <code className="rounded bg-surface-panel px-0.5">cc_bridge_send</code>；完成后用{" "}
          <code className="rounded bg-surface-panel px-0.5">test -f</code> / file_read 验收落盘。
        </p>
      </div>
      <div className="space-y-2">
        <div>
          <span className="mb-0.5 block text-[11px] font-medium text-text-muted">运行模式</span>
          <div className="flex flex-wrap gap-3 text-xs text-text-subtle">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="cc-bridge-mode"
                checked={mode === "headless"}
                disabled={busy}
                onChange={() => setMode("headless")}
              />
              Headless（stream-json，稳定）
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="cc-bridge-mode"
                checked={mode === "visible_tui"}
                disabled={busy}
                onChange={() => setMode("visible_tui")}
              />
              Visible TUI（交互界面，日志解析回填）
            </label>
          </div>
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-text-muted" htmlFor="cc-bridge-url">
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
            <label className="text-[11px] font-medium text-text-muted" htmlFor="cc-bridge-token">
              Bearer token
            </label>
            <button
              type="button"
              className="text-[10px] text-text-subtle underline hover:text-text-primary"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? "隐藏" : "显示"}
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
          <label className="mb-0.5 block text-[11px] font-medium text-text-muted" htmlFor="cc-bridge-idle-seconds">
            空闲自动停止（秒，0=关闭）
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
          运行模式、URL、token、空闲时间修改后，请点击窗口底部「保存」与「工具」页其它项一并写入本机配置。
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-amber-200 disabled:opacity-40"
            disabled={busy}
            onClick={() => void regen()}
          >
            重新生成 token
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={busy}
            onClick={() => void load()}
          >
            重新加载
          </button>
        </div>
        {msg ? <div className="text-xs text-text-subtle">{msg}</div> : null}
      </div>
    </Panel>
  );
});

const ToolsTab = forwardRef<ToolsTabHandle, Record<string, never>>(function ToolsTab(_props, ref) {
  const ccBridgePanelRef = useRef<CcBridgePanelHandle>(null);
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
  const [runtimeLoadError, setRuntimeLoadError] = useState("");

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
      else setError(regResult?.error ?? "加载工具注册表失败");
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
      } else {
        setRuntimeLoadError("读取运行时参数失败，仍可按当前滑块值保存。");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

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
          error: event.phase === "error" ? event.message || "安装失败" : undefined,
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
          return { ok: false, error: "工具列表仍在加载，请稍后再点窗口底部「保存」。" };
        }
        await saveBashDefaultTimeout();
        const rtRes = await window.agenticxDesktop.saveRuntimeConfig({
          max_tool_rounds: maxToolRounds,
        });
        if (!rtRes?.ok) {
          return {
            ok: false,
            error: rtRes?.error ? String(rtRes.error) : "运行时参数保存失败",
          };
        }
        const bridge = ccBridgePanelRef.current;
        if (!bridge) {
          return { ok: false, error: "Claude Code Bridge 区块未就绪，请稍后再试。" };
        }
        return bridge.save();
      },
    }),
    [loading, maxToolRounds, saveBashDefaultTimeout],
  );

  const startInstall = async (tool: ToolStatusItem) => {
    if (!tool.auto_installable) {
      const command = tool.install_command || "请参考官方文档安装";
      setInstalling((prev) => ({
        ...prev,
        [tool.id]: { requestId: `manual-${tool.id}`, percent: 0, phase: "manual_required", message: command },
      }));
      return;
    }
    const requestId = `${tool.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setInstalling((prev) => ({
      ...prev,
      [tool.id]: { requestId, percent: 0, phase: "starting", message: `开始安装 ${tool.name}...` },
    }));
    const result = await window.agenticxDesktop.installTool({ requestId, toolId: tool.id });
    if (!result?.ok) {
      setInstalling((prev) => ({
        ...prev,
        [tool.id]: { requestId, percent: 0, phase: "error", message: result?.error || "安装失败", error: result?.error || "安装失败" },
      }));
    }
  };

  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? registry.filter((t) => {
          const descZh = toolDisplayDescription(t.name, t.description).toLowerCase();
          return (
            t.name.toLowerCase().includes(q) ||
            (TOOL_LABELS[t.name] ?? "").toLowerCase().includes(q) ||
            descZh.includes(q) ||
            t.description.toLowerCase().includes(q) ||
            (CATEGORY_LABELS[t.category] ?? "").toLowerCase().includes(q)
          );
        })
      : registry;
    const map = new Map<string, RegistryTool[]>();
    for (const t of filtered) {
      const cat = t.category || "other";
      const arr = map.get(cat);
      if (arr) arr.push(t);
      else map.set(cat, [t]);
    }
    return CATEGORY_ORDER
      .filter((cat) => map.has(cat))
      .map((cat) => ({ category: cat, label: CATEGORY_LABELS[cat] ?? cat, tools: map.get(cat)! }));
  }, [registry, search]);

  if (loading) return <div className="py-8 text-center text-sm text-text-faint">加载工具状态中...</div>;

  return (
    <div className="space-y-4">
      <div className="text-sm text-text-subtle">
        管理 Agent 可调用工具的全局启停状态。关闭后 Agent 将无法调用该工具。
      </div>
      <div className="text-xs text-text-faint">
        仅部分工具提供可折叠的「高级设置」；其余工具仅支持启用/停用。窗口底部「保存」会一并提交本页 bash 默认超时、最大工具轮数与 Claude Code Bridge 配置。
      </div>
      <RuntimeConfigSection
        value={maxToolRounds}
        onChange={setMaxToolRounds}
        disabled={loading}
      />
      {runtimeLoadError ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          {runtimeLoadError}
        </div>
      ) : null}
      {error ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">{error}</div>
      ) : null}

      {/* ── 内建 Agent 工具 ── */}
      <Panel title={`预授权工具 (${registry.length})`} collapsible defaultCollapsed>
        <div className="mb-2 flex items-center gap-2">
          <input
            type="text"
            className="w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-xs text-text-primary placeholder:text-text-faint"
            placeholder="搜索工具..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-3">
          {grouped.map(({ category, label, tools: catTools }) => (
            <div key={category}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-faint">{label}</div>
              <div className="space-y-1">
                {catTools.map((t) => {
                  const enabled = policy[t.name] !== false;
                  const autoAdded = !(t.name in policy) || policy[t.name] === true;
                  const showAdvanced = ADVANCED_TOOL_POLICY_NAMES.has(t.name);
                  const advOpen = Boolean(advOpenByTool[t.name]);
                  return (
                    <div
                      key={t.name}
                      className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">{TOOL_LABELS[t.name] ?? t.name}</span>
                          {autoAdded && enabled ? (
                            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400">模式自动添加</span>
                          ) : !enabled ? (
                            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-300">禁用时需要人工审批</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-text-muted">{toolDisplayDescription(t.name, t.description)}</div>
                        {showAdvanced ? (
                          <div className="mt-2">
                            <button
                              type="button"
                              className="flex items-center gap-1 text-xs text-text-subtle transition hover:text-text-primary"
                              onClick={() =>
                                setAdvOpenByTool((prev) => ({ ...prev, [t.name]: !prev[t.name] }))
                              }
                              aria-expanded={advOpen}
                            >
                              <ChevronRight
                                className={`h-3.5 w-3.5 shrink-0 transition-transform ${advOpen ? "rotate-90" : ""}`}
                                aria-hidden
                              />
                              高级设置
                            </button>
                            {advOpen && t.name === "bash_exec" ? (
                              <div className="mt-2 space-y-1.5 pl-1">
                                <label className="block text-[11px] font-medium text-text-muted" htmlFor={`bash-timeout-${t.name}`}>
                                  默认超时（秒）
                                </label>
                                <input
                                  id={`bash-timeout-${t.name}`}
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
                                  模型仍可在单次调用中传{" "}
                                  <code className="rounded bg-surface-panel px-0.5">timeout_sec</code>{" "}
                                  覆盖；未传时使用此处默认值（范围 {BASH_DEFAULT_TIMEOUT_MIN}–{BASH_DEFAULT_TIMEOUT_MAX}{" "}
                                  秒）。保存后下一轮 <code className="rounded bg-surface-panel px-0.5">bash_exec</code>{" "}
                                  起生效。
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-0.5 shrink-0">
                        <SettingsSwitch
                          checked={enabled}
                          onChange={(next) => void toggleTool(t.name, next)}
                          aria-label={`启用工具 ${t.name}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && search ? (
            <div className="py-4 text-center text-xs text-text-faint">未找到匹配工具</div>
          ) : null}
        </div>
      </Panel>

      {/* ── 环境依赖（可安装的外部工具） ── */}
      <Panel title="环境依赖">
        <div className="mb-2 text-xs text-text-subtle">
          外部可执行文件依赖。全局安装一次后所有分身共享。
        </div>
        <div className="space-y-2">
          {envTools.map((tool) => {
            const installState = installing[tool.id];
            const isInstalling = Boolean(installState) && !["done", "error", "manual_required"].includes(installState.phase);
            const isManual = installState?.phase === "manual_required";
            const badge = tool.installed
              ? "已安装"
              : isInstalling ? "安装中" : isManual ? "需手动安装" : "未安装";
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
                      <div className="mt-0.5 text-[11px] text-text-faint">版本: {tool.version}</div>
                    ) : null}
                  </div>
                  {!tool.installed ? (
                    <button
                      type="button"
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                      onClick={() => void startInstall(tool)}
                      disabled={isInstalling}
                    >
                      {tool.auto_installable ? "安装" : "查看安装指南"}
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

function SkillsTab() {
  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<{ name: string; content: string } | null>(null);
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  const [expandedSkillName, setExpandedSkillName] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [bundles, setBundles] = useState<BundleItem[]>([]);
  const [bundleInstallPath, setBundleInstallPath] = useState("");
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleMsg, setBundleMsg] = useState("");
  const [marketQuery, setMarketQuery] = useState("");
  const [marketResults, setMarketResults] = useState<RegistrySearchItem[]>([]);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketMsg, setMarketMsg] = useState("");
  const [registryInstallBusy, setRegistryInstallBusy] = useState(false);
  const [bundlePendingPath, setBundlePendingPath] = useState("");
  const [bundleNeedsConfirmNonHigh, setBundleNeedsConfirmNonHigh] = useState(false);
  const [bundleNeedsConfirmHigh, setBundleNeedsConfirmHigh] = useState(false);
  const [marketPending, setMarketPending] = useState<RegistrySearchItem | null>(null);
  const [marketNeedsConfirmNonHigh, setMarketNeedsConfirmNonHigh] = useState(false);
  const [marketNeedsConfirmHigh, setMarketNeedsConfirmHigh] = useState(false);
  const [marketInstallingKey, setMarketInstallingKey] = useState<string | null>(null);
  const [marketQueuedKeys, setMarketQueuedKeys] = useState<string[]>([]);
  /** After marketplace install: pin this skill at top of its group and surface global section first. */
  const [recentMarketSkillName, setRecentMarketSkillName] = useState<string | null>(null);
  const [skillScanPresets, setSkillScanPresets] = useState<SkillScanPresetRow[]>([]);
  const [skillScanCustomPaths, setSkillScanCustomPaths] = useState<string[]>([]);
  const [preferredSkillSources, setPreferredSkillSources] = useState<Record<string, string>>({});
  /** Skill names globally disabled in ~/.agenticx/config.yaml (skills.disabled). */
  const [disabledSkillNames, setDisabledSkillNames] = useState<string[]>([]);
  const [skillScanBusy, setSkillScanBusy] = useState(false);
  const [skillScanMsg, setSkillScanMsg] = useState("");
  const [builtinSkillsExpanded, setBuiltinSkillsExpanded] = useState(false);
  const marketSearchSeqRef = useRef(0);
  const detailRequestSeqRef = useRef(0);
  const marketInstallQueueRef = useRef<RegistrySearchItem[]>([]);
  const skillsListAnchorRef = useRef<HTMLDivElement | null>(null);

  const addPane = useAppStore((s) => s.addPane);
  const setForwardAutoReply = useAppStore((s) => s.setForwardAutoReply);
  const closeSettings = useAppStore((s) => s.closeSettings);

  const [installPromptBusy, setInstallPromptBusy] = useState(false);
  const [skillhubQuery, setSkillhubQuery] = useState("");
  const [skillhubResults, setSkillhubResults] = useState<SkillHubRow[]>([]);
  const [skillhubLoading, setSkillhubLoading] = useState(false);
  const [skillhubMsg, setSkillhubMsg] = useState("");
  const [skillhubHint, setSkillhubHint] = useState("");
  const [recommendedIconData, setRecommendedIconData] = useState<Record<string, string>>({});

  useEffect(() => {
    setBundleNeedsConfirmNonHigh(false);
    setBundleNeedsConfirmHigh(false);
    setBundlePendingPath("");
  }, [bundleInstallPath]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const skill of RECOMMENDED_SKILLS) {
        try {
          const res = await window.agenticxDesktop.loadLocalImageDataUrl(skill.icon_src);
          if (res?.ok && res.dataUrl) {
            next[skill.id] = res.dataUrl;
          } else {
            next[skill.id] = skill.icon_src;
          }
        } catch {
          next[skill.id] = skill.icon_src;
        }
      }
      if (!cancelled) setRecommendedIconData(next);
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
        const [skillsRes, bundlesRes, scanRes] = await Promise.all([
          window.agenticxDesktop.loadSkills(),
          window.agenticxDesktop.loadBundles(),
          window.agenticxDesktop.getSkillSettings(),
        ]);
        if (!cancelled) {
          if (skillsRes.ok) setItems(skillsRes.items ?? []);
          else setErr(skillsRes.error ?? "加载技能失败");
          if (bundlesRes.ok) setBundles(bundlesRes.items ?? []);
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
            setSkillScanCustomPaths([...scanRes.custom_paths]);
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
      customs: string[],
      preferredSources: Record<string, string>,
      disabledSkills: string[],
    ) => {
      setSkillScanBusy(true);
      setSkillScanMsg("");
      try {
        const cleanedCustom = customs.map((x) => x.trim()).filter(Boolean);
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
            setSkillScanCustomPaths([...r.custom_paths]);
          }
          if (r.preferred_sources && typeof r.preferred_sources === "object") {
            setPreferredSkillSources({ ...r.preferred_sources });
          }
          if (Array.isArray(r.disabled_skills)) {
            setDisabledSkillNames([...r.disabled_skills]);
          }
          setSkillScanMsg("已保存扫描路径");
          await window.agenticxDesktop.refreshSkills();
          const skillsRes = await window.agenticxDesktop.loadSkills();
          if (skillsRes.ok) setItems(skillsRes.items ?? []);
        } else {
          setSkillScanMsg(r.error ?? "保存失败");
        }
      } catch (e) {
        setSkillScanMsg(String(e));
      } finally {
        setSkillScanBusy(false);
      }
    },
    [],
  );

  const onRefresh = async () => {
    setLoading(true);
    setErr("");
    setDetail(null);
    setExpandedSkillName(null);
    setBundleMsg("");
    setRecentMarketSkillName(null);
    try {
      await window.agenticxDesktop.refreshSkills();
      const [skillsRes, bundlesRes, scanRes] = await Promise.all([
        window.agenticxDesktop.loadSkills(),
        window.agenticxDesktop.loadBundles(),
        window.agenticxDesktop.getSkillSettings(),
      ]);
      if (skillsRes.ok) setItems(skillsRes.items ?? []);
      else setErr(skillsRes.error ?? "刷新失败");
      if (bundlesRes.ok) setBundles(bundlesRes.items ?? []);
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
        setSkillScanCustomPaths([...scanRes.custom_paths]);
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

  const reloadSkillsAndBundles = async () => {
    const [skillsRes, bundlesRes] = await Promise.all([
      window.agenticxDesktop.loadSkills(),
      window.agenticxDesktop.loadBundles(),
    ]);
    if (skillsRes.ok) setItems(skillsRes.items ?? []);
    if (bundlesRes.ok) setBundles(bundlesRes.items ?? []);
  };

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
          const err = created.error ?? "创建 Meta-Agent 会话失败";
          setSkillhubMsg(err);
          return;
        }
        const sid = created.session_id;
        const paneId = addPane(null, "Machi", sid);
        setForwardAutoReply({ paneId, sessionId: sid, text });
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

  const onSkillHubSearch = async () => {
    setSkillhubLoading(true);
    setSkillhubMsg("");
    setSkillhubHint("");
    try {
      const res = await window.agenticxDesktop.searchSkillHub({ q: skillhubQuery });
      if (!res.ok) {
        setSkillhubResults([]);
        setSkillhubMsg(res.error || "搜索失败");
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
      setSkillhubHint(typeof res.hint === "string" ? res.hint : "");
    } catch (e) {
      setSkillhubResults([]);
      setSkillhubMsg(String(e));
    } finally {
      setSkillhubLoading(false);
    }
  };

  const onInstallBundle = async () => {
    if (!bundleInstallPath.trim()) return;
    const sourcePath = bundleInstallPath.trim();
    setBundleBusy(true);
    setBundleMsg("");
    setBundleNeedsConfirmNonHigh(false);
    setBundleNeedsConfirmHigh(false);
    setBundlePendingPath("");
    try {
      setBundleMsg("正在扫描扩展包…");
      const prev = await window.agenticxDesktop.installBundlePreview({ sourcePath });
      if (!prev.ok) {
        setBundleMsg(`扫描未通过: ${prev.error ?? "未知错误"}`);
        return;
      }
      if (prev.scan) {
        setBundleMsg(formatSkillScanSummary(prev.scan));
      } else {
        setBundleMsg("未发现需要展示的扫描条目。");
      }

      const res = await window.agenticxDesktop.installBundle({ sourcePath });
      if (res.ok) {
        setBundleMsg(`已安装扩展包 "${res.name ?? ""}" v${res.version ?? ""}`);
        setBundleInstallPath("");
        await reloadSkillsAndBundles();
        return;
      }
      if (res.error_code === "non_high_risk_confirm_required") {
        setBundlePendingPath(sourcePath);
        setBundleNeedsConfirmNonHigh(true);
        if (res.scan_summary) {
          setBundleMsg(`${formatSkillScanSummary(res.scan_summary)}\n\n当前策略要求你点「确认安装」后再写入。`);
        } else {
          setBundleMsg("当前策略要求你点「确认安装」后再写入。");
        }
        return;
      }
      if (res.error_code === "high_risk_confirm_required") {
        setBundlePendingPath(sourcePath);
        setBundleNeedsConfirmHigh(true);
        if (res.scan_summary) {
          setBundleMsg(`${formatSkillScanSummary(res.scan_summary)}\n\n命中高危规则：请阅读摘要后点下方按钮确认。`);
        } else {
          setBundleMsg("命中高危规则：请阅读说明后点下方按钮确认。");
        }
        return;
      }
      setBundleMsg(`安装失败: ${res.error ?? "未知错误"}`);
    } catch (e) {
      setBundleMsg(`安装失败: ${String(e)}`);
    } finally {
      setBundleBusy(false);
    }
  };

  const onConfirmBundleInstall = async (kind: "non_high" | "high") => {
    if (!bundlePendingPath.trim()) return;
    setBundleBusy(true);
    try {
      const res = await window.agenticxDesktop.installBundle({
        sourcePath: bundlePendingPath.trim(),
        confirmNonHighRisk: kind === "non_high",
        acknowledgeHighRisk: kind === "high",
      });
      setBundleNeedsConfirmNonHigh(false);
      setBundleNeedsConfirmHigh(false);
      setBundlePendingPath("");
      if (res.ok) {
        setBundleMsg(`已安装扩展包 "${res.name ?? ""}" v${res.version ?? ""}`);
        setBundleInstallPath("");
        await reloadSkillsAndBundles();
      } else {
        setBundleMsg(`安装失败: ${res.error ?? "未知错误"}`);
      }
    } catch (e) {
      setBundleMsg(`安装失败: ${String(e)}`);
    } finally {
      setBundleBusy(false);
    }
  };

  const onUninstallBundle = async (name: string) => {
    setBundleBusy(true);
    setBundleMsg("");
    try {
      const res = await window.agenticxDesktop.uninstallBundle({ name });
      if (res.ok) {
        setBundleMsg(`已卸载扩展包 "${name}"`);
        setBundles((prev) => prev.filter((b) => b.name !== name));
        const skillsRes = await window.agenticxDesktop.loadSkills();
        if (skillsRes.ok) setItems(skillsRes.items ?? []);
      } else {
        setBundleMsg(`卸载失败: ${res.error ?? "未知错误"}`);
      }
    } catch (e) {
      setBundleMsg(`卸载失败: ${String(e)}`);
    } finally {
      setBundleBusy(false);
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
        if ((res.items ?? []).length === 0) setMarketMsg("未找到相关技能");
        else setMarketMsg("");
      } else {
        setMarketMsg(res.error ?? "搜索失败");
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
      setMarketMsg(`正在安装「${marketInstallingKey.split(":")[1]}」，已将「${item.name}」加入队列。`);
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
    setMarketMsg(`正在拉取并扫描「${item.name}」…`);
    let pauseQueue = false;
    try {
      const prev = await window.agenticxDesktop.installFromRegistryPreview({
        source: item.source,
        name: item.name,
      });
      if (!prev.ok) {
        const rawErr = String(prev.error ?? "未知错误");
        const is429 = rawErr.includes("rate limited (429)") || rawErr.includes("Too Many Requests");
        if (is429) {
          const secMatch = rawErr.match(/about (\d+)s/);
          const waitSec = secMatch ? Math.min(Number(secMatch[1]), 30) : 10;
          setMarketMsg(`拉取受限：ClawHub 限流中，${waitSec} 秒后自动重试…`);
          await new Promise((r) => setTimeout(r, waitSec * 1000));
          setMarketMsg(`正在重新拉取「${item.name}」…`);
          const retry = await window.agenticxDesktop.installFromRegistryPreview({
            source: item.source,
            name: item.name,
          });
          if (!retry.ok) {
            const retryErr = String(retry.error ?? "未知错误");
            setMarketMsg(`拉取失败：${retryErr}`);
            return;
          }
          Object.assign(prev, retry);
        } else if (rawErr.includes("fetch failed") || rawErr.includes("Failed to fetch skill")) {
          setMarketMsg(`拉取失败：${rawErr}`);
          return;
        } else {
          setMarketMsg(`扫描未通过：${rawErr}`);
          return;
        }
      }
      if (prev.scan) {
        setMarketMsg(formatSkillScanSummary(prev.scan));
      }

      const res = await window.agenticxDesktop.installFromRegistry({
        source: item.source,
        name: item.name,
      });
      if (res.ok) {
        setMarketMsg(`已安装 "${item.name}"`);
        await reloadSkillsAfterMarketInstall(String(res.name ?? item.name));
        return;
      }
      if (res.error_code === "non_high_risk_confirm_required") {
        setMarketPending(item);
        setMarketNeedsConfirmNonHigh(true);
        pauseQueue = true;
        if (res.scan_summary) {
          setMarketMsg(`${formatSkillScanSummary(res.scan_summary)}\n\n当前策略要求你点「确认安装」后再写入。`);
        } else {
          setMarketMsg("当前策略要求你点「确认安装」后再写入。");
        }
        return;
      }
      if (res.error_code === "high_risk_confirm_required") {
        setMarketPending(item);
        setMarketNeedsConfirmHigh(true);
        pauseQueue = true;
        if (res.scan_summary) {
          setMarketMsg(`${formatSkillScanSummary(res.scan_summary)}\n\n命中高危规则：请阅读摘要后点下方按钮确认。`);
        } else {
          setMarketMsg("命中高危规则：请阅读说明后点下方按钮确认。");
        }
        return;
      }
      setMarketMsg(`安装失败: ${res.error ?? "未知错误"}`);
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
        setMarketMsg(`已安装 "${pending.name}"`);
        await reloadSkillsAfterMarketInstall(String(res.name ?? pending.name));
      } else {
        setMarketMsg(`安装失败: ${res.error ?? "未知错误"}`);
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
      else setErr(res.error ?? "加载详情失败");
    } catch (e) {
      if (detailRequestSeqRef.current !== requestSeq) return;
      setErr(String(e));
    } finally {
      if (detailRequestSeqRef.current === requestSeq) {
        setLoadingDetail(false);
      }
    }
  };

  const filteredAll = search.trim()
    ? items.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const builtinFiltered = filteredAll.filter((s) => effectiveSkillSource(s) === "builtin");
  const filtered = filteredAll.filter((s) => effectiveSkillSource(s) !== "builtin");

  const projectSkills = pinSkillFirst(
    filtered.filter((s) => effectiveSkillLocation(s) === "project"),
    recentMarketSkillName
  );
  const globalSkills = pinSkillFirst(
    filtered.filter((s) => effectiveSkillLocation(s) !== "project"),
    recentMarketSkillName
  );
  const showGlobalSkillsFirst =
    Boolean(recentMarketSkillName) &&
    globalSkills.some((s) => s.name === recentMarketSkillName);

  if (loading) {
    return <div className="py-8 text-center text-sm text-text-faint">加载技能中...</div>;
  }

  return (
    <div className="space-y-3">
      <div ref={skillsListAnchorRef} className="text-sm text-text-subtle">
        技能（Skills）是注入给 Agent 的领域知识指令，告诉 AI 在特定任务中「怎么做」。
      </div>

      {/* Skill scan roots (presets + custom paths) */}
      <div className="space-y-3 rounded-md border border-border bg-surface-card p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">扫描路径</div>
        <p className="text-xs text-text-faint">
          项目内 <code className="text-text-muted">.agents/skills</code>、<code className="text-text-muted">.claude/skills</code>、<code className="text-text-muted">~/.agenticx/skills</code>（含 ClawHub 安装、智能体创建）以及内置包始终参与扫描。以下第三方根目录可按开关启用；也可添加自定义文件夹。
        </p>
        <div className="space-y-2">
          {skillScanPresets.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-md border border-border/60 bg-surface-panel/50 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="text-sm text-text-primary">{p.label}</span>
                <span className="mt-0.5 block font-mono text-[10px] text-text-faint">{p.path}</span>
              </span>
              <SettingsSwitch
                checked={p.enabled}
                disabled={skillScanBusy}
                aria-label={`切换 ${p.label}`}
                onChange={(next) => {
                  const updated = skillScanPresets.map((row) =>
                    row.id === p.id ? { ...row, enabled: next } : row,
                  );
                  setSkillScanPresets(updated);
                  void persistSkillScanSettings(updated, skillScanCustomPaths, preferredSkillSources, disabledSkillNames);
                }}
              />
            </div>
          ))}
        </div>
        <div className="text-xs font-medium text-text-subtle">自定义路径</div>
        <div className="space-y-2">
          {skillScanCustomPaths.map((row, i) => (
            <div key={`skill-custom-${i}`} className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-faint"
                placeholder="例如 ~/my-skills 或绝对路径"
                value={row}
                disabled={skillScanBusy}
                onChange={(e) => {
                  const next = [...skillScanCustomPaths];
                  next[i] = e.target.value;
                  setSkillScanCustomPaths(next);
                }}
                onBlur={(e) => {
                  const next = [...skillScanCustomPaths];
                  next[i] = e.target.value;
                  void persistSkillScanSettings(skillScanPresets, next, preferredSkillSources, disabledSkillNames);
                }}
              />
              <button
                type="button"
                className="shrink-0 rounded-md border border-border p-2 text-text-faint transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                disabled={skillScanBusy}
                title="移除"
                onClick={() => {
                  const next = skillScanCustomPaths.filter((_, j) => j !== i);
                  setSkillScanCustomPaths(next);
                  void persistSkillScanSettings(skillScanPresets, next, preferredSkillSources, disabledSkillNames);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={skillScanBusy}
            onClick={() => setSkillScanCustomPaths((prev) => [...prev, ""])}
          >
            <Plus className="h-3.5 w-3.5" />
            添加路径
          </button>
        </div>
        {skillScanMsg ? (
          <div
            className={`text-xs ${skillScanMsg.includes("失败") ? "text-amber-400" : "text-emerald-400"}`}
          >
            {skillScanMsg}
          </div>
        ) : null}
      </div>

      {/* Search + Refresh */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
          placeholder="搜索技能名称或描述..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
          onClick={() => void onRefresh()}
          disabled={loading}
        >
          刷新
        </button>
      </div>

      {err && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          {err}
        </div>
      )}

      {items.length === 0 && !err && (
        <div className="py-6 text-center text-sm text-text-faint">
          未发现任何技能。<br />
          <span className="text-xs text-text-subtle">
            可将 SKILL.md 放置在项目 .agents/skills/、开启上方的第三方扫描路径，或使用「自定义路径」。
          </span>
        </div>
      )}

      {/* Skills list grouped by location; after market install, global block first + pinned row */}
      <div className="space-y-3">
        {showGlobalSkillsFirst ? (
          <>
            <SkillsLocationSection
              skills={globalSkills}
              title="全局技能"
              locationLabel="全局"
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
              title="项目技能"
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
              title="项目技能"
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
              title="全局技能"
              locationLabel="全局"
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

        {builtinFiltered.length > 0 && (
          <div className="rounded-md border border-border bg-surface-card">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-subtle transition hover:bg-surface-hover"
              onClick={() => setBuiltinSkillsExpanded((v) => !v)}
            >
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${builtinSkillsExpanded ? "rotate-90" : ""}`}
              />
              <span>内置技能 ({builtinFiltered.length})</span>
            </button>
            {builtinSkillsExpanded && (
              <div className="space-y-1 border-t border-border px-3 py-2">
                {builtinFiltered.map((skill) => (
                  <SkillRowButton
                    key={skill.name}
                    skill={skill}
                    isActive={activeSkillName === skill.name}
                    isExpanded={expandedSkillName === skill.name}
                    detailLoading={expandedSkillName === skill.name && loadingDetail && detail?.name !== skill.name}
                    detailContent={expandedSkillName === skill.name && detail?.name === skill.name ? detail.content : null}
                    recentMarketSkillName={recentMarketSkillName}
                    locationLabel={effectiveSkillLocation(skill) === "project" ? "项目" : "全局"}
                    preferredSource={preferredSkillSources[skill.name]}
                    onChoosePreferredSource={choosePreferredSource}
                    onActivate={setActiveSkillName}
                    onExpandDetail={onExpandDetail}
                    onCollapseDetail={() => setExpandedSkillName(null)}
                    globalSkillEnabled={!disabledSkillNames.includes(skill.name)}
                    skillScanBusy={skillScanBusy}
                    onToggleGlobalSkill={toggleGlobalSkill}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* === Recommended official shortcuts === */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          推荐
        </div>
        <p className="mb-2 text-xs text-text-faint">
          以下为各产品官网入口，技能由对应提供方提供。请点击官网查看最新安装说明与授权要求。
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {RECOMMENDED_SKILLS.map((skill) => (
            <div
              key={skill.id}
              className="flex flex-col rounded-md border border-border bg-surface-card px-3 py-2.5 transition hover:bg-surface-hover/40"
            >
              <div className="flex items-start gap-2">
                <img
                  src={recommendedIconData[skill.id] || ""}
                  alt={`${skill.name} 图标`}
                  className="h-9 w-9 shrink-0 rounded-md border border-border/70 bg-white object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-text-primary">{skill.name}</span>
                    <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                      {skill.provider}
                    </span>
                    <span className="shrink-0 rounded-full border border-border/80 px-1.5 text-[10px] text-text-muted">
                      {skill.category}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{skill.description}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-border px-2.5 py-1 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                  onClick={() => window.open(skill.official_url, "_blank", "noopener,noreferrer")}
                >
                  官网 ↗
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* === ClawHub marketplace (registry aggregate) === */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          ClawHub 市场
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
            placeholder="搜索技能名称..."
            value={marketQuery}
            onChange={(e) => setMarketQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void onMarketSearch(); }}
          />
          <button
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            onClick={() => void onMarketSearch()}
            disabled={marketLoading}
          >
            {marketLoading ? "搜索中..." : "搜索"}
          </button>
        </div>
        {marketMsg && (
          <div
            className={`mt-1.5 whitespace-pre-wrap text-xs ${
              marketMsg.includes("失败") || marketMsg.includes("未找到")
                ? "text-amber-400"
                : marketNeedsConfirmNonHigh || marketNeedsConfirmHigh || marketMsg.includes("高危")
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
                {registryInstallBusy ? "安装中…" : "确认安装"}
              </button>
            )}
            {marketNeedsConfirmHigh && (
              <button
                type="button"
                className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
                disabled={registryInstallBusy}
                onClick={() => void onConfirmMarketInstall("high")}
              >
                {registryInstallBusy ? "安装中…" : "我已知晓风险，确认安装"}
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
              取消
            </button>
          </div>
        )}
        {marketResults.length > 0 && (
          <div className="mt-2 space-y-1">
            {marketResults.map((item) => (
              <div
                key={`${item.source}:${item.name}`}
                className="flex items-start gap-2 rounded-md border border-border bg-surface-card px-3 py-2"
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
                    ? "安装中…"
                    : marketQueuedKeys.includes(`${item.source}:${item.name}`)
                      ? "排队中…"
                      : "安装"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* === SkillHub (Tencent) marketplace === */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
            SkillHub 市场
          </div>
          <button
            type="button"
            className="text-[11px] text-text-faint underline decoration-border underline-offset-2 transition hover:text-[var(--settings-accent-fg)]"
            onClick={() => window.open("https://skillhub.tencent.com/", "_blank", "noopener,noreferrer")}
          >
            skillhub.tencent.com ↗
          </button>
        </div>
        <p className="mb-2 text-xs text-text-faint">
          搜索由本机 SkillHub CLI（若已安装）或已配置的 ClawHub 注册表提供；安装将跳转 Meta-Agent 会话并下发 SkillHub 官方安装指引中的指令。
        </p>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
            placeholder="搜索 SkillHub 技能名称或关键词..."
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
            {skillhubLoading ? "搜索中..." : "搜索"}
          </button>
        </div>
        {skillhubMsg && (
          <div
            className={`mt-1.5 whitespace-pre-wrap text-xs ${
              skillhubMsg.includes("失败") ? "text-amber-400" : "text-rose-400"
            }`}
          >
            {skillhubMsg}
          </div>
        )}
        {skillhubHint && (
          <div className="mt-1.5 text-xs text-text-faint">{skillhubHint}</div>
        )}
        {skillhubResults.length > 0 && (
          <div className="mt-2 space-y-1">
            {skillhubResults.map((item) => (
              <div
                key={item.slug}
                className="flex items-start gap-2 rounded-md border border-border bg-surface-card px-3 py-2"
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
                    {item.downloads != null && item.downloads !== "" ? ` · 下载 ${String(item.downloads)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    className="rounded border border-[var(--settings-accent-border-muted)] px-2 py-0.5 text-[10px] text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-subtle-bg)] disabled:opacity-40"
                    disabled={installPromptBusy}
                    onClick={() => onSkillHubMarketInstall(item.slug)}
                  >
                    安装
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-[10px] text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                    onClick={() =>
                      window.open(
                        `https://skillhub.tencent.com/skill/${encodeURIComponent(item.slug)}`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    详情 ↗
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* === Installed Bundles section === */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">
            已安装扩展包 ({bundles.length})
          </div>
        </div>

        {/* Install from local path */}
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
            placeholder="/path/to/my-bundle (包含 agx-bundle.yaml 的目录)"
            value={bundleInstallPath}
            onChange={(e) => setBundleInstallPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void onInstallBundle(); }}
          />
          <button
            className="shrink-0 rounded-md border border-[var(--settings-accent-border-muted)] px-3 py-1.5 text-xs text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-subtle-bg)] disabled:opacity-40"
            onClick={() => void onInstallBundle()}
            disabled={bundleBusy || !bundleInstallPath.trim()}
          >
            {bundleBusy ? "安装中..." : "安装"}
          </button>
        </div>
        {bundleMsg && (
          <div
            className={`mb-2 whitespace-pre-wrap text-xs ${
              bundleMsg.includes("失败") || bundleMsg.includes("扫描未通过")
                ? "text-rose-400"
                : bundleNeedsConfirmNonHigh || bundleNeedsConfirmHigh || bundleMsg.includes("高危") || bundleMsg.includes("确认安装")
                  ? "text-amber-300"
                  : "text-emerald-400"
            }`}
          >
            {bundleMsg}
          </div>
        )}
        {(bundleNeedsConfirmNonHigh || bundleNeedsConfirmHigh) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {bundleNeedsConfirmNonHigh && (
              <button
                type="button"
                className="rounded-md border border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)] px-3 py-1.5 text-xs text-[var(--settings-accent-fg-muted)] transition hover:bg-[var(--settings-accent-subtle-bg-hover)] disabled:opacity-40"
                disabled={bundleBusy}
                onClick={() => void onConfirmBundleInstall("non_high")}
              >
                {bundleBusy ? "安装中…" : "确认安装"}
              </button>
            )}
            {bundleNeedsConfirmHigh && (
              <button
                type="button"
                className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/20 disabled:opacity-40"
                disabled={bundleBusy}
                onClick={() => void onConfirmBundleInstall("high")}
              >
                {bundleBusy ? "安装中…" : "我已知晓风险，确认安装"}
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
              disabled={bundleBusy}
              onClick={() => {
                setBundleNeedsConfirmNonHigh(false);
                setBundleNeedsConfirmHigh(false);
                setBundlePendingPath("");
                setBundleMsg("");
              }}
            >
              取消
            </button>
          </div>
        )}

        {bundles.length === 0 ? (
          <div className="py-3 text-center text-xs text-text-faint">
            暂无已安装扩展包。使用上方路径安装 AGX Bundle。
          </div>
        ) : (
          <div className="space-y-1.5">
            {bundles.map((bundle) => (
              <div
                key={bundle.name}
                className="rounded-md border border-border bg-surface-card px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm font-medium text-text-primary">
                    {bundle.name}
                  </span>
                  <span className="shrink-0 rounded bg-surface-panel px-1.5 text-[10px] text-text-faint">
                    v{bundle.version}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-40"
                    disabled={bundleBusy}
                    onClick={() => void onUninstallBundle(bundle.name)}
                  >
                    卸载
                  </button>
                </div>
                {bundle.description && (
                  <p className="mt-0.5 truncate text-xs text-text-muted">{bundle.description}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {bundle.skills.length > 0 && (
                    <span className="rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                      {bundle.skills.length} 个技能
                    </span>
                  )}
                  {bundle.mcp_servers.length > 0 && (
                    <span className="rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                      {bundle.mcp_servers.length} 个 MCP
                    </span>
                  )}
                  {bundle.avatars.length > 0 && (
                    <span className="rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                      {bundle.avatars.length} 个分身预设
                    </span>
                  )}
                  {bundle.memory_templates.length > 0 && (
                    <span className="rounded-full border border-border px-1.5 text-[10px] text-text-faint">
                      {bundle.memory_templates.length} 个记忆模板
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmailSettingsTab() {
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
        if (!disposed) setMessage("读取配置失败，请稍后重试。");
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
      setMessage(res?.ok ? "测试邮件发送成功。" : `测试失败: ${res?.error ?? "未知错误"}`);
    } catch (err) {
      setMessage("测试失败，请检查 SMTP 配置与网络。");
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await window.agenticxDesktop.saveEmailConfig(form);
      setMessage(res?.ok ? "邮件配置已保存。" : `保存失败: ${res?.error ?? "未知错误"}`);
    } catch (err) {
      setMessage("保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-text-faint">加载邮件配置中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface-card p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-medium text-text-primary">SMTP 配置</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">启用邮件通知</span>
            <SettingsSwitch
              checked={form.enabled}
              onChange={(next) => updateField("enabled", next)}
              aria-label="启用邮件通知"
            />
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm text-text-muted">
            SMTP 预设
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={preset}
              onChange={(e) => onPresetChange(e.target.value as EmailPresetId)}
            >
              {EMAIL_PRESETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-text-muted">
            SMTP Host
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.smtp_host}
              onChange={(e) => updateField("smtp_host", e.target.value)}
              placeholder="smtp.qq.com"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-text-muted">
              SMTP Port
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={String(form.smtp_port)}
                onChange={(e) => updateField("smtp_port", Number(e.target.value) || 0)}
              />
            </label>
            <label className="block text-sm text-text-muted">
              TLS
              <select
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                value={form.smtp_use_tls ? "true" : "false"}
                onChange={(e) => updateField("smtp_use_tls", e.target.value === "true")}
              >
                <option value="true">启用</option>
                <option value="false">关闭</option>
              </select>
            </label>
          </div>

          <label className="block text-sm text-text-muted">
            SMTP 用户名
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.smtp_username}
              onChange={(e) => updateField("smtp_username", e.target.value)}
              placeholder="your_email@qq.com"
            />
          </label>

          <label className="block text-sm text-text-muted">
            SMTP 授权码 / 密码
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.smtp_password}
              onChange={(e) => updateField("smtp_password", e.target.value)}
              placeholder="应用专用密码"
            />
          </label>

          <label className="block text-sm text-text-muted">
            发件邮箱
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.from_email}
              onChange={(e) => updateField("from_email", e.target.value)}
              placeholder="your_email@qq.com"
            />
          </label>

          <label className="block text-sm text-text-muted">
            默认收件邮箱
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
              value={form.default_to_email}
              onChange={(e) => updateField("default_to_email", e.target.value)}
              placeholder="bingzhenli@hotmail.com"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover disabled:opacity-40"
          onClick={onTestSend}
          disabled={testing || saving}
        >
          {testing ? "测试中..." : "测试发送"}
        </button>
        <button
          className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
          onClick={onSave}
          disabled={testing || saving}
        >
          {saving ? "保存中..." : "保存邮件配置"}
        </button>
        {message && <div className="text-xs text-text-subtle">{message}</div>}
      </div>
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
      setErr("未连接 Studio，无法加载收藏");
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
    return <div className="py-8 text-center text-sm text-text-faint">未连接 Studio，无法加载收藏</div>;
  }
  if (loading) {
    return <div className="py-8 text-center text-sm text-text-faint">加载中…</div>;
  }
  if (err && items.length === 0 && !loading) {
    return <div className="py-8 text-center text-sm text-rose-400">{err}</div>;
  }
  if (items.length === 0) {
    return <div className="py-8 text-center text-sm text-text-faint">暂无收藏</div>;
  }

  return (
    <div className="space-y-2">
      {err ? <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">{err}</div> : null}
      <p className="mb-3 text-xs text-text-subtle">
        以下为全局收藏（按保存时间倒序）。同一条消息重复收藏不会重复写入。
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
        const content = String(row.content ?? "").trim() || "（无文本）";
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
          ? row.tags.map((t) => String(t).trim()).filter(Boolean)
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
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-border bg-surface-panel px-2 py-0.5 text-[11px] text-text-muted"
                    >
                      #{t}
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
                    {editing.tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-card px-2 py-0.5 text-[11px] text-text-muted"
                      >
                        {t}
                        <button
                          type="button"
                          className="text-text-faint hover:text-rose-400"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() =>
                            setEditing((prev) =>
                              prev && prev.messageId === mid
                                ? { ...prev, tags: prev.tags.filter((x) => x !== t) }
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
                      placeholder="输入新标签后按 Enter"
                      className="min-w-[8rem] flex-1 rounded border border-border bg-surface-card px-2 py-1 text-xs text-text-primary outline-none focus:border-[var(--settings-accent-focus)]"
                    />
                    <button
                      type="button"
                      disabled={tagSaving}
                      className="rounded border border-border px-2 py-1 text-xs text-text-subtle hover:bg-surface-hover disabled:opacity-40"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void patchTags(mid, editing.tags)}
                    >
                      {tagSaving ? "保存中…" : "保存"}
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
                      setErr("复制失败");
                    }
                  }}
                >
                  {copiedId === mid ? "已复制" : "复制"}
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
                  转发
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
                  编辑标签
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
                  删除
                </button>
                {sid ? <span className="text-text-faint">会话 {sid.slice(0, 8)}…</span> : null}
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
  const trackClass = size === "sm" ? "h-5 w-9" : "h-7 w-12";
  const knobClass = size === "sm" ? "left-0.5 top-0.5 h-4 w-4" : "left-0.5 top-0.5 h-6 w-6";
  const knobTranslate = size === "sm" ? "translate-x-4" : "translate-x-5";
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
      className={`relative ${trackClass} shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/55 disabled:opacity-40 ${
        checked ? "bg-emerald-500" : "bg-surface-hover"
      }`}
    >
      <span
        className={`pointer-events-none absolute ${knobClass} rounded-full bg-white shadow-sm transition-transform ${
          checked ? knobTranslate : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** 桌面操控开关：在「通用」Tab，不在工作区。 */
function ComputerUseGeneralPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadComputerUseConfig();
        if (!disposed && result?.ok && result.config) {
          setEnabled(Boolean(result.config.enabled));
        }
      } catch {
        if (!disposed) setMessage("读取桌面操控配置失败。");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const persist = async (next: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveComputerUseConfig({ enabled: next });
      if (!result?.ok) {
        const detail = result?.error ? String(result.error) : "保存失败。";
        setMessage(detail);
        setEnabled(!next);
        return;
      }
      setEnabled(next);
      setMessage(
        "已保存到本机配置。请完全退出 Machi 后重新打开（勿仅关闭窗口）；内置助手会随应用一起重启并加载新设置。若使用「设置 → 服务器连接」中的远程模式，请在服务器环境同步该配置并重启远端服务。"
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败。");
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Panel title="桌面操控">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="桌面操控">
      <p className="mb-3 text-xs text-text-faint">
        写入本机 <code className="text-text-subtle">~/.agenticx/config.yaml</code> 中的{" "}
        <code className="text-text-subtle">computer_use.enabled</code>。开启后由 Machi 随应用启动的内置助手读取该开关并尝试加载桌面级能力。若对话里仍看不到相关工具，请确认已安装包含该能力的 Machi 版本；修改后需完全退出并重新打开 Machi（远程模式见保存成功后的说明）。
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-subtle">
          启用桌面操控（桌面级截屏 / 键鼠等，需权限与依赖）
        </span>
        <SettingsSwitch
          checked={enabled}
          disabled={saving}
          onChange={(next) => void persist(next)}
          aria-label="启用桌面操控"
        />
      </div>
      {message ? (
        <div
          className={`mt-2 text-xs ${message.startsWith("已保存到本机配置") ? "text-text-muted" : "text-rose-400"}`}
        >
          {message}
        </div>
      ) : null}
    </Panel>
  );
}

const TRINITY_DEFAULTS: TrinityConfigForm = {
  skill_protocol: true,
  session_summary: false,
  learning_enabled: false,
  skill_manage_enabled: false,
  learning_nudge_interval: 10,
  learning_min_tool_calls: 5,
};

function useTrinityConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TrinityConfigForm>({ ...TRINITY_DEFAULTS });
  const [message, setMessage] = useState("");
  const [lastSaved, setLastSaved] = useState<TrinityConfigForm>({ ...TRINITY_DEFAULTS });

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadTrinityConfig();
        if (!disposed && result?.ok && result.config) {
          const loaded: TrinityConfigForm = {
            skill_protocol: Boolean(result.config.skill_protocol),
            session_summary: Boolean(result.config.session_summary),
            learning_enabled: Boolean(result.config.learning_enabled),
            skill_manage_enabled: Boolean(result.config.skill_manage_enabled),
            learning_nudge_interval:
              Number(result.config.learning_nudge_interval) > 0
                ? Number(result.config.learning_nudge_interval)
                : TRINITY_DEFAULTS.learning_nudge_interval,
            learning_min_tool_calls:
              Number(result.config.learning_min_tool_calls) > 0
                ? Number(result.config.learning_min_tool_calls)
                : TRINITY_DEFAULTS.learning_min_tool_calls,
          };
          setForm(loaded);
          setLastSaved(loaded);
        } else if (!disposed) {
          setMessage(result?.error ? String(result.error) : "读取配置失败。");
        }
      } catch {
        if (!disposed) setMessage("读取配置失败。");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => { disposed = true; };
  }, []);

  const update = useCallback(async (patch: Partial<TrinityConfigForm>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveTrinityConfig(next);
      if (!result?.ok) {
        setForm(lastSaved);
        setMessage(result?.error ? String(result.error) : "保存失败。");
        return;
      }
      setLastSaved(next);
      setMessage("已保存。完全退出 Machi 后重新打开生效。");
    } catch (e) {
      setForm(lastSaved);
      setMessage(e instanceof Error ? e.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }, [form, lastSaved]);

  return { loading, saving, form, message, update };
}

function useSkillInstallPolicy() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nonHighRiskAutoInstall, setNonHighRiskAutoInstall] = useState(true);
  const [lastSaved, setLastSaved] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadSkillInstallPolicy();
        if (!disposed && result?.ok && result.config) {
          const v = Boolean(result.config.non_high_risk_auto_install);
          setNonHighRiskAutoInstall(v);
          setLastSaved(v);
        } else if (!disposed) {
          setMessage(result?.error ? String(result.error) : "读取技能安装策略失败。");
        }
      } catch {
        if (!disposed) setMessage("读取技能安装策略失败。");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const updatePolicy = useCallback(async (next: boolean) => {
    setNonHighRiskAutoInstall(next);
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveSkillInstallPolicy({
        non_high_risk_auto_install: next,
      });
      if (!result?.ok) {
        setNonHighRiskAutoInstall(lastSaved);
        setMessage(result?.error ? String(result.error) : "保存失败。");
        return;
      }
      setLastSaved(next);
      setMessage("已保存。之后装扩展包或从 ClawHub 安装的技能时，是否跳过确认由本开关与安装前扫描结果一起决定（与后端共用同一份配置）。");
    } catch (e) {
      setNonHighRiskAutoInstall(lastSaved);
      setMessage(e instanceof Error ? e.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }, [lastSaved]);

  return { loading, saving, nonHighRiskAutoInstall, message, updatePolicy };
}

function SkillAdvancedPanel() {
  const { loading: trinityLoading, saving: trinitySaving, form, message: trinityMessage, update } =
    useTrinityConfig();
  const {
    loading: policyLoading,
    saving: policySaving,
    nonHighRiskAutoInstall,
    message: policyMessage,
    updatePolicy,
  } = useSkillInstallPolicy();

  const loading = trinityLoading || policyLoading;
  const busy = trinitySaving || policySaving;
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
      <Panel title="技能高级设置">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="技能高级设置">
      <p className="mb-3 text-xs text-text-faint">
        写入 <code className="text-text-subtle">~/.agenticx/config.yaml</code>，重启后生效。
      </p>
      <div className="space-y-3">
        <SettingsToggleCard
          title="技能文档优先"
          description="当任务命中已安装技能时，优先按该技能里的步骤与约束来选工具和执行顺序。"
          checked={form.skill_protocol}
          disabled={busy}
          onChange={(next) => void update({ skill_protocol: next })}
        />
        <SettingsToggleCard
          title="允许助手改本地技能"
          description="开启后，模型可以在授权范围内新增、改写或删除 ~/.agenticx 下的技能文件（仍受后端 skill_manage 开关约束）。"
          checked={form.skill_manage_enabled}
          disabled={busy}
          onChange={(next) => void update({ skill_manage_enabled: next })}
        />
        <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-text-strong">启用技能自进化</div>
              <p className="mt-1 text-xs leading-relaxed text-text-muted">
                自动记录工具调用过程，会话结束后评估是否值得提炼为新技能。
              </p>
            </div>
            <SettingsSwitch
              checked={form.learning_enabled}
              disabled={busy}
              onChange={(next) => void update({ learning_enabled: next })}
              aria-label="启用技能自进化"
            />
          </div>
          <div className="mt-2.5 rounded-md bg-surface-panel px-3 py-2 text-[11px] text-text-faint">
            观测数据存储于 <code className="text-text-subtle">~/.agenticx/sessions/&lt;session_id&gt;/tool_call_observations.json</code>
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
              高级设置
            </button>
            {reviewAdvancedOpen ? (
              <div className="mt-2 space-y-3">
                <label className="block text-sm text-text-muted">
                  复盘触发间隔
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
                <label className="block text-sm text-text-muted">
                  最小工具调用数
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
        <SettingsToggleCard
          title="未见高危则自动装完"
          description="安装前仍会跑一遍静态规则扫描并展示摘要；只有未命中高危规则时才可能一路装完，一旦命中高危必须你点确认。"
          checked={nonHighRiskAutoInstall}
          disabled={busy}
          onChange={(next) => void updatePolicy(next)}
        />
      </div>
      {trinityMessage ? (
        <div
          className={`mt-2 text-xs ${trinityMessage.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}
        >
          {trinityMessage}
        </div>
      ) : null}
      {policyMessage ? (
        <div
          className={`mt-2 text-xs ${policyMessage.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}
        >
          {policyMessage}
        </div>
      ) : null}
    </Panel>
  );
}

function SessionMemoryPanel() {
  const { loading, saving, form, message, update } = useTrinityConfig();

  if (loading) {
    return (
      <Panel title="会话与记忆">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="会话与记忆">
      <p className="mb-3 text-xs text-text-faint">
        写入 <code className="text-text-subtle">~/.agenticx/config.yaml</code>，重启后生效。
      </p>
      <div className="space-y-3 text-sm text-text-subtle">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div>启用会话摘要延续</div>
            <div className="mt-0.5 text-[11px] text-text-faint">新会话可继承前次摘要上下文</div>
          </div>
          <SettingsSwitch
            checked={form.session_summary}
            disabled={saving}
            onChange={(next) => void update({ session_summary: next })}
            aria-label="启用会话摘要延续"
          />
        </div>
      </div>
      {message ? (
        <div className={`mt-2 text-xs ${message.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}>
          {message}
        </div>
      ) : null}
    </Panel>
  );
}

function formatSkillScanSummary(scan: {
  overall: string;
  skills: Array<{
    skill_name: string;
    verdict: string;
    findings?: Array<{
      pattern_name: string;
      severity?: string;
      matched_text?: string;
    }>;
  }>;
}): string {
  const verdictLabel = (v: string) =>
    v === "dangerous" ? "高危" : v === "caution" ? "需注意" : "未见高危规则";
  const sevLabel = (s: string | undefined) =>
    s === "dangerous" ? "⛔ 高危" : s === "caution" ? "⚠ 注意" : s ?? "";
  const patternLabel: Record<string, string> = {
    exfiltration_curl: "数据外泄（curl）",
    exfiltration_wget: "数据外泄（wget）",
    exfiltration_fetch_env: "读取环境变量并上传",
    credential_ssh: "访问 SSH 密钥",
    credential_dotenv: "引用 .env 文件",
    credential_word: "涉及凭据/密码关键词",
    prompt_ignore_previous: "提示词注入（忽略先前指令）",
    prompt_system: "提示词注入（system prompt）",
    prompt_system_tag: "提示词注入（<system> 标签）",
    destructive_rm: "破坏性操作（rm -rf /）",
    destructive_chmod: "破坏性操作（chmod 777）",
    destructive_sql: "破坏性操作（DROP TABLE）",
  };

  const lines = [
    `安装前扫描 · 总体：${verdictLabel(scan.overall)}`,
  ];
  for (const s of scan.skills) {
    lines.push(
      `· ${s.skill_name || "skill"}：${verdictLabel(s.verdict)}${
        s.findings?.length ? `（命中 ${s.findings.length} 条规则）` : ""
      }`
    );
    if (s.findings?.length) {
      for (const f of s.findings) {
        const label = patternLabel[f.pattern_name] || f.pattern_name;
        const matched = f.matched_text ? `「${f.matched_text.slice(0, 60)}」` : "";
        lines.push(`  ${sevLabel(f.severity)} ${label}${matched ? " — " + matched : ""}`);
      }
    }
  }
  return lines.join("\n");
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
        <div className="text-sm font-semibold text-text-strong">{title}</div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
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

function WorkspaceSettingsTab() {
  return (
    <div className="space-y-4">
      <label className="block text-sm text-text-muted">
        默认工作区目录
        <input className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle" value="~/.agenticx/workspace" readOnly />
        <span className="mt-1 block text-xs text-text-faint">修改工作区目录请编辑 ~/.agenticx/config.yaml 中的 workspace_dir 字段</span>
      </label>
      <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs text-text-subtle">
        每个分身拥有独立工作区，位于 ~/.agenticx/avatars/&lt;id&gt;/workspace。
      </div>
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
  confirmStrategy,
  theme,
  chatStyle,
  onThemeChange,
  onChatStyleChange,
  onConfirmStrategyChange,
  onClose,
  onSave,
  panes,
  avatars,
  groups,
  onForwardFavorite,
}: Props) {
  const userNickname = useAppStore((s) => s.userNickname);
  const setUserNickname = useAppStore((s) => s.setUserNickname);
  const userAvatarUrl = useAppStore((s) => s.userAvatarUrl);
  const setUserAvatarUrl = useAppStore((s) => s.setUserAvatarUrl);
  const userPreference = useAppStore((s) => s.userPreference);
  const setUserPreference = useAppStore((s) => s.setUserPreference);
  const metaAvatarUrl = useAppStore((s) => s.metaAvatarUrl);
  const effectiveMetaAvatarUrl = metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL;
  const setMetaAvatarUrl = useAppStore((s) => s.setMetaAvatarUrl);
  const settingsOpenToTab = useAppStore((s) => s.settings.openToTab);
  const updateSettingsSlice = useAppStore((s) => s.updateSettings);
  const initializedForOpenRef = useRef(false);
  const toolsTabRef = useRef<ToolsTabHandle>(null);
  const knowledgeRef = useRef<KnowledgeSettingsHandle>(null);
  const permissionsPanelRef = useRef<PermissionsAdvancedPanelHandle>(null);
  const [tab, setTab] = useState<SettingsTab>("general");
  useEffect(() => {
    if (!open || !settingsOpenToTab) return;
    setTab(settingsOpenToTab);
    updateSettingsSlice({ openToTab: undefined });
  }, [open, settingsOpenToTab, updateSettingsSlice]);
  const [active, setActive] = useState(defaultProvider || ALL_PROVIDERS[0]);
  const [draft, setDraft] = useState<Record<string, ProviderEntry>>({});
  const [defProv, setDefProv] = useState(defaultProvider);
  const [keyStatus, setKeyStatus] = useState<Record<string, "idle" | "checking" | "ok" | "fail">>({});
  const [keyError, setKeyError] = useState<Record<string, string>>({});
  const [modelHealthMap, setModelHealthMap] = useState<Record<string, ModelHealthEntry>>({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [addModelModalOpen, setAddModelModalOpen] = useState(false);
  const [addModelFormId, setAddModelFormId] = useState("");
  const [addModelFormName, setAddModelFormName] = useState("");
  const [addServiceVendorModalOpen, setAddServiceVendorModalOpen] = useState(false);
  const [addVendorFormName, setAddVendorFormName] = useState("");
  const [editModelModalOpen, setEditModelModalOpen] = useState(false);
  const [editModelOriginalId, setEditModelOriginalId] = useState("");
  const [editModelFormId, setEditModelFormId] = useState("");
  const [editModelError, setEditModelError] = useState<string | null>(null);
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
  const [mcpMarketplaceSearch, setMcpMarketplaceSearch] = useState("");
  const [mcpMarketplaceInstallBusy, setMcpMarketplaceInstallBusy] = useState(false);
  const [mcpMarketplaceEnvSchema, setMcpMarketplaceEnvSchema] = useState<{ required: string[] }>({ required: [] });
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [mcpEditorPath, setMcpEditorPath] = useState(MCP_PRIMARY_CONFIG_PATH);

  const [serverMode, setServerMode] = useState<"local" | "remote">("local");
  const [serverUrl, setServerUrl] = useState("");
  const [serverToken, setServerToken] = useState("");
  const [serverTestStatus, setServerTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [serverTestError, setServerTestError] = useState("");
  const [serverShowToken, setServerShowToken] = useState(false);
  const [metaSoul, setMetaSoul] = useState("");
  const [metaSoulSaving, setMetaSoulSaving] = useState(false);
  const [metaSoulMessage, setMetaSoulMessage] = useState("");
  const [userAvatarMessage, setUserAvatarMessage] = useState("");
  const [metaAvatarMessage, setMetaAvatarMessage] = useState("");

  const [gwEnabled, setGwEnabled] = useState(false);
  const [gwUrl, setGwUrl] = useState("");
  const [gwDeviceId, setGwDeviceId] = useState("");
  const [gwToken, setGwToken] = useState("");
  const [gwStudioBase, setGwStudioBase] = useState("");
  const [gwShowToken, setGwShowToken] = useState(false);
  const [gwAdvancedOpen, setGwAdvancedOpen] = useState(false);
  const [gwQrOpen, setGwQrOpen] = useState(false);
  // WeChat iLink sidecar
  const [wechatStatus, setWechatStatus] = useState<"idle" | "binding" | "connected" | "expired" | "error">("idle");
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

  useEffect(() => {
    if (!open || tab !== "server") return;
    void refreshGwBindings();
  }, [open, tab, refreshGwBindings]);

  useEffect(() => {
    // Reset the guard when dialog is closed.
    if (!open) {
      initializedForOpenRef.current = false;
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
    setProviderEnableHint(null);
    setDefaultProvHint(null);
    setDefProv(defaultProvider || ALL_PROVIDERS[0]);
    setActive(defaultProvider || ALL_PROVIDERS[0]);
    setKeyStatus({});
    setKeyError({});
    setModelHealthMap({});
    setMcpMessage("");
    setMetaSoulMessage("");
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
    void window.agenticxDesktop.wechatSidecarPort().then((res) => {
      if (res.running && res.port > 0) {
        fetch(`http://127.0.0.1:${res.port}/status`)
          .then((r) => r.json())
          .then((data: { connected?: boolean; bot_id?: string; status?: string }) => {
            if (data.connected) {
              setWechatStatus("connected");
              setWechatBotId(data.bot_id || "");
            } else if (data.bot_id) {
              setWechatStatus("idle");
              setWechatBotId(data.bot_id);
            }
          })
          .catch(() => {});
      }
    });
    void window.agenticxDesktop.loadMetaSoul().then((res) => {
      if (res?.ok) {
        setMetaSoul(res.content || "");
      } else {
        setMetaSoul("");
      }
    });
    if (sessionId) void onRefreshMcp(sessionId);
  }, [open, providers, defaultProvider, sessionId, onRefreshMcp]);

  const saveMetaSoul = useCallback(async () => {
    setMetaSoulSaving(true);
    setMetaSoulMessage("");
    try {
      const res = await window.agenticxDesktop.saveMetaSoul({ content: metaSoul });
      if (res?.ok) {
        setMetaSoulMessage("Meta-Agent SOUL 已保存。下一轮对话生效。");
      } else {
        setMetaSoulMessage(`保存失败: ${res?.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMetaSoulMessage(`保存失败: ${String(err)}`);
    } finally {
      setMetaSoulSaving(false);
    }
  }, [metaSoul]);

  const handleProfileAvatarUpload = useCallback(
    (file: File, target: "user" | "meta") => {
      const maxBytes = 1.8 * 1024 * 1024;
      if (!file.type.startsWith("image/")) {
        (target === "user" ? setUserAvatarMessage : setMetaAvatarMessage)(
          "请选择图片文件（PNG/JPG/WebP/GIF）。"
        );
        return;
      }
      if (file.size > maxBytes) {
        (target === "user" ? setUserAvatarMessage : setMetaAvatarMessage)(
          "图片过大，请选择小于 1.8MB 的文件。"
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (!result) {
          (target === "user" ? setUserAvatarMessage : setMetaAvatarMessage)("读取图片失败，请重试。");
          return;
        }
        if (target === "user") {
          setUserAvatarUrl(result);
          setUserAvatarMessage("已更新我的头像。");
        } else {
          setMetaAvatarUrl(result);
          setMetaAvatarMessage("已更新 Machi 头像。");
        }
      };
      reader.onerror = () => {
        (target === "user" ? setUserAvatarMessage : setMetaAvatarMessage)("读取图片失败，请重试。");
      };
      reader.readAsDataURL(file);
    },
    [setMetaAvatarUrl, setUserAvatarUrl]
  );

  useEffect(() => {
    if (!open || tab !== "mcp") return;
    void window.agenticxDesktop.getMcpSettings().then((r) => {
      if (r.ok && Array.isArray(r.extra_search_paths)) {
        setMcpExtraPaths([...r.extra_search_paths]);
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
          setMcpMessage("已保存 MCP 配置路径");
          if (sessionId) await onRefreshMcp(sessionId);
        } else {
          setMcpMessage(`保存路径失败: ${r.error ?? "未知错误"}`);
        }
      } catch (err) {
        setMcpMessage(`保存路径失败: ${String(err)}`);
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
      interface: raw.interface === "openai" ? "openai" : undefined,
    };
  }, [draft, active]);

  useEffect(() => {
    setApiKeyVisible(false);
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

  const onValidateKey = async () => {
    if (!current.apiKey) return;
    setKeyStatus((p) => ({ ...p, [active]: "checking" }));
    setKeyError((p) => ({ ...p, [active]: "" }));
    const res = await window.agenticxDesktop.validateKey({ provider: active, apiKey: current.apiKey, baseUrl: current.baseUrl || undefined });
    setKeyStatus((p) => ({ ...p, [active]: res.ok ? "ok" : "fail" }));
    if (!res.ok) setKeyError((p) => ({ ...p, [active]: res.error ?? "未知错误" }));
  };

  const onFetchModels = async () => {
    if (!current.apiKey) return;
    setFetchingModels(true);
    const res = await window.agenticxDesktop.fetchModels({ provider: active, apiKey: current.apiKey, baseUrl: current.baseUrl || undefined });
    setFetchingModels(false);
    if (res.ok && res.models.length > 0) updateField("models", res.models);
  };

  const onHealthCheck = async (model: string) => {
    const key = `${active}:${model}`;
    setModelHealthMap((p) => ({ ...p, [key]: { phase: "checking" } }));
    const res = await window.agenticxDesktop.healthCheckModel({
      provider: active,
      apiKey: current.apiKey,
      baseUrl: current.baseUrl || undefined,
      model,
    });
    const ms = typeof res.latencyMs === "number" ? res.latencyMs : 0;
    setModelHealthMap((p) => ({
      ...p,
      [key]: res.ok ? { phase: "ok", ms } : { phase: "error" },
    }));
  };

  const onBatchHealthCheck = async () => {
    if (!current.apiKey?.trim() || current.models.length === 0) return;
    for (const m of current.models) {
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
      const ms = typeof res.latencyMs === "number" ? res.latencyMs : 0;
      setModelHealthMap((p) => ({
        ...p,
        [key]: res.ok ? { phase: "ok", ms } : { phase: "error" },
      }));
    }
  };

  const onRemoveModel = (model: string) => updateField("models", current.models.filter((m) => m !== model));

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
  };

  const submitAddServiceVendorFromModal = () => {
    const name = addVendorFormName.trim();
    if (!name) return;
    const id = makeCustomOpenAIProviderId(name, Object.keys(draft));
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
        interface: "openai",
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
      setEditModelError("列表中已有相同的模型 ID");
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

  /** Normalize base_url: strip trailing slash; if no version segment (/v1, /v2…), append /v1. */
  const normalizeBaseUrl = (url: string): string => {
    const b = url.trim().replace(/\/+$/, "");
    if (!b) return b;
    return /\/v\d(\/|$)/.test(b) ? b : `${b}/v1`;
  };

  const handleSave = async () => {
    const permRes = await permissionsPanelRef.current?.flushPermissions?.();
    if (permRes && !permRes.ok) {
      const msg =
        permRes.error ||
        "请确认「设置 → 服务器连接」中 Studio 后端已连接且 token 正确。";
      const still = window.confirm(
        `权限（路径/命令/工具拒绝）未能写入 Studio：\n${msg}\n\n是否仍继续保存 Provider、远程连接等其他设置？`,
      );
      if (!still) return;
    }
    if (tab === "tools") {
      const toolsRes = await toolsTabRef.current?.saveAll();
      if (toolsRes && !toolsRes.ok) {
        window.alert(toolsRes.error || "工具页保存失败");
        return;
      }
    }
    const kbRes = await knowledgeRef.current?.flushIfDirty();
    if (kbRes && !kbRes.ok) {
      const cont = window.confirm(
        `知识库配置保存失败：\n${kbRes.error ?? "未知错误"}\n\n是否仍继续保存其它设置？`,
      );
      if (!cont) return;
    }
    const normalized: Record<string, ProviderEntry> = {};
    for (const [name, entry] of Object.entries(draft)) {
      normalized[name] = { ...entry, baseUrl: normalizeBaseUrl(entry.baseUrl) };
    }
    await onSave({ defaultProvider: defProv, providers: normalized });
    await window.agenticxDesktop.saveRemoteServer({
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
    onClose();
  };

  const runMcpToggleRequest = useCallback(async (name: string, next: boolean) => {
    if (!sessionId) return;
    setMcpMessage("");
    const actionLabel = next ? "连接" : "断开";
    try {
      const result = next
        ? await window.agenticxDesktop.connectMcp({ sessionId, name })
        : await window.agenticxDesktop.disconnectMcp({ sessionId, name });
      if (result.ok) {
        await onRefreshMcp(sessionId);
        setMcpMessage(next ? `已连接 ${name}；下次启动 Machi 将自动重连此项。` : `已断开 ${name}，且不再自动连接。`);
      } else {
        const detail = String(result.error ?? "未知错误");
        if (detail.includes("连接已取消")) return;
        try {
          await onRefreshMcp(sessionId);
        } catch {
          // best-effort refresh
        }
        setMcpMessage(`${actionLabel}失败: ${detail}`);
      }
    } catch (err) {
      const detail = String(err);
      if (detail.includes("连接已取消")) return;
      try {
        await onRefreshMcp(sessionId);
      } catch {
        // best-effort refresh
      }
      setMcpMessage(`${actionLabel}失败: ${detail}`);
    }
  }, [onRefreshMcp, sessionId]);

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
        setMcpMessage(`扫描失败: ${res?.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMcpMessage(`扫描失败: ${String(err)}`);
    } finally {
      const elapsed = Date.now() - start;
      const MIN_MS = 800;
      if (elapsed < MIN_MS) {
        await new Promise((r) => setTimeout(r, MIN_MS - elapsed));
      }
      setMcpDiscoverLoading(false);
    }
  }, []);

  const refreshMcpMarketplace = useCallback(async () => {
    setMcpMarketplaceLoading(true);
    setMcpMessage("");
    try {
      const res = await window.agenticxDesktop.mcpMarketplaceList({
        search: mcpMarketplaceSearch.trim(),
        page: 1,
        pageSize: 20,
      });
      if (res?.ok && Array.isArray(res.items)) {
        setMcpMarketplaceItems(res.items);
      } else {
        setMcpMessage(`市场加载失败: ${res?.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMcpMessage(`市场加载失败: ${String(err)}`);
    } finally {
      setMcpMarketplaceLoading(false);
    }
  }, [mcpMarketplaceSearch]);

  const handleInstallMarketplaceMcp = useCallback(
    async (serverId: string, env: Record<string, string>) => {
      setMcpMarketplaceInstallBusy(true);
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
          setMcpMessage(`安装失败: ${res.error ?? "未知错误"}`);
          return;
        }
        setMcpMessage(
          `安装成功：${[...(res.installed ?? []), ...(res.updated ?? [])].join("、") || serverId}`,
        );
        if (sessionId) await onRefreshMcp(sessionId);
        await refreshMcpDiscover();
      } catch (err) {
        setMcpMessage(`安装失败: ${String(err)}`);
      } finally {
        setMcpMarketplaceInstallBusy(false);
      }
    },
    [onRefreshMcp, refreshMcpDiscover, sessionId],
  );

  const mcpEditorFilePaths = useMemo(
    () => [MCP_PRIMARY_CONFIG_PATH, ...mcpExtraPaths.filter(Boolean)],
    [mcpExtraPaths],
  );

  useEffect(() => {
    if (!open || tab !== "mcp") return;
    if (mcpDiscoverHits.length === 0) {
      void refreshMcpDiscover();
    }
    if (mcpMarketplaceItems.length === 0) {
      void refreshMcpMarketplace();
    }
  }, [open, tab, mcpDiscoverHits.length, mcpMarketplaceItems.length, refreshMcpDiscover, refreshMcpMarketplace]);

  useEffect(() => {
    if (!open || tab !== "mcp" || !sessionId) return;
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
      {/* 固定为视口比例，避免切换 tab 时随内容伸缩；长内容在右侧滚动区内滚动 */}
      <div
        className="agx-settings-panel flex h-[min(85vh,calc(100dvh-2rem))] w-[min(90vw,51.25rem)] max-w-[calc(100vw-2rem)] shrink-0 overflow-hidden rounded-2xl border border-border shadow-2xl"
        style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
      >
        {/* Left: tab navigation */}
        <div className="flex h-full min-h-0 w-[200px] shrink-0 flex-col bg-surface-sidebar p-4">
          <div className="mb-4 text-[15px] font-semibold text-text-strong">设置</div>
          <nav className="flex flex-1 flex-col gap-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  className={`flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left text-[13px] font-semibold transition-all ${
                    isActive
                      ? "border-border-strong bg-surface-card text-text-strong"
                      : "border-transparent text-text-subtle hover:border-border-strong hover:bg-surface-card hover:text-text-strong"
                  }`}
                  onClick={() => setTab(t.id)}
                >
                  {Icon ? (
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-sm bg-surface-hover" aria-hidden />
                  )}
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: content */}
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <h3 className="text-[15px] font-semibold text-text-strong">
              {TABS.find((t) => t.id === tab)?.label ?? "设置"}
            </h3>
            <button
              className="rounded-lg border border-transparent p-1.5 text-text-faint transition hover:border-border-strong hover:bg-surface-card hover:text-text-strong"
              onClick={onClose}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {tab === "account" && <AccountTab />}

            {/* === GENERAL TAB ===（保持挂载以便底部「保存」能刷入权限 API，避免仅失焦写入） */}
            <div className={tab === "general" ? "space-y-4" : "hidden"}>
                <Panel title="显示">
                  <label className="block text-sm text-text-muted">
                    主题
                    <select
                      className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
                      value={theme}
                      onChange={(e) => onThemeChange(e.target.value as "dark" | "light" | "dim")}
                    >
                      <option value="dark">深色</option>
                      <option value="dim">暗灰</option>
                      <option value="light">浅色</option>
                    </select>
                  </label>
                  <label className="mt-3 block text-sm text-text-muted">
                    聊天风格
                    <select
                      className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
                      value={chatStyle}
                      onChange={(e) => onChatStyleChange(e.target.value as ChatStyle)}
                    >
                      <option value="im">IM 风格（头像 + 右侧绿色用户气泡）</option>
                      <option value="terminal">Terminal 风格（等宽前缀）</option>
                      <option value="clean">Clean 风格（极简分隔块）</option>
                    </select>
                  </label>
                </Panel>
                <Panel title="用户档案">
                  <p className="mb-3 text-[11px] leading-relaxed text-text-subtle">
                    「你」的身份与展示，以及希望各对话如何围绕你展开（称呼、头像、用户偏好）。全局人格（SOUL）仍在下方 Machi 区块。
                  </p>
                  <label className="block text-sm text-text-muted">
                    我的称呼（用于所有对话）
                    <input
                      type="text"
                      className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
                      value={userNickname}
                      onChange={(e) => setUserNickname(e.target.value)}
                      placeholder="留空则显示「我」"
                      maxLength={48}
                    />
                  </label>
                  <p className="mt-1 text-[11px] text-text-subtle">
                    在单聊与群聊中均以此称呼标注你的身份，分身会称呼你此名。
                  </p>
                  <div className="mt-4">
                    <div className="text-sm text-text-muted">我的头像</div>
                    <div className="mt-2 flex items-center gap-3">
                      {userAvatarUrl ? (
                        <img
                          src={userAvatarUrl}
                          alt="我的头像"
                          className="h-12 w-12 rounded-full border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-card text-sm font-semibold text-text-primary">
                          {(userNickname.trim().slice(0, 1) || "我").toUpperCase()}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong">
                          上传图片
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleProfileAvatarUpload(file, "user");
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
                          disabled={!userAvatarUrl}
                          onClick={() => {
                            setUserAvatarUrl("");
                            setUserAvatarMessage("已恢复默认用户头像。");
                          }}
                        >
                          恢复默认
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-text-subtle">
                      会用于 IM 风格聊天中的用户消息头像。仅本机生效，保存在本地浏览器存储。
                    </p>
                    {userAvatarMessage ? (
                      <p className="mt-1 text-[11px] text-text-subtle">{userAvatarMessage}</p>
                    ) : null}
                  </div>
                  <label className="mt-4 block text-sm text-text-muted">
                    用户偏好与风格（注入系统提示）
                    <textarea
                      className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
                      rows={4}
                      value={userPreference}
                      onChange={(e) => setUserPreference(e.target.value)}
                      placeholder={"例：我不喜欢绕弯子，请直接给结论；偏好表格而非长段落；遇到歧义先问我再执行。"}
                      maxLength={500}
                    />
                  </label>
                  <p className="mt-1 text-[11px] text-text-subtle">
                    {`${userPreference.length}/500 字。会注入每次对话的系统提示，对所有 agent 的回复方式生效。`}
                  </p>
                </Panel>
                <Panel title="元智能体（Machi）">
                  <p className="mb-3 text-[11px] leading-relaxed text-text-subtle">
                    仅 Machi 元智能体：自定义头像与全局人格（SOUL.md）。用户偏好见上方「用户档案」。
                  </p>
                  <div>
                    <div className="text-sm text-text-muted">Machi 头像</div>
                    <div className="mt-2 flex items-center gap-3">
                      <img
                        src={effectiveMetaAvatarUrl}
                        alt="Machi 头像"
                        className="h-12 w-12 rounded-full border border-border object-cover"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong">
                          上传图片
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleProfileAvatarUpload(file, "meta");
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
                          disabled={!metaAvatarUrl}
                          onClick={() => {
                            setMetaAvatarUrl("");
                            setMetaAvatarMessage("已恢复默认 Machi 头像。");
                          }}
                        >
                          恢复默认
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-text-subtle">
                      仅本机生效，保存在本地浏览器存储。建议使用小于 1.8MB 的方形图片。
                    </p>
                    {metaAvatarMessage ? (
                      <p className="mt-1 text-[11px] text-text-subtle">{metaAvatarMessage}</p>
                    ) : null}
                  </div>
                  <label className="mt-4 block text-sm text-text-muted">
                    Meta-Agent SOUL（全局人格）
                    <textarea
                      className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-faint"
                      rows={6}
                      value={metaSoul}
                      onChange={(e) => setMetaSoul(e.target.value)}
                      placeholder={"写入 ~/.agenticx/workspace/SOUL.md。\n例如：\n- 回答先给结论\n- 不做过度客套\n- 任务进度要可见"}
                    />
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
                      disabled={metaSoulSaving}
                      onClick={() => void saveMetaSoul()}
                    >
                      {metaSoulSaving ? "保存中..." : "保存 Meta SOUL"}
                    </button>
                    {metaSoulMessage ? (
                      <span
                        className={`text-xs ${
                          metaSoulMessage.startsWith("Meta-Agent SOUL 已保存")
                            ? "text-text-subtle"
                            : "text-rose-400"
                        }`}
                      >
                        {metaSoulMessage}
                      </span>
                    ) : null}
                  </div>
                </Panel>
                <Panel title="权限">
                  <div className="mb-2 text-sm font-medium text-text-primary">工具执行权限模式</div>
                  <select
                    className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
                    value={confirmStrategy}
                    onChange={(e) => void onConfirmStrategyChange(e.target.value as ConfirmMode)}
                  >
                    <option value="manual">每次询问</option>
                    <option value="semi-auto">白名单放行</option>
                    <option value="auto">全部自动执行</option>
                  </select>
                  <div className="mt-2 text-xs text-text-subtle">
                    {confirmStrategy === "manual"
                      ? "每次工具执行都询问确认（最安全）。"
                      : confirmStrategy === "semi-auto"
                        ? "命中同类操作白名单自动放行，未命中时询问（推荐）。"
                        : "默认全部自动执行，不再询问（高风险）。"}
                  </div>
                  <p className="mt-2 text-[11px] text-text-faint">
                    下方「路径 / 命令 / 工具拒绝」修改后，请点击窗口底部「保存」写入 Studio（与失焦保存等效）。未配置远程 URL 时使用本机内置 API；若仍出现 HTTP 404，请升级远端 agenticx 版本或核对服务器地址是否指向当前 Machi 使用的同一 Studio。
                  </p>
                </Panel>
                <PermissionsAdvancedPanel ref={permissionsPanelRef} />
                <ComputerUseGeneralPanel />
                <SessionMemoryPanel />
                <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs text-text-subtle">
                  当前版本：AgenticX Desktop v0.2.0
                </div>
            </div>

            {/* === PROVIDER TAB === */}
            {tab === "provider" && (
              <div className="flex gap-3">
                {/* Provider sub-list */}
                <div className="flex w-[140px] shrink-0 flex-col rounded-md border border-border bg-surface-card">
                  <div className="max-h-[min(60vh,420px)] space-y-0.5 overflow-y-auto py-1">
                    {providerNames.map((name) => {
                      const entry = draft[name];
                      const dotClass = providerEffectiveOn(entry) ? "bg-emerald-400" : "bg-rose-400";
                      return (
                        <button
                          key={name}
                          className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition ${
                            active === name ? "bg-[var(--settings-accent-row-bg)] text-[var(--settings-accent-fg)]" : "text-text-subtle hover:bg-surface-hover hover:text-text-primary"
                          }`}
                          onClick={() => {
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
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
                          <span className="truncate">{getProviderDisplayName(name, entry)}</span>
                          {name === defProv && <span className="ml-auto shrink-0 rounded bg-[var(--settings-accent-badge-bg)] px-1 text-[9px] text-[var(--settings-accent-fg)]">默认</span>}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="mx-1.5 mb-1.5 mt-0.5 flex shrink-0 items-center justify-center gap-1 rounded-lg border border-[var(--settings-accent-badge-bg)] py-1.5 text-xs font-medium text-[var(--settings-accent-fg)] transition hover:bg-[var(--settings-accent-row-bg)]"
                    onClick={() => {
                      setAddVendorFormName("");
                      setAddServiceVendorModalOpen(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    添加
                  </button>
                </div>

                {/* Provider detail */}
                <div className="flex-1 space-y-3">
                      <h2 className="text-sm font-semibold leading-snug text-text-primary">
                        {getProviderDisplayName(active, current)}
                      </h2>
                      <div className="space-y-1 rounded-md border border-border bg-surface-panel px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-text-subtle">
                            {currentEffectiveOn ? "已启用" : "已禁用"}
                          </div>
                          <button
                            type="button"
                            aria-label={
                              currentEffectiveOn
                                ? `关闭 ${getProviderDisplayName(active, current)}`
                                : `启用 ${getProviderDisplayName(active, current)}`
                            }
                            className={`inline-flex min-w-[58px] items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                              currentEffectiveOn
                                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                                : "border-border bg-surface-card text-text-faint hover:text-text-subtle"
                            }`}
                            onClick={() => {
                              if (currentEffectiveOn) {
                                updateField("enabled", false);
                                setProviderEnableHint(null);
                              } else if (!providerCredentialed(current)) {
                                setProviderEnableHint("请先填写 API 密钥或 API 地址后再启用");
                              } else {
                                updateField("enabled", true);
                                setProviderEnableHint(null);
                              }
                            }}
                          >
                            {currentEffectiveOn ? "ON" : "OFF"}
                          </button>
                        </div>
                        <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                          <div className="text-xs text-text-subtle">
                            {defProv === active ? "已设为默认" : "未设为默认"}
                          </div>
                          <button
                            type="button"
                            aria-label={
                              defProv === active
                                ? `取消将 ${getProviderDisplayName(active, current)} 设为默认 Provider`
                                : `将 ${getProviderDisplayName(active, current)} 设为默认 Provider`
                            }
                            className={`inline-flex min-w-[58px] items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                              defProv === active
                                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                                : "border-border bg-surface-card text-text-faint hover:text-text-subtle"
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
                                  setDefaultProvHint("至少要保留一个默认 Provider；请先在左侧选择其它厂商后再取消默认。");
                                }
                              } else if (!providerCredentialed(current)) {
                                setDefaultProvHint("请先填写 API 密钥或 API 地址后再设为默认 Provider");
                              } else {
                                setDefaultProvHint(null);
                                setDefProv(active);
                              }
                            }}
                          >
                            {defProv === active ? "ON" : "OFF"}
                          </button>
                        </div>
                        {providerEnableHint ? (
                          <div className="text-[11px] text-rose-400">{providerEnableHint}</div>
                        ) : null}
                        {defaultProvHint ? (
                          <div className="text-[11px] text-rose-400">{defaultProvHint}</div>
                        ) : null}
                      </div>
                      {!(ALL_PROVIDERS as readonly string[]).includes(active) &&
                      (current.interface === "openai" || active.startsWith("custom_openai_")) ? (
                        <label className="mb-3 block text-sm text-text-muted">
                          服务厂商显示名
                          <input
                            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                            value={current.displayName ?? ""}
                            onChange={(e) => updateField("displayName", e.target.value)}
                            placeholder="例如 移动云"
                          />
                          <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
                            仅用于界面与侧栏展示；配置中的厂商 id 仍为左侧英文标识。
                          </p>
                        </label>
                      ) : null}
                      <label className="block text-sm text-text-muted">
                        API 密钥
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
                              aria-label={apiKeyVisible ? "隐藏密钥" : "显示密钥"}
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
                            disabled={ks === "checking" || !current.apiKey}
                            onClick={onValidateKey}
                          >
                            {ks === "checking" ? "检测中..." : ks === "ok" ? "有效 ✓" : ks === "fail" ? "失败 ✗" : "检 测"}
                          </button>
                        </div>
                        {ks === "fail" && keyError[active] && <div className="mt-1 text-xs text-rose-400">{keyError[active]}</div>}
                      </label>
                      <label className="block text-sm text-text-muted">
                        API 地址 <span className="text-xs text-text-faint">(留空使用默认)</span>
                        <input className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm" value={current.baseUrl} onChange={(e) => updateField("baseUrl", e.target.value)} placeholder="https://..." />
                        {current.baseUrl.trim() && (
                          <div className="mt-1 text-xs text-text-faint">
                            预览：<span className="text-text-subtle">{
                              (() => {
                                const b = current.baseUrl.trim().replace(/\/+$/, "");
                                // Normalize: ensure /v1 segment is present (Cherry Studio behavior)
                                const base = /\/v\d(\/|$)/.test(b) ? b : `${b}/v1`;
                                return `${base}/chat/completions`;
                              })()
                            }</span>
                          </div>
                        )}
                      </label>
                      {(DROP_PARAMS_CAPABLE_PROVIDERS.has(active) || current.interface === "openai") && (
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-text-muted">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
                            checked={current.dropParams}
                            onChange={(e) => updateField("dropParams", e.target.checked)}
                          />
                          <span>
                            兼容模式：丢弃上游不支持的参数（<code className="text-xs text-text-faint">drop_params</code>）
                            <span className="mt-0.5 block text-xs text-text-faint">
                              自建 LiteLLM / 部分 OpenAI 兼容网关不支持 <code className="text-[10px]">tool_choice</code> 时需开启；保存后重启本机 <code className="text-[10px]">agx serve</code> 或重开 Machi 后生效。
                            </span>
                          </span>
                        </label>
                      )}
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,auto)_auto] items-center gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-text-muted">模型列表</span>
                          <span className="rounded-full bg-surface-hover px-1.5 py-px text-[10px] font-medium tabular-nums text-text-subtle">
                            {current.models.length}
                          </span>
                        </div>
                        <div className="min-w-[6.5rem]" aria-hidden />
                        <div className="flex shrink-0 items-center justify-end gap-1">
                          <HoverTip label="批量健康检查">
                            <button
                              type="button"
                              aria-label="批量健康检查"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-40"
                              disabled={!current.apiKey?.trim() || current.models.length === 0}
                              onClick={() => void onBatchHealthCheck()}
                            >
                              <Activity className="h-4 w-4" aria-hidden />
                            </button>
                          </HoverTip>
                          <HoverTip label="从 API 获取模型">
                            <button
                              type="button"
                              aria-label="从 API 获取模型"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:pointer-events-none disabled:opacity-40"
                              disabled={fetchingModels || !current.apiKey?.trim()}
                              onClick={() => void onFetchModels()}
                            >
                              {fetchingModels ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <RefreshCw className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                          </HoverTip>
                          <HoverTip label="添加模型">
                            <button
                              type="button"
                              aria-label="添加模型"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
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
                      <div className="space-y-1">
                        {current.models.length === 0 ? (
                          <div className="py-4 text-center text-sm text-text-faint">暂无模型，可从 API 拉取或点击 + 手动添加</div>
                        ) : null}
                        {current.models.map((model) => {
                          const hk = `${active}:${model}`;
                          const entry = modelHealthMap[hk];
                          const checking = entry?.phase === "checking";
                          return (
                            <div
                              key={model}
                              className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,auto)_2rem_2rem] items-center gap-2 rounded-md border border-border bg-surface-panel/50 px-3 py-2"
                            >
                              <span className="min-w-0 truncate text-sm text-text-muted">{model}</span>
                              <div className="flex min-w-0 items-center justify-end gap-1.5">
                                {entry?.phase === "ok" ? (
                                  <>
                                    <span className="tabular-nums text-xs text-text-subtle">{formatHealthLatencyMs(entry.ms)}</span>
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                                  </>
                                ) : entry?.phase === "error" ? (
                                  <span className="text-xs text-rose-400/90">失败</span>
                                ) : checking ? (
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-faint" aria-hidden />
                                ) : (
                                  <button
                                    type="button"
                                    className="shrink-0 text-xs text-text-faint transition hover:text-[var(--settings-accent-fg)] disabled:opacity-40"
                                    disabled={checking || !current.apiKey}
                                    onClick={() => void onHealthCheck(model)}
                                  >
                                    检测
                                  </button>
                                )}
                              </div>
                              <HoverTip label="编辑模型">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-text-faint transition hover:bg-surface-hover hover:text-text-primary"
                                  aria-label="编辑模型"
                                  onClick={() => openEditModelModal(model)}
                                >
                                  <SquarePen className="h-4 w-4" aria-hidden />
                                </button>
                              </HoverTip>
                              <HoverTip label="移除模型">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-rose-400/80 transition hover:bg-surface-hover hover:text-rose-400"
                                  aria-label="移除模型"
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
                        open={addServiceVendorModalOpen}
                        title="添加服务厂商"
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
                              取消
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
                              disabled={!addVendorFormName.trim()}
                              onClick={submitAddServiceVendorFromModal}
                            >
                              确定
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
                          <label className="block text-sm text-text-muted">
                            服务厂商名称
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-card-strong px-2 py-1.5 text-sm"
                              value={addVendorFormName}
                              onChange={(e) => setAddVendorFormName(e.target.value)}
                              placeholder="例如 OpenAI"
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && addVendorFormName.trim()) submitAddServiceVendorFromModal();
                              }}
                            />
                          </label>
                          <label className="block text-sm text-text-muted">
                            服务厂商类型
                            <select
                              className="mt-1 w-full rounded-md border border-border bg-surface-card-strong px-2 py-1.5 text-sm"
                              value="openai"
                              disabled
                              aria-label="服务厂商类型"
                            >
                              <option value="openai">OpenAI</option>
                            </select>
                            <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
                              当前仅支持 OpenAI 兼容接口（含多数中转 / 网关）；保存设置后写入配置。
                            </p>
                          </label>
                        </div>
                      </Modal>
                      <Modal
                        open={addModelModalOpen}
                        title="添加模型"
                        onClose={closeAddModelModal}
                        footer={(
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                              onClick={closeAddModelModal}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
                              disabled={!addModelFormId.trim()}
                              onClick={submitAddModelFromModal}
                            >
                              添加模型
                            </button>
                          </div>
                        )}
                      >
                        <div className="space-y-3">
                          <label className="block text-sm text-text-muted">
                            <span className="text-rose-400">*</span> 模型 ID
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                              value={addModelFormId}
                              onChange={(e) => setAddModelFormId(e.target.value)}
                              placeholder="必填，例如 gpt-4o-mini"
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && addModelFormId.trim()) submitAddModelFromModal();
                              }}
                            />
                          </label>
                          <label className="block text-sm text-text-muted">
                            模型名称
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                              value={addModelFormName}
                              onChange={(e) => setAddModelFormName(e.target.value)}
                              placeholder="可选，例如 GPT-4"
                            />
                          </label>
                          <p className="text-[11px] leading-relaxed text-text-faint">
                            保存到列表时仅使用「模型 ID」；模型名称便于你对照 Cherry Studio 习惯填写，当前版本不参与路由。
                          </p>
                        </div>
                      </Modal>
                      <Modal
                        open={editModelModalOpen}
                        title="编辑模型"
                        onClose={closeEditModelModal}
                        footer={(
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                              onClick={closeEditModelModal}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40"
                              disabled={!editModelFormId.trim()}
                              onClick={submitEditModelFromModal}
                            >
                              保存
                            </button>
                          </div>
                        )}
                      >
                        <div className="space-y-3">
                          <label className="block text-sm text-text-muted">
                            <span className="text-rose-400">*</span> 模型 ID
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                              value={editModelFormId}
                              onChange={(e) => {
                                setEditModelFormId(e.target.value);
                                setEditModelError(null);
                              }}
                              placeholder="例如 gpt-4o-mini"
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && editModelFormId.trim()) submitEditModelFromModal();
                              }}
                            />
                          </label>
                          {editModelError ? <div className="text-[11px] text-rose-400">{editModelError}</div> : null}
                          <p className="text-[11px] leading-relaxed text-text-faint">
                            列表项即请求时使用的模型 ID；保存设置后才会写入配置。
                          </p>
                        </div>
                      </Modal>
                </div>
              </div>
            )}

            {/* === MCP TAB === */}
            {tab === "mcp" && (() => {
              const openEditorFor = (path: string) => {
                setMcpEditorPath(path);
                setMcpEditorOpen(true);
              };
              return (
              <div className="space-y-5">
                <div className="text-sm text-text-subtle">
                  MCP（模型上下文协议）服务为 Agent 扩展外部工具 — 文件系统、数据库、网页搜索等。
                </div>

                {mcpMessage && <div className="text-xs text-text-subtle">{mcpMessage}</div>}

                {/* —— 配置文件路径 —— */}
                <div className="space-y-2">
                  <div className="text-xs text-text-faint">
                    配置文件路径（按顺序合并；同名服务以先出现的为准）。点右侧铅笔图标直接编辑 JSON。
                  </div>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      className="flex-1 cursor-not-allowed rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-muted"
                      value={MCP_PRIMARY_CONFIG_PATH}
                      aria-label="主 MCP 配置路径"
                    />
                    <span className="shrink-0 self-center text-[10px] text-text-faint">主配置</span>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-border p-2 text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                      title="编辑此配置文件"
                      onClick={() => openEditorFor(MCP_PRIMARY_CONFIG_PATH)}
                    >
                      <SquarePen className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  {mcpExtraPaths.map((row, idx) => (
                    <div key={`mcp-path-${idx}`} className="flex gap-2">
                      <input
                        className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                        value={row}
                        placeholder="例如 ~/.cursor/mcp.json"
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
                        title="移除此路径"
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
                        title="编辑此配置文件"
                        disabled={!row.trim()}
                        onClick={() => openEditorFor(row.trim())}
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
                    添加配置路径
                  </button>
                </div>

                {/* —— MCP 服务列表 —— */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-text-muted">MCP 服务</div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
                      onClick={() => void refreshMcpDiscover()}
                      disabled={mcpDiscoverLoading}
                      title="扫描本地已安装的 AI 工具的 MCP 配置"
                    >
                      <RefreshCw
                        className="h-3.5 w-3.5"
                        style={{ animation: mcpDiscoverLoading ? "spin 1s linear infinite" : "none" }}
                        aria-hidden
                      />
                      {mcpDiscoverLoading ? "扫描中…" : "扫描发现"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-faint">
                    <span className="text-text-faint">注：</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500" />
                      已连接且已注册工具
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      异常，请先查看详情再重连
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#6b7280]" />
                      未连接
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {mcpServers.length === 0 ? (
                      <div className="py-6 text-center text-sm text-text-faint">
                        尚未发现 MCP 服务。点右上角「扫描发现」或下方「New MCP Server」添加。
                      </div>
                    ) : null}
                    {mcpServers.map((server) => {
                      const pres = resolveMcpRowPresentation(server);
                      const optimisticChecked = mcpOptimisticChecked[server.name];
                      const switchChecked = typeof optimisticChecked === "boolean" ? optimisticChecked : server.connected;
                      const forceDisconnectedMessage = Boolean(mcpServerBusy[server.name]) && !switchChecked;
                      const latestOpMessage = forceDisconnectedMessage
                        ? "未连接"
                        : server.op_message?.trim() || `状态：${pres.statusLine}`;
                      return (
                        <div
                          key={server.name}
                          className="flex flex-col gap-1 rounded-md border border-border bg-surface-card px-3 py-2 sm:flex-row sm:items-center sm:gap-2"
                        >
                          <div className="flex min-w-0 flex-1 items-start gap-2">
                            <span
                              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${pres.dotClass}`}
                              title={pres.statusLine}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-text-muted">{server.name}</div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="text-[11px] text-text-subtle">{pres.statusLine}</span>
                                {pres.detail ? (
                                  <>
                                    <button
                                      type="button"
                                      className="text-[11px] text-rose-400 underline decoration-dotted hover:text-rose-300"
                                      onClick={() =>
                                        setMcpErrorInspect({ title: `${server.name} — 异常说明`, body: pres.detail! })
                                      }
                                    >
                                      查看详情
                                    </button>
                                    <button
                                      type="button"
                                      className="text-[11px] text-[var(--settings-accent-text)] underline decoration-dotted"
                                      onClick={() => openEditorFor(MCP_PRIMARY_CONFIG_PATH)}
                                    >
                                      用编辑器修复
                                    </button>
                                  </>
                                ) : null}
                              </div>
                              {server.command ? (
                                <div className="truncate text-[10px] text-text-faint">{server.command}</div>
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
                          <div className="flex shrink-0 items-center justify-end sm:pl-2">
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
                                switchChecked ? `已连接 ${server.name}，关闭以断开` : `连接 ${server.name}`
                              }
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* New MCP Server */}
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md border border-dashed border-border bg-surface-panel px-3 py-2 text-left text-sm text-text-subtle transition hover:bg-surface-hover hover:text-text-primary"
                      onClick={() => openEditorFor(MCP_PRIMARY_CONFIG_PATH)}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border">
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <span className="flex flex-col">
                        <span className="font-medium text-text-muted">New MCP Server</span>
                        <span className="text-[11px] text-text-faint">在 JSON 编辑器中添加自定义 MCP 服务</span>
                      </span>
                    </button>
                  </div>
                </div>

                {/* —— MCP 市场 —— */}
                <div className="space-y-2 border-t border-border pt-4">
                  <div className="text-sm font-medium text-text-muted">MCP 市场</div>
                  <div className="text-[11px] leading-relaxed text-text-faint">
                    来自魔搭 ModelScope 的 MCP 服务仓库，点「添加」直接合并到主配置。
                  </div>
                  <MCPMarketplacePanel
                    loading={mcpMarketplaceLoading}
                    items={mcpMarketplaceItems as Array<Record<string, unknown> & { id: string }>}
                    search={mcpMarketplaceSearch}
                    onSearchChange={setMcpMarketplaceSearch}
                    onRefresh={refreshMcpMarketplace}
                    onInstall={handleInstallMarketplaceMcp}
                    resolving={mcpMarketplaceInstallBusy}
                    envSchema={mcpMarketplaceEnvSchema}
                  />
                </div>
              </div>
              );
            })()}

            {/* === SKILLS TAB === */}
            {tab === "tools" && <ToolsTab ref={toolsTabRef} />}

            {/* === SKILLS TAB === */}
            {tab === "skills" && (
              <div className="space-y-4">
                <SkillsTab />
                <SkillAdvancedPanel />
              </div>
            )}

            {/* === KNOWLEDGE TAB === Plan-Id: machi-kb-stage1-local-mvp */}
            {tab === "knowledge" && <KnowledgeSettings ref={knowledgeRef} />}

            {/* === HOOKS TAB === */}
            {tab === "hooks" && <HooksTab />}

            {tab === "automation" && <AutomationTab />}

            {/* === EMAIL TAB === */}
            {tab === "email" && <EmailSettingsTab />}

            {/* === WORKSPACE TAB === */}
            {tab === "workspace" && <WorkspaceSettingsTab />}

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
                <Panel title="连接模式">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm text-text-subtle cursor-pointer">
                      <input
                        type="radio"
                        name="server-mode"
                        checked={serverMode === "local"}
                        onChange={() => setServerMode("local")}
                        className="accent-[var(--ui-btn-primary-bg)]"
                      />
                      本地 (默认)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text-subtle cursor-pointer">
                      <input
                        type="radio"
                        name="server-mode"
                        checked={serverMode === "remote"}
                        onChange={() => setServerMode("remote")}
                        className="accent-[var(--ui-btn-primary-bg)]"
                      />
                      远程服务器
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-text-faint">
                    本地模式自动启动 agx serve；远程模式连接云主机上已部署的 agx serve 后端。
                  </p>
                </Panel>

                <Panel title="远程服务器配置">
                  <fieldset disabled={serverMode === "local"} className={serverMode === "local" ? "opacity-50" : ""}>
                    <label className="block text-sm text-text-muted">
                      服务器 URL
                      <input
                        className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                        placeholder="https://your-server:8080"
                        value={serverUrl}
                        onChange={(e) => setServerUrl(e.target.value)}
                      />
                    </label>
                    <label className="mt-3 block text-sm text-text-muted">
                      认证 Token
                      <div className="relative mt-1">
                        <input
                          className="w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 pr-16 text-sm text-text-subtle"
                          type={serverShowToken ? "text" : "password"}
                          placeholder="与服务端 AGX_DESKTOP_TOKEN 一致"
                          value={serverToken}
                          onChange={(e) => setServerToken(e.target.value)}
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-text-faint hover:text-text-subtle"
                          onClick={() => setServerShowToken(!serverShowToken)}
                        >
                          {serverShowToken ? "隐藏" : "显示"}
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
                        {serverTestStatus === "testing" ? "测试中..." : "测试连接"}
                      </button>
                      {serverTestStatus === "ok" && (
                        <span className="text-sm text-green-500">连接成功</span>
                      )}
                      {serverTestStatus === "fail" && (
                        <span className="text-sm text-red-400" title={serverTestError}>连接失败</span>
                      )}
                    </div>
                  </fieldset>
                </Panel>

                <Panel title="飞书集成">
                  {/* Tab switcher */}
                  <div className="mb-4 flex gap-1 rounded-lg bg-surface-hover p-0.5">
                    {(["feishu", "webhook"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition ${
                          imTab === t
                            ? "bg-surface-panel text-text-strong shadow-sm"
                            : "text-text-faint hover:text-text-subtle"
                        }`}
                        onClick={() => setImTab(t)}
                      >
                        {t === "feishu" ? "飞书长连接（推荐）" : "Webhook 模式"}
                      </button>
                    ))}
                  </div>

                  {/* Feishu long-connection tab */}
                  {imTab === "feishu" && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">
                        无需公网服务器，使用飞书官方 WebSocket 长连接接收消息，Machi 启动后自动在后台运行。
                      </p>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-text-subtle">启用飞书机器人</span>
                        <SettingsSwitch
                          checked={feishuEnabled}
                          onChange={setFeishuEnabled}
                          aria-label="启用飞书长连接"
                        />
                      </div>
                      {feishuEnabled && (
                        <>
                          <label className="block text-sm text-text-muted">
                            App ID
                            <input
                              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                              placeholder="cli_xxxxxxxxxxxxxx"
                              value={feishuAppId}
                              onChange={(e) => setFeishuAppId(e.target.value)}
                            />
                          </label>
                          <label className="block text-sm text-text-muted">
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
                                {feishuShowSecret ? "隐藏" : "显示"}
                              </button>
                            </div>
                          </label>
                          <p className="text-xs text-text-faint">
                            保存后 Machi 自动在后台启动飞书长连接，无需额外开终端。
                            飞书应用须开启「机器人」能力，订阅 <code className="rounded bg-surface-hover px-1">im.message.receive_v1</code> 长连接事件。
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Webhook mode tab */}
                  {imTab === "webhook" && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">
                        需要公网可访问的服务器部署云端 Gateway，再通过扫码与 Machi 绑定。
                      </p>
                      <label className="block text-sm text-text-muted">
                        网关地址
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="https://gateway.example.com"
                          value={gwUrl}
                          onChange={(e) => setGwUrl(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm text-text-muted">
                        设备 ID
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="my-macbook"
                          value={gwDeviceId}
                          onChange={(e) => setGwDeviceId(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm text-text-muted">
                        设备 Token
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
                            {gwShowToken ? "隐藏" : "显示"}
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
                      扫码连接（飞书/企微）
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-hover disabled:opacity-50"
                      disabled={!gwUrl.trim() || !gwDeviceId.trim() || !gwToken.trim() || gwBindingsLoading}
                      onClick={() => void refreshGwBindings()}
                    >
                      {gwBindingsLoading ? "刷新中…" : "刷新已绑定账号"}
                    </button>
                  </div>
                  {gwBindingsErr && (
                    <p className="mt-2 text-xs text-red-400" title={gwBindingsErr}>
                      无法拉取绑定列表：{gwBindingsErr.slice(0, 120)}
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
                                  const t = await r.text();
                                  throw new Error(t.slice(0, 120) || `HTTP ${r.status}`);
                                }
                                await refreshGwBindings();
                              } catch (e) {
                                alert(`解绑失败：${String(e)}`);
                              }
                            }}
                          >
                            解绑
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
                    {gwAdvancedOpen ? "收起高级配置" : "展开高级配置"}
                  </button>
                  {gwAdvancedOpen && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm text-text-subtle">
                          启用网关客户端（agx serve 启动后连接 WebSocket）
                        </span>
                        <SettingsSwitch
                          checked={gwEnabled}
                          onChange={setGwEnabled}
                          aria-label="启用网关客户端"
                        />
                      </div>
                      <label className="block text-sm text-text-muted">
                        本机 Studio 基址（留空则使用 http://127.0.0.1:当前端口）
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="http://127.0.0.1:8000"
                          value={gwStudioBase}
                          onChange={(e) => setGwStudioBase(e.target.value)}
                        />
                      </label>
                      <p className="mt-1 text-xs text-text-faint">
                        修改后点底部「保存」统一生效；需重启 Machi / agx serve。
                      </p>
                    </div>
                  )}
                  </>)}
                </Panel>

                <Panel title="微信集成">
                  {wechatStatus === "idle" && !wechatBotId && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">
                        扫码绑定个人微信，绑定后可在微信中给 Machi 发消息触发 Agent 执行。基于微信官方 iLink 协议。
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
                            if (!sidecarPort) { setWechatBindMsg("Sidecar 未启动"); return; }
                            const resp = await fetch(`http://127.0.0.1:${sidecarPort}/bind/start`, { method: "POST" });
                            const data = await resp.json() as { session_id: string; qr_url?: string };
                            const sid = String(data.session_id || "").trim();
                            if (!sid) { setWechatBindMsg("会话创建失败，请重试"); return; }
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
                                if (msg.status === "scanned") setWechatBindMsg("已扫码，请在手机上确认…");
                                if (msg.status === "expired") {
                                  const fallback = String(msg.qr_url || "").trim();
                                  if (fallback) setWechatQrFallbackUrl(fallback);
                                  setWechatQrUrl(`http://127.0.0.1:${sidecarPort}/bind/${sid}/qr?ts=${Date.now()}`);
                                  setWechatBindMsg("二维码已刷新");
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
                                  setWechatBindMsg("绑定超时，请重试");
                                  ws.close();
                                }
                              }
                              if (msg.event === "error") { setWechatBindMsg(msg.error || "绑定出错"); }
                            };
                            ws.onerror = () => {
                              setWechatBindMsg("WebSocket 连接失败");
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
                        绑定微信
                      </button>
                    </div>
                  )}

                  {wechatStatus === "binding" && wechatQrUrl && (
                    <div className="space-y-3">
                      <p className="text-xs text-text-faint">请使用微信扫描下方二维码：</p>
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
                              setWechatBindMsg("本地二维码代理不可用，已回退直连链接");
                              return;
                            }
                            setWechatBindMsg("二维码加载失败，请重试");
                          }}
                        />
                      </div>
                      {wechatBindMsg && <p className="text-center text-xs text-text-subtle">{wechatBindMsg}</p>}
                    </div>
                  )}

                  {(wechatStatus === "connected" || (wechatStatus === "idle" && wechatBotId)) && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${wechatStatus === "connected" ? "bg-green-500" : "bg-yellow-500"}`} />
                        <span className="text-sm text-text-subtle">
                          {wechatStatus === "connected" ? "已连接" : "已绑定（未连接）"}
                        </span>
                      </div>
                      {wechatBotId && (
                        <p className="text-xs text-text-faint">Bot ID: <code className="rounded bg-surface-hover px-1">{wechatBotId}</code></p>
                      )}
                      <button
                        type="button"
                        className="rounded-md border border-red-500/30 px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10"
                        onClick={async () => {
                          try {
                            const { port, running } = await window.agenticxDesktop.wechatSidecarPort();
                            if (running && port) await fetch(`http://127.0.0.1:${port}/unbind`, { method: "POST" });
                          } catch { /* noop */ }
                          try {
                            await window.agenticxDesktop.saveWechatDesktopBinding({ sessionId: null });
                          } catch { /* noop */ }
                          setWechatStatus("idle");
                          setWechatBotId("");
                          setWechatQrUrl("");
                          setWechatQrFallbackUrl("");
                          setWechatBindSessionId("");
                          setWechatBindSidecarPort(0);
                          setWechatBindMsg("");
                        }}
                      >
                        解绑微信
                      </button>
                    </div>
                  )}

                  {wechatStatus === "expired" && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                        <span className="text-sm text-red-400">会话已过期</span>
                      </div>
                      <p className="text-xs text-text-faint">
                        微信 iLink 会话已过期（超过 24 小时未活跃），请重新扫码绑定。
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
                        重新绑定
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
                  <p>远程部署参考：</p>
                  <p>1. 在云主机上安装 agenticx: <code className="text-text-muted">pip install agenticx</code></p>
                  <p>2. 启动服务: <code className="text-text-muted">agx serve --host 0.0.0.0 --port 8080 --token YOUR_TOKEN</code></p>
                  <p>3. 确保防火墙放行对应端口，生产环境建议配置 HTTPS (Nginx 反向代理)。</p>
                  <p className="text-text-faint">修改后点底部「保存」统一生效；切换模式需重启 Machi。</p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            <button className="rounded-md border border-border px-4 py-1.5 text-sm text-text-subtle transition hover:bg-surface-hover" onClick={onClose}>
              取消
            </button>
            <button className="rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
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
              关闭
            </button>
          </div>
        </div>
      </div>
    ) : null}
    <MCPJsonEditorModal
      open={mcpEditorOpen}
      selectedPath={mcpEditorPath}
      filePaths={mcpEditorFilePaths}
      onClose={() => setMcpEditorOpen(false)}
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
    </>
  );
}
