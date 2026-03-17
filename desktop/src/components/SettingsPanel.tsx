import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ALL_PROVIDERS = [
  "openai", "anthropic", "volcengine", "bailian",
  "zhipu", "qianfan", "minimax", "kimi", "ollama",
] as const;

type ProviderEntry = {
  apiKey: string;
  baseUrl: string;
  model: string;
  models: string[];
};

type McpServer = {
  name: string;
  connected: boolean;
  command?: string;
};

type SettingsTab = "general" | "provider" | "mcp" | "email" | "workspace";
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

type Props = {
  open: boolean;
  defaultProvider: string;
  providers: Record<string, ProviderEntry>;
  sessionId: string;
  mcpServers: McpServer[];
  onRefreshMcp: (sessionId?: string) => Promise<void>;
  confirmStrategy: ConfirmMode;
  onConfirmStrategyChange: (strategy: ConfirmMode) => Promise<void> | void;
  onClose: () => void;
  onSave: (result: {
    defaultProvider: string;
    providers: Record<string, ProviderEntry>;
  }) => Promise<void>;
};

type ModelHealth = "idle" | "checking" | "healthy" | "error";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "通用" },
  { id: "provider", label: "模型与 API" },
  { id: "mcp", label: "MCP 服务" },
  { id: "email", label: "邮件通知" },
  { id: "workspace", label: "工作区" },
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
    return <div className="py-8 text-center text-sm text-slate-500">加载邮件配置中...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/60 bg-slate-900/40 p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-slate-200">SMTP 配置</div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="h-3.5 w-3.5"
              checked={form.enabled}
              onChange={(e) => updateField("enabled", e.target.checked)}
            />
            启用邮件通知
          </label>
        </div>

        <div className="space-y-3">
          <label className="block text-sm text-slate-300">
            SMTP 预设
            <select
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
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

          <label className="block text-sm text-slate-300">
            SMTP Host
            <input
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
              value={form.smtp_host}
              onChange={(e) => updateField("smtp_host", e.target.value)}
              placeholder="smtp.qq.com"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-slate-300">
              SMTP Port
              <input
                type="number"
                className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                value={String(form.smtp_port)}
                onChange={(e) => updateField("smtp_port", Number(e.target.value) || 0)}
              />
            </label>
            <label className="block text-sm text-slate-300">
              TLS
              <select
                className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                value={form.smtp_use_tls ? "true" : "false"}
                onChange={(e) => updateField("smtp_use_tls", e.target.value === "true")}
              >
                <option value="true">启用</option>
                <option value="false">关闭</option>
              </select>
            </label>
          </div>

          <label className="block text-sm text-slate-300">
            SMTP 用户名
            <input
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
              value={form.smtp_username}
              onChange={(e) => updateField("smtp_username", e.target.value)}
              placeholder="your_email@qq.com"
            />
          </label>

          <label className="block text-sm text-slate-300">
            SMTP 授权码 / 密码
            <input
              type="password"
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
              value={form.smtp_password}
              onChange={(e) => updateField("smtp_password", e.target.value)}
              placeholder="应用专用密码"
            />
          </label>

          <label className="block text-sm text-slate-300">
            发件邮箱
            <input
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
              value={form.from_email}
              onChange={(e) => updateField("from_email", e.target.value)}
              placeholder="your_email@qq.com"
            />
          </label>

          <label className="block text-sm text-slate-300">
            默认收件邮箱
            <input
              className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
              value={form.default_to_email}
              onChange={(e) => updateField("default_to_email", e.target.value)}
              placeholder="bingzhenli@hotmail.com"
            />
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-700 disabled:opacity-40"
          onClick={onTestSend}
          disabled={testing || saving}
        >
          {testing ? "测试中..." : "测试发送"}
        </button>
        <button
          className="rounded-md bg-cyan-400 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-cyan-300 disabled:opacity-40"
          onClick={onSave}
          disabled={testing || saving}
        >
          {saving ? "保存中..." : "保存邮件配置"}
        </button>
        {message && <div className="text-xs text-slate-400">{message}</div>}
      </div>
    </div>
  );
}

