import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Zap,
} from "lucide-react";
import { Panel } from "./ds/Panel";
import type { Avatar, ChatPane, ChatStyle, GroupChat } from "../store";
import { useAppStore } from "../store";
import { ForwardPicker, type ForwardConfirmPayload } from "./ForwardPicker";
import { QrConnectModal } from "./QrConnectModal";

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
  dropParams: boolean;
};

type McpServer = {
  name: string;
  connected: boolean;
  command?: string;
};

const MCP_PRIMARY_CONFIG_PATH = "~/.agenticx/mcp.json";

type SettingsTab =
  | "general"
  | "provider"
  | "mcp"
  | "tools"
  | "skills"
  | "automation"
  | "email"
  | "workspace"
  | "favorites"
  | "server";
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
};

type SkillItem = {
  name: string;
  description: string;
  location: string;
};

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

type ModelHealth = "idle" | "checking" | "healthy" | "error";

const TABS: { id: SettingsTab; label: string; icon: typeof Settings2 }[] = [
  { id: "general", label: "通用", icon: Settings2 },
  { id: "provider", label: "模型与 API", icon: Cpu },
  { id: "mcp", label: "MCP 服务", icon: Plug },
  { id: "tools", label: "工具", icon: Wrench },
  { id: "skills", label: "技能", icon: Sparkles },
  { id: "automation", label: "自动化", icon: Zap },
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

function ToolsTab() {
  const [tools, setTools] = useState<ToolStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState<Record<string, ToolInstallState>>({});

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await window.agenticxDesktop.getToolsStatus();
      if (result?.ok) {
        setTools(Array.isArray(result.tools) ? result.tools : []);
      } else {
        setError(result?.error ?? "加载工具状态失败");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTools();
  }, [loadTools]);

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

      if (event.phase === "done") {
        void loadTools();
      }
    });
    return dispose;
  }, [loadTools]);

  const startInstall = async (tool: ToolStatusItem) => {
    if (!tool.auto_installable) {
      const command = tool.install_command || "请参考官方文档安装";
      setInstalling((prev) => ({
        ...prev,
        [tool.id]: {
          requestId: `manual-${tool.id}`,
          percent: 0,
          phase: "manual_required",
          message: command,
        },
      }));
      return;
    }
    const requestId = `${tool.id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setInstalling((prev) => ({
      ...prev,
      [tool.id]: {
        requestId,
        percent: 0,
        phase: "starting",
        message: `开始安装 ${tool.name}...`,
      },
    }));
    const result = await window.agenticxDesktop.installTool({ requestId, toolId: tool.id });
    if (!result?.ok) {
      setInstalling((prev) => ({
        ...prev,
        [tool.id]: {
          requestId,
          percent: 0,
          phase: "error",
          message: result?.error || "安装失败",
          error: result?.error || "安装失败",
        },
      }));
    }
  };

  if (loading) return <div className="py-8 text-center text-sm text-text-faint">加载工具状态中...</div>;

  return (
    <div className="space-y-3">
      <div className="text-sm text-text-subtle">
        管理文档解析相关工具状态。全局安装一次后，所有分身共享；分身侧只控制是否允许使用。
      </div>
      {error ? (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200">
          {error}
        </div>
      ) : null}
      <div className="space-y-2">
        {tools.map((tool) => {
          const installState = installing[tool.id];
          const isInstalling = Boolean(installState) && !["done", "error", "manual_required"].includes(installState.phase);
          const isManual = installState?.phase === "manual_required";
          const badge = tool.installed
            ? "已安装"
            : isInstalling
              ? "安装中"
              : isManual
                ? "需手动安装"
                : "未安装";
          const badgeClass = tool.installed
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : isInstalling
              ? "border-[var(--settings-accent-border-muted)] bg-[var(--settings-accent-subtle-bg)] text-[var(--settings-accent-fg-muted)]"
              : isManual
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-border bg-surface-panel text-text-faint";
          return (
            <div key={tool.id} className="rounded-md border border-border bg-surface-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-text-primary">{tool.name}</span>
                    <span className={`shrink-0 rounded-full border px-1.5 text-[10px] ${badgeClass}`}>
                      {badge}
                    </span>
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
    </div>
  );
}

function SkillsTab() {
  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<{ name: string; content: string } | null>(null);
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

  useEffect(() => {
    setBundleNeedsConfirmNonHigh(false);
    setBundleNeedsConfirmHigh(false);
    setBundlePendingPath("");
  }, [bundleInstallPath]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");
    void (async () => {
      try {
        const [skillsRes, bundlesRes] = await Promise.all([
          window.agenticxDesktop.loadSkills(),
          window.agenticxDesktop.loadBundles(),
        ]);
        if (!cancelled) {
          if (skillsRes.ok) setItems(skillsRes.items ?? []);
          else setErr(skillsRes.error ?? "加载技能失败");
          if (bundlesRes.ok) setBundles(bundlesRes.items ?? []);
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

  const onRefresh = async () => {
    setLoading(true);
    setErr("");
    setDetail(null);
    setBundleMsg("");
    try {
      await window.agenticxDesktop.refreshSkills();
      const [skillsRes, bundlesRes] = await Promise.all([
        window.agenticxDesktop.loadSkills(),
        window.agenticxDesktop.loadBundles(),
      ]);
      if (skillsRes.ok) setItems(skillsRes.items ?? []);
      else setErr(skillsRes.error ?? "刷新失败");
      if (bundlesRes.ok) setBundles(bundlesRes.items ?? []);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const reloadSkillsAndBundles = async () => {
    const [skillsRes, bundlesRes] = await Promise.all([
      window.agenticxDesktop.loadSkills(),
      window.agenticxDesktop.loadBundles(),
    ]);
    if (skillsRes.ok) setItems(skillsRes.items ?? []);
    if (bundlesRes.ok) setBundles(bundlesRes.items ?? []);
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
    setMarketLoading(true);
    setMarketMsg("");
    try {
      const res = await window.agenticxDesktop.searchRegistry({ q: marketQuery });
      if (res.ok) {
        setMarketResults(res.items ?? []);
        if ((res.items ?? []).length === 0) setMarketMsg("未找到相关技能");
      } else {
        setMarketMsg(res.error ?? "搜索失败");
        setMarketResults([]);
      }
    } catch (e) {
      setMarketMsg(String(e));
    } finally {
      setMarketLoading(false);
    }
  };

  const onMarketInstall = async (item: RegistrySearchItem) => {
    setRegistryInstallBusy(true);
    setMarketNeedsConfirmNonHigh(false);
    setMarketNeedsConfirmHigh(false);
    setMarketPending(null);
    setMarketMsg(`正在拉取并扫描「${item.name}」…`);
    try {
      const prev = await window.agenticxDesktop.installFromRegistryPreview({
        source: item.source,
        name: item.name,
      });
      if (!prev.ok) {
        setMarketMsg(`扫描未通过: ${prev.error ?? "未知错误"}`);
        return;
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
        const skillsRes = await window.agenticxDesktop.loadSkills();
        if (skillsRes.ok) setItems(skillsRes.items ?? []);
        return;
      }
      if (res.error_code === "non_high_risk_confirm_required") {
        setMarketPending(item);
        setMarketNeedsConfirmNonHigh(true);
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
    }
  };

  const onConfirmMarketInstall = async (kind: "non_high" | "high") => {
    if (!marketPending) return;
    const pending = marketPending;
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
        const skillsRes = await window.agenticxDesktop.loadSkills();
        if (skillsRes.ok) setItems(skillsRes.items ?? []);
      } else {
        setMarketMsg(`安装失败: ${res.error ?? "未知错误"}`);
      }
    } catch (e) {
      setMarketMsg(String(e));
    } finally {
      setRegistryInstallBusy(false);
    }
  };

  const onViewDetail = async (name: string) => {
    if (detail?.name === name) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await window.agenticxDesktop.loadSkillDetail({ name });
      if (res.ok) setDetail({ name, content: res.content });
      else setErr(res.error ?? "加载详情失败");
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingDetail(false);
    }
  };

  const filtered = search.trim()
    ? items.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const projectSkills = filtered.filter((s) => s.location === "project");
  const globalSkills = filtered.filter((s) => s.location !== "project");

  if (loading) {
    return <div className="py-8 text-center text-sm text-text-faint">加载技能中...</div>;
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-text-subtle">
        技能（Skills）是注入给 Agent 的领域知识指令，告诉 AI 在特定任务中「怎么做」。
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
            可将 SKILL.md 放置在 .agents/skills/、~/.agents/skills/ 或 .claude/skills/ 等目录。
          </span>
        </div>
      )}

      {/* Detail panel */}
      {detail && (
        <div className="rounded-md border border-[var(--settings-accent-border-muted)] bg-surface-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-[var(--settings-accent-fg)]">{detail.name}</span>
            <button
              className="text-xs text-text-faint transition hover:text-text-primary"
              onClick={() => setDetail(null)}
            >
              关闭 ✕
            </button>
          </div>
          <pre className="max-h-64 overflow-y-auto px-3 py-2 text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap break-words">
            {detail.content}
          </pre>
        </div>
      )}
      {loadingDetail && (
        <div className="py-2 text-center text-xs text-text-faint">加载详情...</div>
      )}

      {/* Skills list grouped by location */}
      {projectSkills.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
            项目技能 ({projectSkills.length})
          </div>
          <div className="space-y-1">
            {projectSkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  detail?.name === skill.name
                    ? "border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)]"
                    : "border-border bg-surface-card hover:bg-surface-hover"
                }`}
                onClick={() => void onViewDetail(skill.name)}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-text-primary">{skill.name}</span>
                  <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-400">
                    项目
                  </span>
                </div>
                {skill.description && (
                  <p className="mt-0.5 truncate text-xs text-text-muted">{skill.description}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {globalSkills.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
            全局技能 ({globalSkills.length})
          </div>
          <div className="space-y-1">
            {globalSkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                className={`w-full rounded-md border px-3 py-2 text-left transition ${
                  detail?.name === skill.name
                    ? "border-[var(--settings-accent-border-strong)] bg-[var(--settings-accent-subtle-bg)]"
                    : "border-border bg-surface-card hover:bg-surface-hover"
                }`}
                onClick={() => void onViewDetail(skill.name)}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-text-primary">{skill.name}</span>
                  <span className="shrink-0 rounded-full border border-border bg-surface-panel px-1.5 text-[10px] text-text-faint">
                    全局
                  </span>
                </div>
                {skill.description && (
                  <p className="mt-0.5 truncate text-xs text-text-muted">{skill.description}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* === Marketplace Browser === */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-subtle">
          浏览市场
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
                  disabled={registryInstallBusy || marketLoading}
                  onClick={() => void onMarketInstall(item)}
                >
                  {registryInstallBusy ? "安装中…" : "安装"}
                </button>
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
        panes={panes}
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
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  "aria-label"?: string;
}) {
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
      className={`relative h-7 w-12 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/55 disabled:opacity-40 ${
        checked ? "bg-emerald-500" : "bg-surface-hover"
      }`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
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
      setMessage("已保存。之后装扩展包或市场技能时，是否跳过确认由本开关与安装前扫描结果一起决定（与后端共用同一份配置）。");
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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div>启用观察式学习</div>
            <div className="mt-0.5 text-[11px] text-text-faint">agent 自动沉淀高频操作为可复用知识</div>
          </div>
          <SettingsSwitch
            checked={form.learning_enabled}
            disabled={saving}
            onChange={(next) => void update({ learning_enabled: next })}
            aria-label="启用观察式学习"
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
  skills: Array<{ skill_name: string; verdict: string; findings?: Array<{ pattern_name: string }> }>;
}): string {
  const verdictLabel = (v: string) =>
    v === "dangerous" ? "高危" : v === "caution" ? "需注意" : "未见高危规则";
  const lines = [
    `安装前扫描 · 总体：${verdictLabel(scan.overall)}`,
    ...scan.skills.map(
      (s) =>
        `· ${s.skill_name || "skill"}：${verdictLabel(s.verdict)}${
          s.findings?.length ? `（命中 ${s.findings.length} 条）` : ""
        }`
    ),
  ];
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

function AutomationPreventSleepPanel() {
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
        const result = await window.agenticxDesktop.loadAutomationConfig();
        if (!disposed && result?.ok && result.config) {
          setEnabled(Boolean(result.config.prevent_sleep));
        }
      } catch {
        if (!disposed) setMessage("读取自动化配置失败。");
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
      const result = await window.agenticxDesktop.saveAutomationConfig({ prevent_sleep: next });
      if (!result?.ok) {
        setMessage(result?.error ? String(result.error) : "保存失败。");
        setEnabled(!next);
        return;
      }
      setEnabled(next);
      setMessage("已保存。只要本应用还在跑，系统会更不容易自动睡眠。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败。");
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Panel title="自动化">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="自动化">
      <p className="mb-3 text-xs text-text-faint">
        写入本机 <code className="text-text-subtle">~/.agenticx/config.yaml</code> 中的{" "}
        <code className="text-text-subtle">automation.prevent_sleep</code>。
      </p>
      <SettingsToggleCard
        title="抑制系统睡眠"
        description="向系统申请「推迟睡眠」，减少长跑任务、合盖挂机或远程串联时被系统挂起的概率；退出 Machi 后不再拦截。"
        checked={enabled}
        disabled={saving}
        onChange={(next) => void persist(next)}
      />
      {message ? (
        <div
          className={`mt-2 text-xs ${message.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}
        >
          {message}
        </div>
      ) : null}
    </Panel>
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
  const userPreference = useAppStore((s) => s.userPreference);
  const setUserPreference = useAppStore((s) => s.setUserPreference);
  const initializedForOpenRef = useRef(false);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [active, setActive] = useState(defaultProvider || ALL_PROVIDERS[0]);
  const [draft, setDraft] = useState<Record<string, ProviderEntry>>({});
  const [defProv, setDefProv] = useState(defaultProvider);
  const [keyStatus, setKeyStatus] = useState<Record<string, "idle" | "checking" | "ok" | "fail">>({});
  const [keyError, setKeyError] = useState<Record<string, string>>({});
  const [modelHealthMap, setModelHealthMap] = useState<Record<string, ModelHealth>>({});
  const [fetchingModels, setFetchingModels] = useState(false);
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [newModelInput, setNewModelInput] = useState("");
  const [mcpExtraPaths, setMcpExtraPaths] = useState<string[]>([]);
  const [mcpAutoConnectHint, setMcpAutoConnectHint] = useState<string[]>([]);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpMessage, setMcpMessage] = useState("");

  const [serverMode, setServerMode] = useState<"local" | "remote">("local");
  const [serverUrl, setServerUrl] = useState("");
  const [serverToken, setServerToken] = useState("");
  const [serverTestStatus, setServerTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [serverTestError, setServerTestError] = useState("");
  const [serverShowToken, setServerShowToken] = useState(false);

  const [gwEnabled, setGwEnabled] = useState(false);
  const [gwUrl, setGwUrl] = useState("");
  const [gwDeviceId, setGwDeviceId] = useState("");
  const [gwToken, setGwToken] = useState("");
  const [gwStudioBase, setGwStudioBase] = useState("");
  const [gwShowToken, setGwShowToken] = useState(false);
  const [gwAdvancedOpen, setGwAdvancedOpen] = useState(false);
  const [gwQrOpen, setGwQrOpen] = useState(false);
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
      return;
    }
    // IMPORTANT: only initialize once per open cycle.
    // Otherwise parent re-renders (or async prop updates) can overwrite
    // user's in-panel selection and force active provider back to default.
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;

    const merged: Record<string, ProviderEntry> = {};
    for (const name of ALL_PROVIDERS) {
      const saved = providers[name];
      merged[name] = {
        apiKey: saved?.apiKey ?? "",
        baseUrl: saved?.baseUrl ?? "",
        model: saved?.model ?? "",
        models: saved?.models ?? [],
        dropParams: saved?.dropParams === true,
      };
    }
    for (const [name, saved] of Object.entries(providers)) {
      if (!merged[name]) {
        merged[name] = {
          apiKey: saved?.apiKey ?? "",
          baseUrl: saved?.baseUrl ?? "",
          model: saved?.model ?? "",
          models: saved?.models ?? [],
          dropParams: saved?.dropParams === true,
        };
      }
    }
    setDraft(merged);
    setDefProv(defaultProvider || ALL_PROVIDERS[0]);
    setActive(defaultProvider || ALL_PROVIDERS[0]);
    setKeyStatus({});
    setKeyError({});
    setModelHealthMap({});
    setShowModelPanel(false);
    setMcpMessage("");
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
    if (sessionId) void onRefreshMcp(sessionId);
  }, [open, providers, defaultProvider, sessionId, onRefreshMcp]);

  useEffect(() => {
    if (!open || tab !== "mcp") return;
    void window.agenticxDesktop.getMcpSettings().then((r) => {
      if (r.ok && Array.isArray(r.extra_search_paths)) {
        setMcpExtraPaths([...r.extra_search_paths]);
      }
      if (r.ok && Array.isArray(r.auto_connect)) {
        setMcpAutoConnectHint([...r.auto_connect]);
      }
    });
  }, [open, tab]);

  const persistMcpExtraPaths = useCallback(
    async (next: string[]) => {
      const cleaned = next.map((x) => x.trim()).filter(Boolean);
      setMcpBusy(true);
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
        setMcpBusy(false);
      }
    },
    [sessionId, onRefreshMcp]
  );

  const current = useMemo(
    () => draft[active] ?? { apiKey: "", baseUrl: "", model: "", models: [], dropParams: false },
    [draft, active]
  );

  const updateField = useCallback(
    (field: keyof ProviderEntry, value: string | string[] | boolean) => {
      setDraft((prev) => ({ ...prev, [active]: { ...prev[active], [field]: value } }));
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
    setModelHealthMap((p) => ({ ...p, [key]: "checking" }));
    const res = await window.agenticxDesktop.healthCheckModel({ provider: active, apiKey: current.apiKey, baseUrl: current.baseUrl || undefined, model });
    setModelHealthMap((p) => ({ ...p, [key]: res.ok ? "healthy" : "error" }));
  };

  const onRemoveModel = (model: string) => updateField("models", current.models.filter((m) => m !== model));

  const onAddModel = () => {
    const name = newModelInput.trim();
    if (!name || current.models.includes(name)) return;
    updateField("models", [...current.models, name]);
    setNewModelInput("");
  };

  /** Normalize base_url: strip trailing slash; if no version segment (/v1, /v2…), append /v1. */
  const normalizeBaseUrl = (url: string): string => {
    const b = url.trim().replace(/\/+$/, "");
    if (!b) return b;
    return /\/v\d(\/|$)/.test(b) ? b : `${b}/v1`;
  };

  const handleSave = async () => {
    const normalized: Record<string, ProviderEntry> = {};
    for (const [name, entry] of Object.entries(draft)) {
      normalized[name] = { ...entry, baseUrl: normalizeBaseUrl(entry.baseUrl) };
    }
    await onSave({ defaultProvider: defProv, providers: normalized });
    onClose();
  };

  const handleConnectMcp = async (name: string) => {
    if (!sessionId) return;
    setMcpBusy(true);
    setMcpMessage("");
    try {
      const result = await window.agenticxDesktop.connectMcp({ sessionId, name });
      if (result.ok) {
        await onRefreshMcp(sessionId);
        const hint = await window.agenticxDesktop.getMcpSettings();
        if (hint.ok && Array.isArray(hint.auto_connect)) {
          setMcpAutoConnectHint([...hint.auto_connect]);
        }
        setMcpMessage(`已连接 ${name}；下次启动 Machi 将自动重连此项。`);
      } else {
        setMcpMessage(`连接失败: ${result.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMcpMessage(`连接失败: ${String(err)}`);
    } finally {
      setMcpBusy(false);
    }
  };

  const handleDisconnectMcp = async (name: string) => {
    if (!sessionId) return;
    setMcpBusy(true);
    setMcpMessage("");
    try {
      const result = await window.agenticxDesktop.disconnectMcp({ sessionId, name });
      if (result.ok) {
        await onRefreshMcp(sessionId);
        const hint = await window.agenticxDesktop.getMcpSettings();
        if (hint.ok && Array.isArray(hint.auto_connect)) {
          setMcpAutoConnectHint([...hint.auto_connect]);
        }
        setMcpMessage(`已断开 ${name}，且不再自动连接。`);
      } else {
        setMcpMessage(`断开失败: ${result.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMcpMessage(`断开失败: ${String(err)}`);
    } finally {
      setMcpBusy(false);
    }
  };

  if (!open) return null;

  const ks = keyStatus[active] ?? "idle";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      {/* 固定为视口比例，避免切换 tab 时随内容伸缩；长内容在右侧滚动区内滚动 */}
      <div className="flex h-[min(85vh,calc(100dvh-2rem))] w-[min(90vw,51.25rem)] max-w-[calc(100vw-2rem)] shrink-0 overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-2xl">
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
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
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
            {/* === GENERAL TAB === */}
            {tab === "general" && (
              <div className="space-y-4">
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
                <Panel title="我的档案">
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
                  <label className="mt-4 block text-sm text-text-muted">
                    个人偏好与风格
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
                    {`${userPreference.length}/500 字。此偏好会注入到每次对话的系统提示中，对所有 agent 生效。`}
                  </p>
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
                </Panel>
                <ComputerUseGeneralPanel />
                <SessionMemoryPanel />
                <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs text-text-subtle">
                  当前版本：AgenticX Desktop v0.2.0
                </div>
              </div>
            )}

            {/* === PROVIDER TAB === */}
            {tab === "provider" && (
              <div className="flex gap-3">
                {/* Provider sub-list */}
                <div className="w-[140px] shrink-0 space-y-0.5 overflow-y-auto rounded-md border border-border bg-surface-card py-1">
                  {providerNames.map((name) => {
                    const hasKey = !!draft[name]?.apiKey;
                    return (
                      <button
                        key={name}
                        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition ${
                          active === name ? "bg-[var(--settings-accent-row-bg)] text-[var(--settings-accent-fg)]" : "text-text-subtle hover:bg-surface-hover hover:text-text-primary"
                        }`}
                        onClick={() => { setActive(name); setShowModelPanel(false); }}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasKey ? "bg-emerald-400" : "bg-surface-hover"}`} />
                        <span className="truncate">{name}</span>
                        {name === defProv && <span className="ml-auto shrink-0 rounded bg-[var(--settings-accent-badge-bg)] px-1 text-[9px] text-[var(--settings-accent-fg)]">默认</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Provider detail */}
                <div className="flex-1 space-y-3">
                  {!showModelPanel ? (
                    <>
                      <label className="block text-sm text-text-muted">
                        API 密钥
                        <div className="mt-1 flex gap-2">
                          <input
                            type="password"
                            className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                            value={current.apiKey}
                            onChange={(e) => updateField("apiKey", e.target.value)}
                            placeholder="sk-..."
                          />
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
                      {DROP_PARAMS_CAPABLE_PROVIDERS.has(active) && (
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
                      <label className="block text-sm text-text-muted">
                        默认模型
                        {current.models.length > 0 ? (
                          <select className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm" value={current.model} onChange={(e) => updateField("model", e.target.value)}>
                            <option value="">请选择</option>
                            {current.models.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : (
                          <input className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm" value={current.model} onChange={(e) => updateField("model", e.target.value)} placeholder="gpt-4o / glm-5 / doubao-seed-..." />
                        )}
                      </label>
                      <div className="flex items-center gap-3">
                        {defProv !== active && (
                          <button
                            type="button"
                            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                            onClick={() => setDefProv(active)}
                          >
                            设为默认 Provider
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                          onClick={() => setShowModelPanel(true)}
                        >
                          管理模型
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mb-3 flex gap-2">
                        <button className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-40" disabled={fetchingModels || !current.apiKey} onClick={onFetchModels}>
                          {fetchingModels ? "获取中..." : "从 API 获取模型"}
                        </button>
                        <button className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong" onClick={() => setShowModelPanel(false)}>
                          ← 返回
                        </button>
                      </div>
                      <div className="mb-3 flex gap-2">
                        <input className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm" value={newModelInput} onChange={(e) => setNewModelInput(e.target.value)} placeholder="手动添加模型名..." onKeyDown={(e) => { if (e.key === "Enter") onAddModel(); }} />
                        <button className="shrink-0 rounded-md bg-[var(--settings-accent-solid)] px-3 py-1.5 text-xs font-medium text-[var(--settings-accent-solid-text)] transition hover:bg-[var(--settings-accent-solid-hover)] disabled:opacity-40" disabled={!newModelInput.trim()} onClick={onAddModel}>
                          添加
                        </button>
                      </div>
                      {current.models.length === 0 && <div className="py-6 text-center text-sm text-text-faint">暂无模型</div>}
                      <div className="space-y-1">
                        {current.models.map((model) => {
                          const hk = `${active}:${model}`;
                          const health = modelHealthMap[hk] ?? "idle";
                          return (
                            <div key={model} className="flex items-center gap-2 rounded-md border border-border bg-surface-panel/50 px-3 py-2">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${health === "healthy" ? "bg-emerald-400" : health === "error" ? "bg-rose-400" : health === "checking" ? "bg-amber-400 animate-pulse" : "bg-surface-hover"}`} />
                              <span className="flex-1 truncate text-sm text-text-muted">{model}</span>
                              {model === current.model && <span className="shrink-0 rounded bg-[var(--settings-accent-badge-bg)] px-1.5 text-[10px] text-[var(--settings-accent-fg)]">默认</span>}
                              <button className="shrink-0 text-xs text-text-faint transition hover:text-[var(--settings-accent-fg)] disabled:opacity-40" disabled={health === "checking" || !current.apiKey} onClick={() => onHealthCheck(model)}>
                                {health === "checking" ? "..." : "检测"}
                              </button>
                              <button className="shrink-0 text-xs text-text-faint transition hover:text-[var(--settings-accent-fg)]" onClick={() => updateField("model", model)}>⚙</button>
                              <button className="shrink-0 text-xs text-text-faint transition hover:text-rose-400" onClick={() => onRemoveModel(model)}>—</button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* === MCP TAB === */}
            {tab === "mcp" && (
              <div className="space-y-4">
                <div className="text-sm text-text-subtle">
                  MCP（模型上下文协议）服务为 Agent 扩展外部工具 — 文件系统、数据库、网页搜索等。
                </div>
                <div className="space-y-2">
                  <div className="text-xs text-text-faint">
                    配置路径（按顺序合并；同名服务以先出现的为准）。主路径固定；点 + 添加其他 mcp.json（如 Cursor、OpenClaw）。
                  </div>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      className="flex-1 cursor-not-allowed rounded-md border border-border bg-surface-panel/60 px-2 py-1.5 text-sm text-text-muted"
                      value={MCP_PRIMARY_CONFIG_PATH}
                      aria-label="主 MCP 配置路径"
                    />
                    <span className="shrink-0 self-center text-[10px] text-text-faint">主配置</span>
                  </div>
                  {mcpExtraPaths.map((row, idx) => (
                    <div key={`mcp-path-${idx}`} className="flex gap-2">
                      <input
                        className="flex-1 rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
                        value={row}
                        placeholder="例如 ~/.cursor/mcp.json"
                        onChange={(e) => {
                          const v = e.target.value;
                          setMcpExtraPaths((prev) => prev.map((p, i) => (i === idx ? v : p)));
                        }}
                        onBlur={(e) => {
                          const v = e.target.value;
                          const next = mcpExtraPaths.map((p, i) => (i === idx ? v : p));
                          void persistMcpExtraPaths(next);
                        }}
                        disabled={mcpBusy}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-border p-2 text-text-subtle transition hover:bg-surface-hover hover:text-rose-400 disabled:opacity-40"
                        title="移除此路径"
                        disabled={mcpBusy}
                        onClick={() => {
                          const next = mcpExtraPaths.filter((_, i) => i !== idx);
                          setMcpExtraPaths(next);
                          void persistMcpExtraPaths(next);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                    disabled={mcpBusy}
                    onClick={() => setMcpExtraPaths((prev) => [...prev, ""])}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    添加配置路径
                  </button>
                </div>
                {mcpAutoConnectHint.length > 0 ? (
                  <div className="text-xs text-text-faint">
                    下次启动将自动连接：
                    <span className="text-text-subtle">{mcpAutoConnectHint.join("、")}</span>
                  </div>
                ) : null}
                {mcpMessage && <div className="text-xs text-text-subtle">{mcpMessage}</div>}
                <div className="space-y-1.5">
                  {mcpServers.length === 0 ? (
                    <div className="py-6 text-center text-sm text-text-faint">
                      尚未发现 MCP 服务。请确认主配置或附加路径中的 mcp.json 有效。
                    </div>
                  ) : (
                    mcpServers.map((server) => (
                      <div key={server.name} className="flex items-center gap-2 rounded-md border border-border bg-surface-card px-3 py-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${server.connected ? "bg-emerald-400" : "bg-surface-hover"}`} />
                        <span className="flex-1 truncate text-sm text-text-muted">{server.name}</span>
                        <span className="max-w-[220px] truncate text-[10px] text-text-faint">{server.command ?? ""}</span>
                        <SettingsSwitch
                          checked={server.connected}
                          disabled={mcpBusy || !sessionId}
                          onChange={(next) => {
                            if (next) void handleConnectMcp(server.name);
                            else void handleDisconnectMcp(server.name);
                          }}
                          aria-label={
                            server.connected ? `已连接 ${server.name}，关闭以断开` : `连接 ${server.name}`
                          }
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* === SKILLS TAB === */}
            {tab === "tools" && <ToolsTab />}

            {/* === SKILLS TAB === */}
            {tab === "skills" && (
              <div className="space-y-4">
                <SkillsTab />
                <SkillAdvancedPanel />
              </div>
            )}

            {tab === "automation" && (
              <div className="space-y-4">
                <AutomationPreventSleepPanel />
              </div>
            )}

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

                <Panel title="远程指令（IM 网关）">
                  <p className="mb-3 text-xs text-text-faint">
                    连接云端 Webhook 网关后，可通过飞书/企微机器人向本机 Machi 下发指令。推荐扫码打开手机引导页完成绑定；亦可在 IM 中手动发送「绑定 &lt;绑定码&gt;」。网关
                    <code className="mx-0.5 rounded bg-surface-hover px-1">gateway_config.yaml</code>
                    须为该设备配置 binding_code。
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
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
                        网关 WebSocket 基址（https:// 将自动转为 wss://）
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="https://gateway.example.com"
                          value={gwUrl}
                          onChange={(e) => setGwUrl(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm text-text-muted">
                        设备 ID（与网关 devices.auth_tokens 中一致）
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
                      <label className="block text-sm text-text-muted">
                        本机 Studio 基址（留空则使用 http://127.0.0.1:当前端口）
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-subtle"
                          placeholder="http://127.0.0.1:8000"
                          value={gwStudioBase}
                          onChange={(e) => setGwStudioBase(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        className="rounded-md border border-border px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-hover"
                        onClick={async () => {
                          await window.agenticxDesktop.saveGatewayIm({
                            enabled: gwEnabled,
                            url: gwUrl.trim().replace(/\/+$/, ""),
                            deviceId: gwDeviceId.trim(),
                            token: gwToken.trim(),
                            studioBaseUrl: gwStudioBase.trim().replace(/\/+$/, ""),
                          });
                          alert(
                            "IM 网关配置已保存。需重启 Machi / agx serve 后生效；也可使用「扫码连接」或手动发送「绑定 <绑定码>」。",
                          );
                          void refreshGwBindings();
                        }}
                      >
                        保存 IM 网关配置
                      </button>
                    </div>
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

                <div className="flex items-center gap-3">
                  <button
                    className="rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
                    onClick={async () => {
                      await window.agenticxDesktop.saveRemoteServer({
                        enabled: serverMode === "remote",
                        url: serverUrl.trim().replace(/\/+$/, ""),
                        token: serverToken.trim(),
                      });
                      alert("服务器连接配置已保存。切换模式需要重启 Machi 才能生效。");
                    }}
                  >
                    保存服务器配置
                  </button>
                </div>

                <div className="rounded-md border border-border bg-surface-card px-3 py-2.5 text-xs text-text-subtle space-y-1">
                  <p>远程部署参考：</p>
                  <p>1. 在云主机上安装 agenticx: <code className="text-text-muted">pip install agenticx</code></p>
                  <p>2. 启动服务: <code className="text-text-muted">agx serve --host 0.0.0.0 --port 8080 --token YOUR_TOKEN</code></p>
                  <p>3. 确保防火墙放行对应端口，生产环境建议配置 HTTPS (Nginx 反向代理)。</p>
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
  );
}
