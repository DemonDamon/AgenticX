import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Save, RotateCcw } from "lucide-react";
import type { Avatar } from "../store";

type ToolItem = {
  id: string;
  name: string;
  description: string;
};

const DEFAULT_TOOLS: ToolItem[] = [
  { id: "liteparse", name: "LiteParse", description: "轻量 PDF/Office 文档解析" },
  { id: "mineru", name: "MinerU", description: "深度文档解析" },
  { id: "libreoffice", name: "LibreOffice", description: "Office 格式转换依赖" },
  { id: "imagemagick", name: "ImageMagick", description: "图像转换依赖" },
];

type Tab = "general" | "tools" | "soul";

type Props =
  | { mode: "avatar"; avatar: Avatar; onClose: () => void; onSaved: () => void }
  | { mode: "machi"; onClose: () => void; onSaved: () => void };

export function AvatarSettingsPanel(props: Props) {
  const { mode, onClose, onSaved } = props;
  const avatar = mode === "avatar" ? (props as { avatar: Avatar }).avatar : null;

  const [tab, setTab] = useState<Tab>("general");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // General fields (avatar only)
  const [name, setName] = useState(avatar?.name ?? "");
  const [role, setRole] = useState(avatar?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(avatar?.systemPrompt ?? "");

  // Tools
  const [tools, setTools] = useState<ToolItem[]>(DEFAULT_TOOLS);
  const [toolsEnabled, setToolsEnabled] = useState<Record<string, boolean>>({});
  const [loadingTools, setLoadingTools] = useState(false);

  // SOUL
  const [soulValue, setSoulValue] = useState("");
  const [loadingSoul, setLoadingSoul] = useState(false);

  const title = mode === "avatar" ? `${avatar?.name ?? "分身"} · 设置` : "Machi · 设置";

  const loadTools = useCallback(async () => {
    setLoadingTools(true);
    try {
      const result = await window.agenticxDesktop.getToolsStatus();
      if (result?.ok && Array.isArray(result.tools) && result.tools.length > 0) {
        setTools(
          result.tools.map((item) => ({
            id: String(item.id),
            name: String(item.name),
            description: String(item.description || ""),
          })),
        );
      }
    } finally {
      setLoadingTools(false);
    }
  }, []);

  const loadSoul = useCallback(async () => {
    setLoadingSoul(true);
    try {
      if (mode === "avatar" && avatar) {
        const res = await window.agenticxDesktop.loadAvatarSoul({ avatarId: avatar.id });
        setSoulValue(res?.ok ? String(res.content ?? "") : "");
      } else {
        const res = await window.agenticxDesktop.loadMetaSoul();
        setSoulValue(res?.ok ? String(res.content ?? "") : "");
      }
    } finally {
      setLoadingSoul(false);
    }
  }, [mode, avatar]);

  useEffect(() => {
    if (mode === "avatar" && avatar) {
      setToolsEnabled({ ...(avatar.toolsEnabled ?? {}) });
    } else {
      void (async () => {
        const policy = await window.agenticxDesktop.getToolsPolicy();
        setToolsEnabled(policy?.ok ? policy.tools_enabled ?? {} : {});
      })();
    }
    void loadTools();
    void loadSoul();
  }, [mode, avatar, loadTools, loadSoul]);

  const customizedCount = useMemo(
    () => Object.keys(toolsEnabled).filter((key) => toolsEnabled[key] !== undefined).length,
    [toolsEnabled],
  );

  const toolsModeHint =
    mode === "avatar"
      ? "未设置项继承 Machi 全局策略；如全局未设置，则默认启用。"
      : "Machi 全局策略将作为所有分身默认值；未设置项默认启用。";

  const handleSaveGeneral = async () => {
    if (mode !== "avatar" || !avatar) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await window.agenticxDesktop.updateAvatar({
        id: avatar.id,
        name: name.trim() || avatar.name,
        role: role.trim(),
        system_prompt: systemPrompt.trim(),
      });
      setMessage(res?.ok ? "已保存" : `保存失败: ${res?.error ?? "未知错误"}`);
      if (res?.ok) onSaved();
    } catch (err) {
      setMessage(`保存失败: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTools = async () => {
    setSaving(true);
    setMessage("");
    try {
      if (mode === "avatar" && avatar) {
        const res = await window.agenticxDesktop.updateAvatar({
          id: avatar.id,
          tools_enabled: { ...toolsEnabled },
        });
        setMessage(res?.ok ? "已保存" : `保存失败: ${res?.error ?? "未知错误"}`);
        if (res?.ok) onSaved();
      } else {
        const res = await window.agenticxDesktop.saveToolsPolicy({ tools_enabled: { ...toolsEnabled } });
        setMessage(res?.ok ? "已保存" : `保存失败: ${res?.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMessage(`保存失败: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSoul = async () => {
    setSaving(true);
    setMessage("");
    try {
      if (mode === "avatar" && avatar) {
        const res = await window.agenticxDesktop.saveAvatarSoul({ avatarId: avatar.id, content: soulValue });
        setMessage(res?.ok ? "已保存，下一轮对话生效。" : `保存失败: ${res?.error ?? "未知错误"}`);
      } else {
        const res = await window.agenticxDesktop.saveMetaSoul({ content: soulValue });
        setMessage(res?.ok ? "已保存，下一轮 Machi 对话生效。" : `保存失败: ${res?.error ?? "未知错误"}`);
      }
    } catch (err) {
      setMessage(`保存失败: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: Tab; label: string }[] =
    mode === "avatar"
      ? [
          { id: "general", label: "基本信息" },
          { id: "tools", label: "工具权限" },
          { id: "soul", label: "SOUL" },
        ]
      : [
          { id: "tools", label: "工具权限（全局）" },
          { id: "soul", label: "Meta SOUL" },
        ];

  const activeTab = tabs.find((t) => t.id === tab) ? tab : tabs[0].id;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-none">
      <div
        className="flex h-[min(85vh,640px)] w-[min(90vw,640px)] flex-col overflow-hidden rounded-2xl border border-border shadow-2xl"
        style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-panel px-4 py-3">
          <button
            className="rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-sm font-semibold text-text-strong">{title}</div>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-1 border-b border-border bg-surface-sidebar px-4 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`mb-1 rounded-[10px] border px-3 py-1.5 text-xs font-medium transition ${
                activeTab === t.id
                  ? "border-border-strong bg-surface-card text-text-strong"
                  : "border-transparent text-text-subtle hover:border-border-strong hover:bg-surface-card hover:text-text-strong"
              }`}
              onClick={() => {
                setTab(t.id);
                setMessage("");
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {activeTab === "general" && mode === "avatar" && (
            <div className="space-y-4">
              <p className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-subtle">
                `System Prompt` 用于定义该分身的即时行为规则；`SOUL` 用于长期风格偏好与策略。两者会一起生效，
                互不替代。
              </p>
              <label className="block text-sm text-text-muted">
                名称
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="分身名称"
                />
              </label>
              <label className="block text-sm text-text-muted">
                角色
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="例：全栈开发工程师、数据分析师"
                />
              </label>
              <label className="block text-sm text-text-muted">
                System Prompt
                <textarea
                  className="mt-1 min-h-[120px] w-full resize-y rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="例如：你是资深前端工程师，先给结论，再给步骤；代码优先给可直接运行版本。"
                />
              </label>
              <div className="flex justify-end">
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving || !name.trim()}
                  onClick={() => void handleSaveGeneral()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "tools" && (
            <div className="space-y-3">
              <p className="text-xs text-text-faint">
                {customizedCount > 0 ? `已自定义 ${customizedCount} 项` : "未自定义（使用默认）"} · {toolsModeHint}
              </p>
              {loadingTools ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  加载工具列表中...
                </div>
              ) : (
                <div className="space-y-2">
                  {tools.map((tool) => {
                    const inherited = !(tool.id in toolsEnabled);
                    const enabled = inherited ? true : Boolean(toolsEnabled[tool.id]);
                    const stateLabel = inherited ? "默认" : enabled ? "启用" : "禁用";
                    return (
                      <div key={tool.id} className="rounded-md border border-border bg-surface-card px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-text-primary">{tool.name}</div>
                            <div className="truncate text-xs text-text-faint">{tool.description}</div>
                          </div>
                          <button
                            type="button"
                            className={`inline-flex min-w-[72px] items-center justify-center rounded border px-2 py-0.5 text-xs transition ${
                              inherited
                                ? "border-border text-text-faint"
                                : enabled
                                  ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-400"
                                  : "border-border-strong bg-surface-hover text-text-muted"
                            }`}
                            onClick={() => {
                              setToolsEnabled((prev) => {
                                const next = { ...prev };
                                if (!(tool.id in next)) {
                                  next[tool.id] = false;
                                } else if (next[tool.id] === false) {
                                  delete next[tool.id];
                                } else {
                                  next[tool.id] = false;
                                }
                                return next;
                              });
                            }}
                          >
                            {stateLabel}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  className="flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs text-text-subtle transition hover:bg-surface-hover disabled:opacity-40"
                  onClick={() => setToolsEnabled({})}
                  disabled={customizedCount === 0 || saving}
                >
                  <RotateCcw className="h-3 w-3" />
                  重置默认
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving}
                  onClick={() => void handleSaveTools()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "soul" && (
            <div className="space-y-3">
              <p className="text-xs text-text-faint">
                支持自由 Markdown 文本。该配置用于塑造{" "}
                {mode === "avatar" ? "当前分身" : "Machi（Meta-Agent）"} 的长期行为风格。
              </p>
              {loadingSoul ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  加载中...
                </div>
              ) : (
                <textarea
                  className="min-h-[220px] w-full resize-y rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={soulValue}
                  onChange={(e) => setSoulValue(e.target.value)}
                  placeholder="例如：先给结论，再给证据；避免重复确认；把进度和风险讲清楚。"
                />
              )}
              <div className="flex justify-end">
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving}
                  onClick={() => void handleSaveSoul()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer message */}
        {message && (
          <div className="shrink-0 border-t border-border bg-surface-panel px-4 py-2">
            <div
              className={`text-xs ${message.startsWith("已保存") ? "text-emerald-400" : "text-rose-400"}`}
            >
              {message}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
