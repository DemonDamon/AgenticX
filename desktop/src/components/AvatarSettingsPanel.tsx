import { useCallback, useEffect, useMemo, useState } from "react";
import { Save, RotateCcw, X } from "lucide-react";
import type { Avatar } from "../store";
import { avatarBgClass } from "../utils/avatar-color";
import { DefaultModelSelect } from "./DefaultModelSelect";

function avatarInitials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  return t.slice(0, 2);
}

type SkillItem = {
  name: string;
  description: string;
  globally_disabled?: boolean;
};

/** 与设置 → 技能 Tab 一致：绿轨 + 白钮 */
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
      className={`relative h-5 w-9 shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb,16,185,129),0.55)] disabled:opacity-40 ${
        checked ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-surface-hover"
      }`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

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

type Tab = "general" | "tools" | "skills" | "soul";

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
  const [avatarUrlDraft, setAvatarUrlDraft] = useState(avatar?.avatarUrl ?? "");
  const [avatarImageHint, setAvatarImageHint] = useState("");
  const [defaultProvider, setDefaultProvider] = useState(avatar?.defaultProvider ?? "");
  const [defaultModel, setDefaultModel] = useState(avatar?.defaultModel ?? "");

  // Tools
  const [tools, setTools] = useState<ToolItem[]>(DEFAULT_TOOLS);
  const [toolsEnabled, setToolsEnabled] = useState<Record<string, boolean>>({});
  const [loadingTools, setLoadingTools] = useState(false);

  // Per-avatar skills (only `false` entries are persisted to avatar.yaml skills_enabled)
  const [skillsItems, setSkillsItems] = useState<SkillItem[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillsEnabledDraft, setSkillsEnabledDraft] = useState<Record<string, boolean>>({});

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
      setAvatarUrlDraft(avatar.avatarUrl ?? "");
      setAvatarImageHint("");
      setToolsEnabled({ ...(avatar.toolsEnabled ?? {}) });
      setDefaultProvider(avatar.defaultProvider ?? "");
      setDefaultModel(avatar.defaultModel ?? "");
      const raw = avatar.skillsEnabled;
      setSkillsEnabledDraft(
        raw && typeof raw === "object"
          ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v === false))
          : {},
      );
    } else {
      void (async () => {
        const policy = await window.agenticxDesktop.getToolsPolicy();
        setToolsEnabled(policy?.ok ? policy.tools_enabled ?? {} : {});
      })();
      setSkillsEnabledDraft({});
    }
    void loadTools();
    void loadSoul();
  }, [mode, avatar, loadTools, loadSoul]);

  const loadSkillsList = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const r = await window.agenticxDesktop.loadSkills();
      if (r?.ok) {
        const list = (r.items ?? []).filter((s) => !s.globally_disabled);
        setSkillsItems(list.map((s) => ({ name: s.name, description: s.description, globally_disabled: s.globally_disabled })));
      }
    } finally {
      setLoadingSkills(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "avatar" && avatar && tab === "skills") {
      void loadSkillsList();
    }
  }, [mode, avatar, tab, loadSkillsList]);

  const handlePickAvatarImage = useCallback((file: File) => {
    const maxBytes = 1.8 * 1024 * 1024;
    if (!file.type.startsWith("image/")) {
      setAvatarImageHint("请选择图片文件（PNG/JPG/WebP/GIF）。");
      return;
    }
    if (file.size > maxBytes) {
      setAvatarImageHint("图片过大，请选择小于 1.8MB 的文件。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        setAvatarImageHint("读取图片失败，请重试。");
        return;
      }
      setAvatarUrlDraft(result);
      setAvatarImageHint("已选择图片，请点击「保存」写入分身配置。");
    };
    reader.onerror = () => setAvatarImageHint("读取图片失败，请重试。");
    reader.readAsDataURL(file);
  }, []);

  const customizedCount = useMemo(
    () => Object.keys(toolsEnabled).filter((key) => toolsEnabled[key] !== undefined).length,
    [toolsEnabled],
  );

  const toolsModeHint =
    mode === "avatar"
      ? "未设置项继承 Machi 全局策略；如全局未设置，则默认启用。"
      : "Machi 全局策略将作为所有分身默认值；未设置项默认启用。";

  /** 分身「基本信息」Tab：名称 / 角色 / System Prompt + SOUL 一并保存 */
  const handleSaveGeneralAndSoul = async () => {
    if (mode !== "avatar" || !avatar) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await window.agenticxDesktop.updateAvatar({
        id: avatar.id,
        name: name.trim() || avatar.name,
        role: role.trim(),
        system_prompt: systemPrompt.trim(),
        avatar_url: avatarUrlDraft.trim(),
        default_provider: defaultProvider.trim(),
        default_model: defaultModel.trim(),
      });
      if (!res?.ok) {
        setMessage(`保存失败: ${res?.error ?? "未知错误"}`);
        return;
      }
      const soulRes = await window.agenticxDesktop.saveAvatarSoul({
        avatarId: avatar.id,
        content: soulValue,
      });
      if (!soulRes?.ok) {
        setMessage(`基本信息已保存；SOUL 保存失败: ${soulRes?.error ?? "未知错误"}`);
        return;
      }
      setMessage("已保存，下一轮对话生效。");
      setAvatarImageHint("");
      onSaved();
    } catch (err) {
      setMessage(`保存失败: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const skillsCustomizedCount = useMemo(
    () => Object.keys(skillsEnabledDraft).filter((k) => skillsEnabledDraft[k] === false).length,
    [skillsEnabledDraft],
  );

  const handleSaveSkills = async () => {
    if (mode !== "avatar" || !avatar) return;
    setSaving(true);
    setMessage("");
    try {
      const onlyFalse = Object.fromEntries(
        Object.entries(skillsEnabledDraft).filter(([, v]) => v === false),
      );
      const res = await window.agenticxDesktop.updateAvatar({
        id: avatar.id,
        skills_enabled: Object.keys(onlyFalse).length > 0 ? onlyFalse : {},
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

  const handleSaveMetaSoul = async () => {
    if (mode !== "machi") return;
    setSaving(true);
    setMessage("");
    try {
      const res = await window.agenticxDesktop.saveMetaSoul({ content: soulValue });
      setMessage(res?.ok ? "已保存，下一轮 Machi 对话生效。" : `保存失败: ${res?.error ?? "未知错误"}`);
    } catch (err) {
      setMessage(`保存失败: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (mode === "avatar" && tab === "soul") {
      setTab("general");
    }
  }, [mode, tab]);

  const tabs: { id: Tab; label: string }[] =
    mode === "avatar"
      ? [
          { id: "general", label: "基本信息" },
          { id: "tools", label: "工具权限" },
          { id: "skills", label: "技能" },
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
        {/* Header：标题 + 右上角关闭 */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-panel px-3 py-3 sm:px-4">
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-text-strong">{title}</div>
          <button
            type="button"
            aria-label="关闭"
            className="shrink-0 rounded-md p-1.5 text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
          >
            <X className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 gap-1 border-b border-border bg-surface-sidebar px-4 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`mb-1 rounded-[10px] border px-3 py-1.5 text-xs font-medium transition ${
                activeTab === t.id
                  ? "border-transparent bg-btnPrimary text-btnPrimary-text"
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
              <div>
                <div className="text-sm text-text-muted">分身头像</div>
                <div className="mt-2 flex items-center gap-3">
                  {avatarUrlDraft ? (
                    <img
                      src={avatarUrlDraft}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatar ? avatarBgClass(avatar.id) : "bg-surface-hover text-text-primary"}`}
                    >
                      {avatarInitials(name || avatar?.name || "")}
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong">
                      上传图片
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handlePickAvatarImage(file);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
                      disabled={!avatarUrlDraft}
                      onClick={() => {
                        setAvatarUrlDraft("");
                        setAvatarImageHint("已清除预览，请点击「保存」以恢复默认头像。");
                      }}
                    >
                      恢复默认
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-text-subtle">
                  与侧栏、会话列表一致展示；建议小于 1.8MB 的方形图片。保存后写入该分身目录下的 avatar.yaml。
                </p>
                {avatarImageHint ? <p className="mt-1 text-[11px] text-text-subtle">{avatarImageHint}</p> : null}
              </div>
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
              <label className="block text-sm text-text-muted">
                默认模型
                <span className="ml-1 text-xs font-normal text-text-faint">（新建会话或未显式选择模型时使用）</span>
                <DefaultModelSelect
                  provider={defaultProvider}
                  model={defaultModel}
                  onChange={(p, m) => {
                    setDefaultProvider(p);
                    setDefaultModel(m);
                  }}
                />
              </label>
              <div className="border-t border-border pt-4">
                <label className="block text-sm text-text-muted">
                  SOUL
                  <span className="ml-1 text-xs font-normal text-text-faint">（长期风格与策略，支持 Markdown）</span>
                </label>
                {loadingSoul ? (
                  <div className="mt-1 rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                    加载中...
                  </div>
                ) : (
                  <textarea
                    className="mt-1 min-h-[160px] w-full resize-y rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                    value={soulValue}
                    onChange={(e) => setSoulValue(e.target.value)}
                    placeholder="例如：先给结论，再给证据；避免重复确认；把进度和风险讲清楚。"
                  />
                )}
              </div>
              <div className="flex justify-end">
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving || !name.trim()}
                  onClick={() => void handleSaveGeneralAndSoul()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "skills" && mode === "avatar" && (
            <div className="space-y-3">
              <p className="text-xs text-text-faint">
                已在设置 → 技能中全局禁用的条目不会出现在此列表。未列出的技能对该分身默认启用；关闭开关表示该分身不使用此技能。
              </p>
              {loadingSkills ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  加载技能列表中...
                </div>
              ) : skillsItems.length === 0 ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  当前没有可用的技能（或全部被全局禁用）。
                </div>
              ) : (
                <div className="space-y-2">
                  {skillsItems.map((skill) => {
                    const skillOffForAvatar = skillsEnabledDraft[skill.name] === false;
                    return (
                      <div key={skill.name} className="rounded-md border border-border bg-surface-card px-2.5 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm text-text-primary">{skill.name}</div>
                            {skill.description ? (
                              <div className="truncate text-xs text-text-faint">{skill.description}</div>
                            ) : null}
                          </div>
                          <SettingsSwitch
                            checked={!skillOffForAvatar}
                            disabled={saving}
                            aria-label={`${skill.name} 对该分身启用`}
                            onChange={(next) => {
                              setSkillsEnabledDraft((prev) => {
                                const draft = { ...prev };
                                if (!next) draft[skill.name] = false;
                                else delete draft[skill.name];
                                return draft;
                              });
                            }}
                          />
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
                  onClick={() => setSkillsEnabledDraft({})}
                  disabled={skillsCustomizedCount === 0 || saving}
                >
                  <RotateCcw className="h-3 w-3" />
                  重置（全部启用）
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving}
                  onClick={() => void handleSaveSkills()}
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

          {activeTab === "soul" && mode === "machi" && (
            <div className="space-y-3">
              <p className="text-xs text-text-faint">
                支持自由 Markdown 文本。该配置用于塑造 Machi（Meta-Agent）的长期行为风格。
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
                  onClick={() => void handleSaveMetaSoul()}
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
