import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { GROUP_TEMPLATES, groupTemplateI18nKey } from "../groups/group-templates";
import { useAppStore } from "../../store";

type PickItem = { id: string; label: string };
type PickerKind = "connectors" | "experts" | "skills";

type Props = {
  open: boolean;
  initialInstructions?: string;
  initialTemplateId?: string;
  onClose: () => void;
  onCreated: (projectId: string) => void;
};

function clampProjectName(value: string): string {
  return value.slice(0, 15);
}

export function NewProjectDialog({
  open,
  initialInstructions = "",
  initialTemplateId = "",
  onClose,
  onCreated,
}: Props) {
  const { t } = useTranslation("projects");
  const { t: tSidebar } = useTranslation("sidebar");
  const avatars = useAppStore((s) => s.avatars);
  const mcpServers = useAppStore((s) => s.mcpServers);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState(initialInstructions);
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [experts, setExperts] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillItems, setSkillItems] = useState<PickItem[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!open) return;
    setName("");
    setInstructions(initialInstructions);
    setTemplateId(initialTemplateId);
    setConnectors([]);
    setExperts([]);
    setSkills([]);
    setError("");
    setSubmitting(false);
    setPicker(null);
  }, [initialInstructions, initialTemplateId, open]);

  useEffect(() => {
    if (!open) return;
    if (typeof window.agenticxDesktop?.loadSkills !== "function") return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.agenticxDesktop.loadSkills();
        if (cancelled || !result.ok) return;
        setSkillItems(
          (result.items ?? [])
            .map((item) => ({ id: item.name, label: item.name }))
            .filter((item) => item.id.trim().length > 0),
        );
      } catch (err) {
        console.warn("[NewProjectDialog] loadSkills failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!picker) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-project-picker]")) return;
      setPicker(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [picker]);

  if (!open) return null;

  const connectorItems: PickItem[] = mcpServers
    .filter((server) => server.connected)
    .map((server) => ({ id: server.name, label: server.name }));
  const expertItems: PickItem[] = avatars.map((avatar) => ({ id: avatar.id, label: avatar.name }));

  const pickerItems = (kind: PickerKind): PickItem[] => {
    switch (kind) {
      case "connectors":
        return connectorItems;
      case "experts":
        return expertItems;
      case "skills":
        return skillItems;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  };

  const pickerSelected = (kind: PickerKind): string[] => {
    switch (kind) {
      case "connectors":
        return connectors;
      case "experts":
        return experts;
      case "skills":
        return skills;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  };

  const setPickerSelected = (kind: PickerKind, next: string[]) => {
    switch (kind) {
      case "connectors":
        setConnectors(next);
        return;
      case "experts":
        setExperts(next);
        return;
      case "skills":
        setSkills(next);
        return;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  };

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = GROUP_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    setInstructions(tSidebar(groupTemplateI18nKey(template.id, "description")));
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await window.agenticxDesktop.collabProjectCreate({
        name: trimmed,
        ...(instructions.trim() ? { instructions } : {}),
        settings: { connectors, experts, skills },
      });
      if (!openRef.current) return;
      if (!result.ok || !result.data?.project?.id) {
        setError(result.error || t("createFailed"));
        setSubmitting(false);
        return;
      }
      window.dispatchEvent(new CustomEvent("agenticx:spaces:changed"));
      onCreated(result.data.project.id);
    } catch (err) {
      if (!openRef.current) return;
      setError(err instanceof Error ? err.message : t("createFailed"));
      setSubmitting(false);
    }
  };

  const openPicker = (kind: PickerKind, anchor: HTMLButtonElement) => {
    const rect = anchor.getBoundingClientRect();
    setPickerPos({ left: rect.left, top: rect.bottom + 4 });
    setPicker((current) => (current === kind ? null : kind));
  };

  const renderPickerField = (kind: PickerKind, label: string) => {
    const items = pickerItems(kind);
    const selected = pickerSelected(kind);
    const selectedItems = items.filter((item) => selected.includes(item.id));
    return (
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[13px] text-text-strong">
            {label}
            <span className="ml-1 text-text-faint">{t("dialog.optional")}</span>
          </span>
          <button
            type="button"
            data-project-picker
            className="text-[12px] text-text-muted hover:text-text-strong"
            onClick={(event) => openPicker(kind, event.currentTarget)}
          >
            + {t("dialog.add")}
          </button>
        </div>
        {selectedItems.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="rounded-md bg-surface-card px-2 py-0.5 text-[12px] text-text-primary"
                onClick={() => setPickerSelected(kind, selected.filter((id) => id !== item.id))}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const activeItems = picker ? pickerItems(picker) : [];
  const activeSelected = picker ? pickerSelected(picker) : [];

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="agx-new-project-title"
        className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border bg-surface-base shadow-2xl"
      >
        <div className="border-b border-border px-4 py-3">
          <h3 id="agx-new-project-title" className="text-sm font-semibold text-text-strong">
            {t("new")}
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <label className="block text-[13px] text-text-strong" htmlFor="agx-project-name">
            {t("dialog.name")}
          </label>
          <input
            id="agx-project-name"
            value={name}
            maxLength={15}
            onChange={(event) => setName(clampProjectName(event.target.value))}
            className="mt-1 w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary outline-none"
          />
          <div className="mt-1 text-right text-[11px] tabular-nums text-text-faint">{name.length}/15</div>

          <div className="mt-4 flex items-center justify-between gap-2">
            <label className="text-[13px] text-text-strong" htmlFor="agx-project-instructions">
              {t("dialog.instructions")}
              <span className="ml-1 text-text-faint">{t("dialog.optional")}</span>
            </label>
            <select
              aria-label={t("dialog.pickTemplate")}
              value={templateId}
              onChange={(event) => applyTemplate(event.target.value)}
              className="max-w-[180px] rounded-md border border-border bg-surface-card px-2 py-1 text-[12px] text-text-primary outline-none"
            >
              <option value="">{t("dialog.pickTemplate")}</option>
              {GROUP_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {tSidebar(groupTemplateI18nKey(template.id, "name"))}
                </option>
              ))}
            </select>
          </div>
          <textarea
            id="agx-project-instructions"
            value={instructions}
            rows={5}
            onChange={(event) => setInstructions(event.target.value)}
            className="mt-1 w-full resize-y rounded-md border border-border bg-surface-card px-2 py-1.5 text-[13px] text-text-primary outline-none"
          />
          <p className="mt-1 text-left text-[11px] text-text-faint">{t("dialog.templateOverwrite")}</p>

          {renderPickerField("connectors", t("dialog.connectors"))}
          {renderPickerField("experts", t("dialog.experts"))}
          {renderPickerField("skills", t("dialog.skills"))}
        </div>
        {error ? (
          <p role="alert" className="px-4 pb-2 text-[12px] text-rose-400">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            onClick={onClose}
          >
            {t("dialog.cancel")}
          </button>
          <button
            type="button"
            disabled={!name.trim() || submitting}
            aria-busy={submitting}
            className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-sm font-medium text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-bg-hover,var(--ui-btn-primary-bg))] disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void submit()}
          >
            {submitting ? t("submitting") : t("dialog.confirm")}
          </button>
        </div>
      </div>
      {picker && pickerPos
        ? createPortal(
            <div
              ref={pickerRef}
              data-project-picker
              className="fixed z-[260] max-h-56 w-[240px] overflow-y-auto rounded-md border border-border bg-surface-base py-1 shadow-2xl"
              style={{ left: pickerPos.left, top: pickerPos.top }}
            >
              {activeItems.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-text-faint">{t("none")}</div>
              ) : (
                activeItems.map((item) => {
                  const checked = activeSelected.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary hover:bg-surface-hover"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setPickerSelected(
                            picker,
                            checked
                              ? activeSelected.filter((id) => id !== item.id)
                              : [...activeSelected, item.id],
                          )
                        }
                      />
                      <span className="truncate">{item.label}</span>
                    </label>
                  );
                })
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
