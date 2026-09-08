import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, RotateCcw, X } from "lucide-react";
import type { Avatar } from "../store";
import { avatarBgClass, avatarFgClass, AVATAR_PALETTE, AVATAR_COLOR_SWATCH, normalizeAvatarColor } from "../utils/avatar-color";
import type { AvatarPaletteKey } from "../utils/avatar-color";
import { DefaultModelSelect } from "./DefaultModelSelect";
import { i18n } from "../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


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
        className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow-sm transition-transform ${
          checked ? "bg-[var(--theme-color-text)]" : "bg-white"
        } ${checked ? "translate-x-4" : "translate-x-0"}`}
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
  { id: "liteparse", name: "LiteParse", description: st("avatar.toolLiteparse") },
  { id: "mineru", name: "MinerU", description: st("avatar.toolMineru") },
  { id: "libreoffice", name: "LibreOffice", description: st("avatar.toolLibreoffice") },
  { id: "imagemagick", name: "ImageMagick", description: st("avatar.toolImagemagick") },
];

type Tab = "general" | "tools" | "skills" | "soul";

type Props =
  | { mode: "avatar"; avatar: Avatar; onClose: () => void; onSaved: () => void }
  | { mode: "machi"; onClose: () => void; onSaved: () => void };

export function AvatarSettingsPanel(props: Props) {
  const { t } = useTranslation("settings");
  const { mode, onClose, onSaved } = props;
  const avatar = mode === "avatar" ? (props as { avatar: Avatar }).avatar : null;

  const [tab, setTab] = useState<Tab>("general");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  // General fields (avatar only)
  const [name, setName] = useState(avatar?.name ?? "");
  const [role, setRole] = useState(avatar?.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(avatar?.systemPrompt ?? "");
  const [blurb, setBlurb] = useState(avatar?.description ?? "");
  const [tagsInput, setTagsInput] = useState((avatar?.tags ?? []).join(", "));
  const [avatarUrlDraft, setAvatarUrlDraft] = useState(avatar?.avatarUrl ?? "");
  const [avatarImageHint, setAvatarImageHint] = useState("");
  const [defaultProvider, setDefaultProvider] = useState(avatar?.defaultProvider ?? "");
  const [defaultModel, setDefaultModel] = useState(avatar?.defaultModel ?? "");
  const [colorDraft, setColorDraft] = useState(() => normalizeAvatarColor(avatar?.color));

  // Tools
  const [tools, setTools] = useState<ToolItem[]>(DEFAULT_TOOLS);
  const [toolsEnabled, setToolsEnabled] = useState<Record<string, boolean>>({});
  const [loadingTools, setLoadingTools] = useState(false);

  // Per-avatar skills (only `false` entries are persisted to avatar.yaml skills_enabled)
  const [skillsItems, setSkillsItems] = useState<SkillItem[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillsEnabledDraft, setSkillsEnabledDraft] = useState<Record<string, boolean>>({});

  const [brainsMountMode, setBrainsMountMode] = useState<"default" | "all" | "custom">("default");
  const [brainsCustomIds, setBrainsCustomIds] = useState<string[]>([]);
  const [brainsCatalog, setBrainsCatalog] = useState<{ id: string; name: string; type: string }[]>([]);

  // SOUL
  const [soulValue, setSoulValue] = useState("");
  const [loadingSoul, setLoadingSoul] = useState(false);

  const title = mode === "avatar" ? st("avatar.titleNamed", { name: avatar?.name ?? st("avatar.fallbackName") }) : st("avatar.titleNear");

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
      setColorDraft(normalizeAvatarColor(avatar.color));
      const raw = avatar.skillsEnabled;
      setSkillsEnabledDraft(
        raw && typeof raw === "object"
          ? Object.fromEntries(Object.entries(raw).filter(([, v]) => v === false))
          : {},
      );
      const be = avatar.brainsEnabled;
      if (be === "*") {
        setBrainsMountMode("all");
        setBrainsCustomIds([]);
      } else if (Array.isArray(be) && be.length > 0) {
        setBrainsMountMode("custom");
        setBrainsCustomIds([...be]);
      } else {
        setBrainsMountMode("default");
        setBrainsCustomIds([]);
      }
    } else {
      void (async () => {
        const policy = await window.agenticxDesktop.getToolsPolicy();
        setToolsEnabled(policy?.ok ? policy.tools_enabled ?? {} : {});
      })();
      setSkillsEnabledDraft({});
    }
    void loadTools();
    void loadSoul();
    if (mode === "avatar") {
      void (async () => {
        try {
          const base = String((await window.agenticxDesktop.getApiBase()) || "").replace(/\/+$/, "");
          const res = await fetch(`${base}/api/brains`);
          const body = (await res.json()) as {
            brains?: { id: string; name: string; type: string; scope: string; owner_avatar_id?: string }[];
          };
          const list = (body.brains ?? []).filter(
            (b) => b.scope === "global" || b.owner_avatar_id === avatar?.id,
          );
          setBrainsCatalog(list.map((b) => ({ id: b.id, name: b.name, type: b.type })));
        } catch {
          setBrainsCatalog([]);
        }
      })();
    }
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
      setAvatarImageHint(st("avatar.pickImage"));
      return;
    }
    if (file.size > maxBytes) {
      setAvatarImageHint(st("avatar.imageTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        setAvatarImageHint(st("avatar.readImageFailed"));
        return;
      }
      setAvatarUrlDraft(result);
      setAvatarImageHint(st("avatar.imagePicked"));
    };
    reader.onerror = () => setAvatarImageHint(st("avatar.readImageFailed"));
    reader.readAsDataURL(file);
  }, []);

  const customizedCount = useMemo(
    () => Object.keys(toolsEnabled).filter((key) => toolsEnabled[key] !== undefined).length,
    [toolsEnabled],
  );

  const toolsModeHint =
    mode === "avatar"
      ? st("avatar.inheritHintAvatar")
      : st("avatar.inheritHintNear");

  /** 分身「基本信息」Tab：名称 / 角色 / System Prompt + SOUL 一并保存 */
  const handleSaveGeneralAndSoul = async () => {
    if (mode !== "avatar" || !avatar) return;
    setSaving(true);
    setMessage("");
    try {
      const brainsPayload =
        brainsMountMode === "all"
          ? "*"
          : brainsMountMode === "custom"
            ? brainsCustomIds
            : null;
      const tags = tagsInput
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await window.agenticxDesktop.updateAvatar({
        id: avatar.id,
        name: name.trim() || avatar.name,
        role: role.trim(),
        system_prompt: systemPrompt.trim(),
        description: blurb.trim(),
        tags,
        avatar_url: avatarUrlDraft.trim(),
        default_provider: defaultProvider.trim(),
        default_model: defaultModel.trim(),
        color: colorDraft,
        brains_enabled: brainsPayload,
      });
      if (!res?.ok) {
        setMessage(st("avatar.saveFailed", { reason: res?.error ?? st("avatar.unknownError") }));
        return;
      }
      const soulRes = await window.agenticxDesktop.saveAvatarSoul({
        avatarId: avatar.id,
        content: soulValue,
      });
      if (!soulRes?.ok) {
        setMessage(st("avatar.generalSavedSoulFailed", { reason: soulRes?.error ?? st("avatar.unknownError") }));
        return;
      }
      setMessage(st("avatar.savedNextTurn"));
      setAvatarImageHint("");
      onSaved();
    } catch (err) {
      setMessage(st("avatar.saveFailed", { reason: String(err) }));
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
      setMessage(res?.ok ? st("avatar.saved") : st("avatar.saveFailed", { reason: res?.error ?? st("avatar.unknownError") }));
      if (res?.ok) onSaved();
    } catch (err) {
      setMessage(st("avatar.saveFailed", { reason: String(err) }));
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
        setMessage(res?.ok ? st("avatar.saved") : st("avatar.saveFailed", { reason: res?.error ?? st("avatar.unknownError") }));
        if (res?.ok) onSaved();
      } else {
        const res = await window.agenticxDesktop.saveToolsPolicy({ tools_enabled: { ...toolsEnabled } });
        setMessage(res?.ok ? st("avatar.saved") : st("avatar.saveFailed", { reason: res?.error ?? st("avatar.unknownError") }));
      }
    } catch (err) {
      setMessage(st("avatar.saveFailed", { reason: String(err) }));
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
      setMessage(res?.ok ? st("avatar.savedNearNext") : st("avatar.saveFailed", { reason: res?.error ?? st("avatar.unknownError") }));
    } catch (err) {
      setMessage(st("avatar.saveFailed", { reason: String(err) }));
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
          { id: "general", label: st("avatar.tabGeneral") },
          { id: "tools", label: st("avatar.tabTools") },
          { id: "skills", label: st("avatar.tabSkills") },
        ]
      : [
          { id: "tools", label: st("avatar.tabToolsGlobal") },
          { id: "soul", label: st("avatar.tabSoul") },
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
            aria-label={st("avatar.closeAria")}
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
                {st("avatar.promptSoulHint")}
              </p>
              <div>
                <div className="text-sm text-text-muted">{st("avatar.avatarImage")}</div>
                <div className="mt-2 flex items-center gap-3">
                  {avatarUrlDraft ? (
                    <img
                      src={avatarUrlDraft}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-full border border-border object-cover"
                    />
                  ) : (
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatar ? `${avatarBgClass(colorDraft)} ${avatarFgClass(colorDraft)}` : "bg-surface-hover text-text-primary"}`}
                    >
                      {avatarInitials(name || avatar?.name || "")}
                    </div>
                  )}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong">
                      {st("avatar.uploadImage")}
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
                        setAvatarImageHint(st("avatar.imageCleared"));
                      }}
                    >
                      {st("avatar.resetDefault")}
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-text-subtle">
                  {st("avatar.avatarImageHint")}
                </p>
                {avatarImageHint ? <p className="mt-1 text-[11px] text-text-subtle">{avatarImageHint}</p> : null}
              </div>
              <div>
                <div className="text-sm text-text-muted">{st("avatar.bgColor")}</div>
                <p className="mt-1 text-[11px] text-text-subtle">
                  {st("avatar.bgColorHint")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-label={st("avatar.defaultWithMetaAria")}
                    aria-pressed={colorDraft === ""}
                    title={st("avatar.defaultTitle")}
                    className={`h-7 w-7 rounded-full border-2 transition ${
                      colorDraft === ""
                        ? "border-text-strong ring-2 ring-[rgba(var(--theme-color-rgb,59,130,246),0.35)]"
                        : "border-border hover:border-text-faint"
                    }`}
                    style={{ background: "rgb(var(--theme-color-rgb, 59, 130, 246))" }}
                    onClick={() => setColorDraft("")}
                  />
                  {AVATAR_PALETTE.map((key: AvatarPaletteKey) => (
                    <button
                      key={key}
                      type="button"
                      aria-label={key}
                      aria-pressed={colorDraft === key}
                      title={key}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        colorDraft === key
                          ? "border-text-strong ring-2 ring-white/20"
                          : "border-transparent hover:scale-105"
                      }`}
                      style={{ background: AVATAR_COLOR_SWATCH[key] }}
                      onClick={() => setColorDraft(key)}
                    />
                  ))}
                </div>
              </div>
              <label className="block text-sm text-text-muted">
                {st("avatar.name")}
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={st("avatar.namePh")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {st("avatar.role")}
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={st("avatar.rolePh")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {st("avatar.systemPrompt")}
                <textarea
                  className="mt-1 min-h-[120px] w-full resize-y rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={st("avatar.systemPromptPh")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {st("avatar.blurb")}
                <span className="ml-1 text-xs font-normal text-text-faint">{st("avatar.blurbOptional")}</span>
                <textarea
                  className="mt-1 min-h-[64px] w-full resize-y rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={blurb}
                  onChange={(e) => setBlurb(e.target.value)}
                  placeholder={st("avatar.blurbPh")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {st("avatar.tags")}
                <span className="ml-1 text-xs font-normal text-text-faint">{st("avatar.tagsOptional")}</span>
                <input
                  className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder={st("avatar.tagsPh")}
                />
              </label>
              <label className="block text-sm text-text-muted">
                {st("avatar.defaultModel")}
                <span className="ml-1 text-xs font-normal text-text-faint">{st("avatar.defaultModelHint")}</span>
                <DefaultModelSelect
                  provider={defaultProvider}
                  model={defaultModel}
                  onChange={(p, m) => {
                    setDefaultProvider(p);
                    setDefaultModel(m);
                  }}
                />
              </label>
              <div className="rounded-md border border-border bg-surface-card p-3">
                <div className="text-sm font-medium text-text-primary">{st("avatar.mountBrains")}</div>
                <p className="mt-1 text-xs text-text-faint">
                  {st("avatar.mountBrainsHint")}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={brainsMountMode === "default"}
                      onChange={() => setBrainsMountMode("default")}
                    />
                    {st("avatar.brainsDefault")}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={brainsMountMode === "all"}
                      onChange={() => setBrainsMountMode("all")}
                    />
                    {st("avatar.brainsAll")}
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={brainsMountMode === "custom"}
                      onChange={() => setBrainsMountMode("custom")}
                    />
                    {st("avatar.brainsCustom")}
                  </label>
                </div>
                {brainsMountMode === "custom" ? (
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {brainsCatalog.map((b) => (
                      <label key={b.id} className="flex items-center gap-2 text-xs text-text-subtle">
                        <input
                          type="checkbox"
                          checked={brainsCustomIds.includes(b.id)}
                          onChange={(e) => {
                            setBrainsCustomIds((prev) =>
                              e.target.checked ? [...prev, b.id] : prev.filter((x) => x !== b.id),
                            );
                          }}
                        />
                        <span>
                          {b.name} <span className="text-text-faint">({b.type})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="border-t border-border pt-4">
                <label className="block text-sm text-text-muted">
                  {st("avatar.soul")}
                  <span className="ml-1 text-xs font-normal text-text-faint">{st("avatar.soulHint")}</span>
                </label>
                {loadingSoul ? (
                  <div className="mt-1 rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                    {st("avatar.loading")}
                  </div>
                ) : (
                  <textarea
                    className="mt-1 min-h-[160px] w-full resize-y rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                    value={soulValue}
                    onChange={(e) => setSoulValue(e.target.value)}
                    placeholder={st("avatar.soulPh")}
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
                  {saving ? st("avatar.saving") : st("avatar.save")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "skills" && mode === "avatar" && (
            <div className="space-y-3">
              <p className="text-xs text-text-faint">
                {st("avatar.skillsHint")}
              </p>
              {loadingSkills ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  {st("avatar.loadingSkills")}
                </div>
              ) : skillsItems.length === 0 ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  {st("avatar.noSkills")}
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
                            aria-label={st("avatar.enableSkillAria", { name: skill.name })}
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
                  {st("avatar.resetAllEnabled")}
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving}
                  onClick={() => void handleSaveSkills()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? st("avatar.saving") : st("avatar.save")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "tools" && (
            <div className="space-y-3">
              <p className="text-xs text-text-faint">
                {customizedCount > 0 ? st("avatar.customizedCount", { count: customizedCount }) : st("avatar.notCustomized")} · {toolsModeHint}
              </p>
              {loadingTools ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  {st("avatar.loadingTools")}
                </div>
              ) : (
                <div className="space-y-2">
                  {tools.map((tool) => {
                    const inherited = !(tool.id in toolsEnabled);
                    const enabled = inherited ? true : Boolean(toolsEnabled[tool.id]);
                    const stateLabel = inherited
                      ? st("avatar.stateDefault")
                      : enabled
                        ? st("avatar.stateOn")
                        : st("avatar.stateOff");
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
                  {st("avatar.resetDefaults")}
                </button>
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving}
                  onClick={() => void handleSaveTools()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? st("avatar.saving") : st("avatar.save")}
                </button>
              </div>
            </div>
          )}

          {activeTab === "soul" && mode === "machi" && (
            <div className="space-y-3">
              <p className="text-xs text-text-faint">
                {st("avatar.nearSoulHint")}
              </p>
              {loadingSoul ? (
                <div className="rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-faint">
                  {st("avatar.loading")}
                </div>
              ) : (
                <textarea
                  className="min-h-[220px] w-full resize-y rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
                  value={soulValue}
                  onChange={(e) => setSoulValue(e.target.value)}
                  placeholder={st("avatar.soulPh")}
                />
              )}
              <div className="flex justify-end">
                <button
                  className="flex items-center gap-1.5 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                  disabled={saving}
                  onClick={() => void handleSaveMetaSoul()}
                >
                  <Save className="h-3.5 w-3.5" />
                  {saving ? st("avatar.saving") : st("avatar.save")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer message */}
        {message && (
          <div className="shrink-0 border-t border-border bg-surface-panel px-4 py-2">
            <div
              className={`text-xs ${message.startsWith(st("avatar.saved")) ? "text-emerald-400" : "text-rose-400"}`}
            >
              {message}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
