import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TaskspaceMountMode } from "../../store";

type Props = {
  sources: string[];
  mode: TaskspaceMountMode;
  adding: boolean;
  onModeChange: (mode: TaskspaceMountMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const OPTIONS = [
  { id: "reference" as const, titleKey: "composer.mountReference", descKey: "composer.mountReferenceDesc" },
  { id: "copy" as const, titleKey: "composer.mountCopy", descKey: "composer.mountCopyDesc" },
  { id: "link" as const, titleKey: "composer.mountLink", descKey: "composer.mountLinkDesc", danger: true },
] as const;

export function MountModeDialog({
  sources,
  mode,
  adding,
  onModeChange,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useTranslation("chat");
  const { t: tCommon } = useTranslation("common");
  const [advancedOpen, setAdvancedOpen] = useState(mode === "link");
  const visibleOptions = advancedOpen
    ? OPTIONS
    : OPTIONS.filter((option) => option.id !== "link");
  return createPortal(
    <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-base p-4 shadow-2xl">
        <div className="mb-3 text-[15px] font-medium text-text-strong">{t("composer.mountTitle")}</div>
        <div className="mb-3 truncate text-[12px] text-text-faint">
          {sources.length === 1 ? sources[0] : t("composer.mountPaths", { count: sources.length })}
        </div>
        <div className="space-y-2">
          {visibleOptions.map((opt) => {
            const active = mode === opt.id;
            const danger = "danger" in opt && opt.danger;
            const desc =
              opt.id === "link"
                ? (sources[0]
                  ? t("composer.mountLinkDescNamed", { path: sources[0] })
                  : t("composer.mountLinkDesc"))
                : t(opt.descKey);
            return (
              <button
                key={opt.id}
                type="button"
                className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${
                  active
                    ? danger
                      ? "border-rose-400/50 bg-rose-500/10"
                      : "border-[rgba(var(--theme-color-rgb),0.55)] bg-[rgba(var(--theme-color-rgb),0.12)]"
                    : "border-border bg-surface-hover hover:bg-surface-card-strong"
                }`}
                onClick={() => onModeChange(opt.id)}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    active ? "bg-emerald-500 text-white" : "border border-border bg-transparent"
                  }`}
                  aria-hidden
                >
                  {active ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[13px] font-medium ${
                      danger ? "text-rose-300" : "text-text-primary"
                    }`}
                  >
                    {t(opt.titleKey)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-text-faint">
                    {desc}
                  </span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] text-text-faint hover:bg-surface-hover hover:text-text-muted"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              strokeWidth={1.8}
            />
            <span>{t("composer.mountAdvanced")}</span>
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[13px] text-text-muted hover:bg-surface-hover"
            onClick={onCancel}
            disabled={adding}
          >
            {tCommon("cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-[13px] hover:opacity-90 disabled:opacity-50"
            style={{
              background: "var(--ui-btn-primary-bg)",
              color: "var(--ui-btn-primary-text)",
            }}
            onClick={onConfirm}
            disabled={adding}
          >
            {adding ? t("composer.adding") : t("composer.confirmAdd")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
