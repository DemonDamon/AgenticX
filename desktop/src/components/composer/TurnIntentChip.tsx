import { ClipboardList, GitBranch, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HoverTip } from "../ds/HoverTip";

export function TurnIntentChip({
  intent,
  onClear,
}: {
  intent: "plan" | "isolate";
  onClear: () => void;
}) {
  const { t } = useTranslation("chat");
  const label = intent === "isolate" ? t("composer.modeMultitask") : t("composer.modePlan");
  const Icon = intent === "isolate" ? GitBranch : ClipboardList;

  return (
    <HoverTip label={label} delayMs={180} placement="below">
      <button
        type="button"
        className="group inline-flex h-7 items-center gap-1 rounded-full bg-surface-hover px-2 text-[12px] text-text-primary transition-colors hover:bg-surface-card-strong"
        aria-label={t("composer.modeClear", { label })}
        onClick={onClear}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted group-hover:hidden" strokeWidth={1.8} aria-hidden />
        <X className="hidden h-3.5 w-3.5 shrink-0 group-hover:block" strokeWidth={2.2} aria-hidden />
        <span>{label}</span>
      </button>
    </HoverTip>
  );
}
