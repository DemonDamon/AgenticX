import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
    blurb?: string;
    tags?: string[];
    toolsEnabled: Record<string, boolean>;
    skillsEnabled?: Record<string, boolean>;
    defaultProvider?: string;
    defaultModel?: string;
    workspaceDir?: string;
  }) => Promise<void>;
  /** "AI 创建" tab: hand the description off to a new Meta chat draft instead of a one-shot API call. */
  onCreateViaChat: (description: string) => void;
};

type Mode = "manual" | "ai";
export function AvatarCreateDialog({ open, onClose, onCreate, onCreateViaChat }: Props) {
  const { t } = useTranslation("sidebar");
  const { t: tCommon } = useTranslation("common");
  const [mode, setMode] = useState<Mode>("ai");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [blurb, setBlurb] = useState("");
  const [tagsInput, setTagsInput] = useState("");
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
  const [workspaceDir, setWorkspaceDir] = useState("");
  const customizedCount = Object.keys(toolsEnabled).filter((key) => toolsEnabled[key] !== undefined).length;
  const skillsCustomizedCount = Object.keys(skillsEnabledDraft).filter((k) => skillsEnabledDraft[k] === false).length;

  useEffect(() => {
    if (!open) return;
    setMode("ai");
    setAiError("");
  }, [open]);

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
      const tags = tagsInput
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await onCreate({
        name: name.trim(),
        role: role.trim(),
        systemPrompt: systemPrompt.trim(),
        blurb: blurb.trim(),
        tags,
        toolsEnabled: { ...toolsEnabled },
        ...(Object.keys(skillsOnlyFalse).length > 0 ? { skillsEnabled: skillsOnlyFalse } : {}),
        defaultProvider: defaultProvider.trim(),
        defaultModel: defaultModel.trim(),
        workspaceDir: workspaceDir.trim(),
      });
      setName("");
      setRole("");
      setSystemPrompt("");
      setBlurb("");
      setTagsInput("");
      setToolsEnabled({});
      setSkillsEnabledDraft({});
      setDefaultProvider("");
      setDefaultModel("");
      setWorkspaceDir("");
      setSkillsSectionOpen(false);
      setToolsDialogOpen(false);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateViaChat = () => {
    const desc = description.trim();
    if (!desc) return;
    onCreateViaChat(desc);
    setDescription("");
    setAiError("");
    resetAndClose();
  };

  const resetAndClose = () => {
    setName("");
    setRole("");
    setSystemPrompt("");
    setBlurb("");
    setTagsInput("");
    setDescription("");
    setAiError("");
    setToolsEnabled({});
    setSkillsEnabledDraft({});
    setSkillsSectionOpen(false);
    setToolsDialogOpen(false);
    setDefaultProvider("");
    setDefaultModel("");
    setWorkspaceDir("");
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-none">
        <div
          className="agx-avatar-create-dialog w-[440px] max-w-[95vw] rounded-xl border border-border p-5 shadow-2xl"
          style={{ backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
        >
        <h3 className="mb-4 text-[16px] font-semibold text-text-primary">{t("avatarCreate.title")}</h3>

        <div className="mb-4 flex gap-1 rounded-lg bg-surface-card p-0.5">
          {([["manual", t("avatarCreate.manual")], ["ai", t("avatarCreate.ai")]] as const).map(([key, label]) => (
            <button
              key={key}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition ${
                mode === key
                  ? "border-transparent bg-btnPrimary text-btnPrimary-text"
                  : "border-transparent text-text-subtle hover:border-border-strong hover:bg-surface-card hover:text-text-strong"
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
                {t("avatarCreate.name")} <span className="text-rose-400">*</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("avatarCreate.namePlaceholder")}
                  autoFocus
                />
              </label>
              <label className="block text-sm text-text-muted">
                {t("avatarCreate.role")}
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={t("avatarCreate.rolePlaceholder")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {t("avatarCreate.systemPrompt")}
                <span className="ml-1 text-xs text-text-faint">{t("avatarCreate.optional")}</span>
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  rows={3}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={t("avatarCreate.systemPromptPlaceholder")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {t("avatarCreate.blurb")}
                <span className="ml-1 text-xs text-text-faint">{t("avatarCreate.blurbHint")}</span>
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  rows={2}
                  value={blurb}
                  onChange={(e) => setBlurb(e.target.value)}
                  placeholder={t("avatarCreate.blurbPlaceholder")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {t("avatarCreate.tags")}
                <span className="ml-1 text-xs text-text-faint">{t("avatarCreate.tagsHint")}</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder={t("avatarCreate.tagsPlaceholder")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {t("avatarCreate.defaultModel")}
                <span className="ml-1 text-xs text-text-faint">{t("avatarCreate.defaultModelHint")}</span>
                <DefaultModelSelect
                  provider={defaultProvider}
                  model={defaultModel}
                  onChange={(p, m) => {
                    setDefaultProvider(p);
                    setDefaultModel(m);
                  }}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {t("avatarCreate.workspace")}
                <span className="ml-1 text-xs text-text-faint">{t("avatarCreate.optional")}</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  value={workspaceDir}
                  onChange={(e) => setWorkspaceDir(e.target.value)}
                  placeholder={t("avatarCreate.workspacePlaceholder")}
                />
              </label>

              <button
                type="button"
                className="w-full rounded-md border border-border bg-surface-card px-3 py-2 text-left text-sm text-text-muted transition hover:bg-surface-hover"
                onClick={() => setToolsDialogOpen(true)}
              >
                {customizedCount > 0
                  ? t("avatarCreate.toolsCustomized", { count: customizedCount })
                  : t("avatarCreate.toolsInherit")}
              </button>

              <div className="rounded-md border border-border bg-surface-card">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-text-muted transition hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb),0.35)]"
                  onClick={() => setSkillsSectionOpen((v) => !v)}
                >
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${skillsSectionOpen ? "rotate-90" : ""}`}
                  />
                  <span>
                    {skillsCustomizedCount > 0
                      ? t("avatarCreate.skillsDisabled", { count: skillsCustomizedCount })
                      : t("avatarCreate.skillsAllEnabled")}
                  </span>
                </button>
                {skillsSectionOpen && (
                  <div className="space-y-2 border-t border-[var(--border-muted)] px-3 py-2">
                    <p className="text-[11px] text-text-faint">
                      {t("avatarCreate.skillsHint")}
                    </p>
                    {loadingSkills ? (
                      <div className="py-2 text-xs text-text-faint">{t("avatarCreate.loading")}</div>
                    ) : skillsItems.length === 0 ? (
                      <div className="py-2 text-xs text-text-faint">{t("avatarCreate.noSkills")}</div>
                    ) : (
                      <div className="max-h-[200px] divide-y divide-[var(--border-muted)] overflow-y-auto rounded-md border border-border bg-surface-card">
                        {skillsItems.map((skill) => {
                          const disabled = skillsEnabledDraft[skill.name] === false;
                          return (
                            <div
                              key={skill.name}
                              className="flex items-center justify-between gap-2 px-2.5 py-2"
                            >
                              <span className="min-w-0 truncate text-xs text-text-primary">{skill.name}</span>
                              <button
                                type="button"
                                className={`shrink-0 rounded border px-2 py-0.5 text-[11px] transition focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb),0.35)] ${
                                  disabled
                                    ? "border-[var(--border-muted)] text-text-muted hover:bg-surface-hover"
                                    : "border-[var(--ui-btn-primary-border)] bg-[rgba(var(--theme-color-rgb),0.1)] text-[var(--kb-citation-fg)] hover:bg-[rgba(var(--theme-color-rgb),0.16)]"
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
                                {disabled ? t("avatarCreate.skillOff") : t("avatarCreate.skillOn")}
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
                {tCommon("cancel")}
              </button>
              <button
                className="rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                disabled={busy || !name.trim()}
                onClick={handleCreate}
              >
                {busy ? t("avatarCreate.creating") : tCommon("create")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <label className="block text-sm text-text-muted">
                {t("avatarCreate.describeAvatar")}
                <textarea
                  className="mt-1 w-full resize-none rounded-md border border-border bg-surface-panel px-3 py-2 text-sm"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("avatarCreate.describePlaceholder")}
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
                {tCommon("cancel")}
              </button>
              <button
                className="rounded-md bg-btnPrimary px-4 py-1.5 text-sm font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                disabled={!description.trim()}
                onClick={handleCreateViaChat}
              >
                {t("avatarCreate.startCreate")}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
      <AvatarToolPermissionDialog
        open={toolsDialogOpen}
        mode="avatar"
        title={t("avatarCreate.toolsTitle")}
        initialToolsEnabled={toolsEnabled}
        onClose={() => setToolsDialogOpen(false)}
        onSave={async (next) => {
          setToolsEnabled(next);
        }}
      />
    </>
  );
}
