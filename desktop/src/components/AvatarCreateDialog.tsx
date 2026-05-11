import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AvatarToolPermissionDialog } from "./AvatarToolPermissionDialog";
import { DefaultModelSelect } from "./DefaultModelSelect";

type SkillRow = { name: string; description: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    role: string;
    systemPrompt: string;
    toolsEnabled: Record<string, boolean>;
    skillsEnabled?: Record<string, boolean>;
    defaultProvider?: string;
    defaultModel?: string;
  }) => Promise<void>;
};

type Mode = "manual" | "ai";
export function AvatarCreateDialog({ open, onClose, onCreate }: Props) {
  const [mode, setMode] = useState<Mode>("manual");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState<Record<string, boolean>>({});
  const [skillsSectionOpen, setSkillsSectionOpen] = useState(false);
  const [skillsItems, setSkillsItems] = useState<SkillRow[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  /** Per-skill `false` = disabled for this avatar (aligned with avatar.yaml skills_enabled). */
  const [skillsEnabledDraft, setSkillsEnabledDraft] = useState<Record<string, boolean>>({});
  const [defaultProvider, setDefaultProvider] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const customizedCount = Object.keys(toolsEnabled).filter((key) => toolsEnabled[key] !== undefined).length;
  const skillsCustomizedCount = Object.keys(skillsEnabledDraft).filter((k) => skillsEnabledDraft[k] === false).length;

  useEffect(() => {
    if (!open || mode !== "manual" || !skillsSectionOpen) return;
    let cancelled = false;
    (async () => {
      setLoadingSkills(true);
      try {
        const r = await window.agenticxDesktop.loadSkills();
        if (!cancelled && r.ok) {
          const list = (r.items ?? []).filter((s) => !s.globally_disabled);
          setSkillsItems(list.map((s) => ({ name: s.name, description: s.description })));
        }
      } finally {
        if (!cancelled) setLoadingSkills(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, skillsSectionOpen]);

  if (!open) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const skillsOnlyFalse = Object.fromEntries(
        Object.entries(skillsEnabledDraft).filter(([, v]) => v === false),
      );
      await onCreate({
        name: name.trim(),
        role: role.trim(),
        systemPrompt: systemPrompt.trim(),
        toolsEnabled: { ...toolsEnabled },
        ...(Object.keys(skillsOnlyFalse).length > 0 ? { skillsEnabled: skillsOnlyFalse } : {}),
        defaultProvider: defaultProvider.trim(),
        defaultModel: defaultModel.trim(),
      });
      setName("");
      setRole("");
      setSystemPrompt("");
      setToolsEnabled({});
      setSkillsEnabledDraft({});
      setDefaultProvider("");
      setDefaultModel("");
      setSkillsSectionOpen(false);
      setToolsDialogOpen(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!description.trim()) return;
    setBusy(true);
    setAiError("");
    try {
      const result = await window.agenticxDesktop.generateAvatar({ description: description.trim() });
      if (result.ok) {
        setDescription("");
        onClose();
      } else {
        setAiError(result.error || "AI 生成失败");
      }
    } catch (err) {
      setAiError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const resetAndClose = () => {
    setName("");
    setRole("");
    setSystemPrompt("");
    setDescription("");
    setAiError("");
    setToolsEnabled({});
    setSkillsEnabledDraft({});
    setSkillsSectionOpen(false);
    setToolsDialogOpen(false);
    setDefaultProvider("");
    setDefaultModel("");
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-[440px] max-w-[95vw] rounded-xl border border-border bg-surface-panel p-5">
        <h3 className="mb-4 text-[16px] font-semibold text-text-primary">创建数字分身</h3>

        <div className="mb-4 flex gap-1 rounded-lg bg-surface-card p-0.5">
          {([["manual", "手动创建"], ["ai", "AI 生成"]] as const).map(([key, label]) => (
            <button
              key={key}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                mode === key
                  ? "bg-cyan-500/20 text-cyan-400"
                  : "text-text-subtle hover:text-text-primary"
              }`}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "manual" ? (
          <>
            <div className="space-y-3">
              <label className="block text-sm text-text-muted">
                名称 <span className="text-rose-400">*</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例：Coder、Researcher、Writer"
                  autoFocus
                />
              </label>
              <label className="block text-sm text-text-muted">
                角色
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="例：全栈开发工程师、数据分析师"
                />
              </label>
              <label className="block text-sm text-text-muted">
                System Prompt
                <span className="ml-1 text-xs text-text-faint">(可选)</span>
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  rows={3}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="自定义角色行为指令..."
                />
              </label>
              <label className="block text-sm text-text-muted">
                默认模型
                <span className="ml-1 text-xs text-text-faint">(新建会话时使用)</span>
                <DefaultModelSelect
                  provider={defaultProvider}
                  model={defaultModel}
                  onChange={(p, m) => {
                    setDefaultProvider(p);
                    setDefaultModel(m);
                  }}
                />
              </label>

              <button
                type="button"
                className="w-full rounded-md border border-border bg-surface-card px-3 py-2 text-left text-sm text-text-muted transition hover:bg-surface-hover"
                onClick={() => setToolsDialogOpen(true)}
              >
                工具权限（{customizedCount > 0 ? `已自定义 ${customizedCount} 项` : "继承全局默认"}）
              </button>

              <div className="rounded-md border border-border bg-surface-card">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-text-muted transition hover:bg-surface-hover"
                  onClick={() => setSkillsSectionOpen((v) => !v)}
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${skillsSectionOpen ? "rotate-90" : ""}`}
                  />
                  <span>
                    技能（{skillsCustomizedCount > 0 ? `已禁用 ${skillsCustomizedCount} 项` : "默认全部启用"}）
                  </span>
                </button>
                {skillsSectionOpen && (
                  <div className="space-y-2 border-t border-border px-3 py-2">
                    <p className="text-[11px] text-text-faint">
                      全局已在设置中禁用的技能不会列出。关闭表示该分身不使用对应技能。
                    </p>
                    {loadingSkills ? (
                      <div className="py-2 text-xs text-text-faint">加载中...</div>
                    ) : skillsItems.length === 0 ? (
                      <div className="py-2 text-xs text-text-faint">暂无可配置技能。</div>
                    ) : (
                      <div className="max-h-[200px] space-y-1.5 overflow-y-auto">
                        {skillsItems.map((skill) => {
                          const disabled = skillsEnabledDraft[skill.name] === false;
                          return (
                            <div
                              key={skill.name}
                              className="flex items-center justify-between gap-2 rounded border border-border/60 bg-surface-panel/50 px-2 py-1.5"
                            >
                              <span className="min-w-0 truncate text-xs text-text-primary">{skill.name}</span>
                              <button
                                type="button"
                                className={`shrink-0 rounded border px-2 py-0.5 text-[11px] transition ${
                                  disabled
                                    ? "border-border-strong text-text-muted"
                                    : "border-cyan-500/40 bg-cyan-500/10 text-cyan-400"
                                }`}
                                onClick={() => {
                                  setSkillsEnabledDraft((prev) => {
                                    const next = { ...prev };
                                    if (disabled) delete next[skill.name];
                                    else next[skill.name] = false;
                                    return next;
                                  });
                                }}
                              >
                                {disabled ? "已禁用" : "启用"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-1.5 text-sm text-text-subtle transition hover:bg-surface-hover"
                onClick={resetAndClose}
              >
                取消
              </button>
              <button
                className="rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                disabled={busy || !name.trim()}
                onClick={handleCreate}
              >
                {busy ? "创建中..." : "创建"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <label className="block text-sm text-text-muted">
                描述你想要的分身
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="描述分身的能力、性格和专长，AI 将自动生成名称、角色和 System Prompt..."
                  autoFocus
                />
              </label>
              {aiError && (
                <div className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                  {aiError}
                </div>
              )}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                className="rounded-md border border-border px-4 py-1.5 text-sm text-text-subtle transition hover:bg-surface-hover"
                onClick={resetAndClose}
              >
                取消
              </button>
              <button
                className="rounded-md bg-violet-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-violet-400 disabled:opacity-40"
                disabled={busy || !description.trim()}
                onClick={handleAiGenerate}
              >
                {busy ? "生成中..." : "AI 生成"}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
      <AvatarToolPermissionDialog
        open={toolsDialogOpen}
        mode="avatar"
        title="新分身 · 工具权限"
        initialToolsEnabled={toolsEnabled}
        onClose={() => setToolsDialogOpen(false)}
        onSave={async (next) => {
          setToolsEnabled(next);
        }}
      />
    </>
  );
}