export function SettingsPanel({
  open,
  defaultProvider,
  providers,
  sessionId,
  mcpServers,
  onRefreshMcp,
  confirmStrategy,
  onConfirmStrategyChange,
  onClose,
  onSave,
}: Props) {
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
  const [mcpImportPath, setMcpImportPath] = useState("~/.cursor/mcp.json");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpMessage, setMcpMessage] = useState("");

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
      };
    }
    for (const [name, saved] of Object.entries(providers)) {
      if (!merged[name]) {
        merged[name] = { apiKey: saved?.apiKey ?? "", baseUrl: saved?.baseUrl ?? "", model: saved?.model ?? "", models: saved?.models ?? [] };
      }
    }
    setDraft(merged);
    setDefProv(defaultProvider || ALL_PROVIDERS[0]);
    setActive(defaultProvider || ALL_PROVIDERS[0]);
    setKeyStatus({});
    setKeyError({});
    setModelHealthMap({});
    setShowModelPanel(false);
    setMcpImportPath("~/.cursor/mcp.json");
    setMcpMessage("");
    if (sessionId) void onRefreshMcp(sessionId);
  }, [open, providers, defaultProvider, sessionId, onRefreshMcp]);

  const current = useMemo(() => draft[active] ?? { apiKey: "", baseUrl: "", model: "", models: [] }, [draft, active]);

  const updateField = useCallback(
    (field: keyof ProviderEntry, value: string | string[]) => {
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

  const handleSave = async () => {
    await onSave({ defaultProvider: defProv, providers: draft });
    onClose();
  };

  const handleImportMcp = async () => {
    if (!sessionId || !mcpImportPath.trim()) return;
    setMcpBusy(true);
    setMcpMessage("");
    try {
      const result = await window.agenticxDesktop.importMcpConfig({ sessionId, sourcePath: mcpImportPath.trim() });
      if (result.ok) {
        await onRefreshMcp(sessionId);
        setMcpMessage(`导入成功: imported=${String(result.total_imported ?? 0)}, total=${String(result.total_servers ?? 0)}`);
      } else {
        setMcpMessage(`导入失败: ${result.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMcpMessage(`导入失败: ${String(err)}`);
    } finally {
      setMcpBusy(false);
    }
  };

  const handleConnectMcp = async (name: string) => {
    if (!sessionId) return;
    setMcpBusy(true);
    setMcpMessage("");
    try {
      const result = await window.agenticxDesktop.connectMcp({ sessionId, name });
      if (result.ok) {
        await onRefreshMcp(sessionId);
        setMcpMessage(`连接成功: ${name}`);
      } else {
        setMcpMessage(`连接失败: ${result.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMcpMessage(`连接失败: ${String(err)}`);
    } finally {
      setMcpBusy(false);
    }
  };

  if (!open) return null;

  const ks = keyStatus[active] ?? "idle";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-[780px] max-w-[95vw] overflow-hidden rounded-xl border border-border bg-panel">
        {/* Left: tab navigation */}
        <div className="flex w-[160px] shrink-0 flex-col border-r border-border bg-slate-900/60">
          <div className="border-b border-border px-3 py-2.5 text-sm font-semibold text-slate-200">设置</div>
          <div className="flex-1 py-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`flex w-full px-3 py-2 text-left text-sm transition ${
                  tab === t.id ? "bg-cyan-500/15 text-cyan-400" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                }`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-slate-200">
              {TABS.find((t) => t.id === tab)?.label ?? "设置"}
            </h3>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={onClose}>✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {/* === GENERAL TAB === */}
            {tab === "general" && (
              <div className="space-y-4">
                <div className="rounded-md border border-border/60 bg-slate-900/40 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-200">工具执行权限模式</div>
                  <select
                    className="w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
                    value={confirmStrategy}
                    onChange={(e) => void onConfirmStrategyChange(e.target.value as ConfirmMode)}
                  >
                    <option value="manual">Ask Every Time</option>
                    <option value="semi-auto">Use Allowlist</option>
                    <option value="auto">Run Everything</option>
                  </select>
                  <div className="mt-2 text-xs text-slate-400">
                    {confirmStrategy === "manual"
                      ? "每次工具执行都询问确认（最安全）。"
                      : confirmStrategy === "semi-auto"
                        ? "命中同类操作白名单自动放行，未命中时询问（推荐）。"
                        : "默认全部自动执行，不再询问（高风险）。"}
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-slate-900/40 px-3 py-2.5 text-xs text-slate-400">
                  当前版本：AgenticX Desktop v0.2.0
                </div>
              </div>
            )}

            {/* === PROVIDER TAB === */}
            {tab === "provider" && (
              <div className="flex gap-3">
                {/* Provider sub-list */}
                <div className="w-[140px] shrink-0 space-y-0.5 overflow-y-auto rounded-md border border-border/50 bg-slate-900/30 py-1">
                  {providerNames.map((name) => {
                    const hasKey = !!draft[name]?.apiKey;
                    return (
                      <button
                        key={name}
                        className={`flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs transition ${
                          active === name ? "bg-cyan-500/15 text-cyan-400" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        }`}
                        onClick={() => { setActive(name); setShowModelPanel(false); }}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasKey ? "bg-emerald-400" : "bg-slate-600"}`} />
                        <span className="truncate">{name}</span>
                        {name === defProv && <span className="ml-auto shrink-0 rounded bg-cyan-500/20 px-1 text-[9px] text-cyan-400">默认</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Provider detail */}
                <div className="flex-1 space-y-3">
                  {!showModelPanel ? (
                    <>
                      <label className="block text-sm text-slate-300">
                        API 密钥
                        <div className="mt-1 flex gap-2">
                          <input
                            type="password"
                            className="flex-1 rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                            value={current.apiKey}
                            onChange={(e) => updateField("apiKey", e.target.value)}
                            placeholder="sk-..."
                          />
                          <button
                            className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                              ks === "checking" ? "border-amber-500/50 text-amber-400"
                                : ks === "ok" ? "border-emerald-500/50 text-emerald-400"
                                : ks === "fail" ? "border-rose-500/50 text-rose-400"
                                : "border-border text-slate-400 hover:text-white"
                            }`}
                            disabled={ks === "checking" || !current.apiKey}
                            onClick={onValidateKey}
                          >
                            {ks === "checking" ? "检测中..." : ks === "ok" ? "有效 ✓" : ks === "fail" ? "失败 ✗" : "检 测"}
                          </button>
                        </div>
                        {ks === "fail" && keyError[active] && <div className="mt-1 text-xs text-rose-400">{keyError[active]}</div>}
                      </label>
                      <label className="block text-sm text-slate-300">
                        API 地址 <span className="text-xs text-slate-500">(留空使用默认)</span>
                        <input className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm" value={current.baseUrl} onChange={(e) => updateField("baseUrl", e.target.value)} placeholder="https://..." />
                      </label>
                      <label className="block text-sm text-slate-300">
                        默认模型
                        {current.models.length > 0 ? (
                          <select className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm" value={current.model} onChange={(e) => updateField("model", e.target.value)}>
                            <option value="">请选择</option>
                            {current.models.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        ) : (
                          <input className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm" value={current.model} onChange={(e) => updateField("model", e.target.value)} placeholder="gpt-4o / glm-5 / doubao-seed-..." />
                        )}
                      </label>
                      <div className="flex items-center gap-3">
                        {defProv !== active && (
                          <button className="rounded-md border border-cyan-500/30 px-3 py-1.5 text-xs text-cyan-400 transition hover:bg-cyan-500/10" onClick={() => setDefProv(active)}>
                            设为默认 Provider
                          </button>
                        )}
                        <button className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white" onClick={() => setShowModelPanel(true)}>
                          管理模型
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mb-3 flex gap-2">
                        <button className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white disabled:opacity-40" disabled={fetchingModels || !current.apiKey} onClick={onFetchModels}>
                          {fetchingModels ? "获取中..." : "从 API 获取模型"}
                        </button>
                        <button className="rounded-md border border-border px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white" onClick={() => setShowModelPanel(false)}>
                          ← 返回
                        </button>
                      </div>
                      <div className="mb-3 flex gap-2">
                        <input className="flex-1 rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm" value={newModelInput} onChange={(e) => setNewModelInput(e.target.value)} placeholder="手动添加模型名..." onKeyDown={(e) => { if (e.key === "Enter") onAddModel(); }} />
                        <button className="shrink-0 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-black transition hover:bg-cyan-400 disabled:opacity-40" disabled={!newModelInput.trim()} onClick={onAddModel}>
                          添加
                        </button>
                      </div>
                      {current.models.length === 0 && <div className="py-6 text-center text-sm text-slate-500">暂无模型</div>}
                      <div className="space-y-1">
                        {current.models.map((model) => {
                          const hk = `${active}:${model}`;
                          const health = modelHealthMap[hk] ?? "idle";
                          return (
                            <div key={model} className="flex items-center gap-2 rounded-md border border-border/50 bg-slate-900/50 px-3 py-2">
                              <span className={`h-2 w-2 shrink-0 rounded-full ${health === "healthy" ? "bg-emerald-400" : health === "error" ? "bg-rose-400" : health === "checking" ? "bg-amber-400 animate-pulse" : "bg-slate-600"}`} />
                              <span className="flex-1 truncate text-sm text-slate-300">{model}</span>
                              {model === current.model && <span className="shrink-0 rounded bg-cyan-500/20 px-1.5 text-[10px] text-cyan-400">默认</span>}
                              <button className="shrink-0 text-xs text-slate-500 transition hover:text-cyan-400 disabled:opacity-40" disabled={health === "checking" || !current.apiKey} onClick={() => onHealthCheck(model)}>
                                {health === "checking" ? "..." : "检测"}
                              </button>
                              <button className="shrink-0 text-xs text-slate-500 transition hover:text-cyan-400" onClick={() => updateField("model", model)}>⚙</button>
                              <button className="shrink-0 text-xs text-slate-500 transition hover:text-rose-400" onClick={() => onRemoveModel(model)}>—</button>
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
                <div className="text-sm text-slate-400">
                  MCP（模型上下文协议）服务为 Agent 扩展外部工具 — 文件系统、数据库、网页搜索等。
                </div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm"
                    value={mcpImportPath}
                    onChange={(e) => setMcpImportPath(e.target.value)}
                    placeholder="外部 mcp.json 路径，例如 ~/.cursor/mcp.json"
                  />
                  <button
                    className="shrink-0 rounded-md border border-cyan-500/30 px-3 py-1.5 text-xs text-cyan-400 transition hover:bg-cyan-500/10 disabled:opacity-40"
                    onClick={handleImportMcp}
                    disabled={mcpBusy || !sessionId || !mcpImportPath.trim()}
                  >
                    导入
                  </button>
                  <button
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-slate-200 disabled:opacity-40"
                    onClick={() => void onRefreshMcp(sessionId)}
                    disabled={!sessionId || mcpBusy}
                  >
                    刷新
                  </button>
                </div>
                {mcpMessage && <div className="text-xs text-slate-400">{mcpMessage}</div>}
                <div className="space-y-1.5">
                  {mcpServers.length === 0 ? (
                    <div className="py-6 text-center text-sm text-slate-500">尚未配置 MCP 服务。点击"导入"连接你的第一个 MCP 工具提供方。</div>
                  ) : (
                    mcpServers.map((server) => (
                      <div key={server.name} className="flex items-center gap-2 rounded-md border border-border/60 bg-slate-900/40 px-3 py-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${server.connected ? "bg-emerald-400" : "bg-slate-600"}`} />
                        <span className="flex-1 truncate text-sm text-slate-300">{server.name}</span>
                        <span className="max-w-[220px] truncate text-[10px] text-slate-500">{server.command ?? ""}</span>
                        {!server.connected && (
                          <button
                            className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-slate-200 disabled:opacity-40"
                            onClick={() => void handleConnectMcp(server.name)}
                            disabled={mcpBusy || !sessionId}
                          >
                            连接
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* === WORKSPACE TAB === */}
            {tab === "email" && <EmailSettingsTab />}

            {/* === WORKSPACE TAB === */}
            {tab === "workspace" && (
              <div className="space-y-4">
                <label className="block text-sm text-slate-300">
                  默认工作区目录
                  <input className="mt-1 w-full rounded-md border border-border bg-slate-900 px-2 py-1.5 text-sm text-slate-400" value="~/.agenticx/workspace" readOnly />
                  <span className="mt-1 block text-xs text-slate-500">修改工作区目录请编辑 ~/.agenticx/config.yaml 中的 workspace_dir 字段</span>
                </label>
                <div className="rounded-md border border-border/60 bg-slate-900/40 px-3 py-2.5 text-xs text-slate-400">
                  每个分身拥有独立工作区，位于 ~/.agenticx/avatars/&lt;id&gt;/workspace。
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            <button className="rounded-md border border-border px-4 py-1.5 text-sm text-slate-400 transition hover:bg-slate-700" onClick={onClose}>
              取消
            </button>
            <button className="rounded-md bg-cyan-400 px-4 py-1.5 text-sm font-medium text-black transition hover:bg-cyan-300" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
