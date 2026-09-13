import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  onDismiss?: () => void;
};

export function SecurityRulesGuide({ onDismiss }: Props) {
  const { t } = useTranslation("settings");
  return (
    <div
      className="rounded-lg border border-[var(--ui-btn-primary-bg)]/35 bg-[var(--ui-btn-primary-bg)]/8 px-3 py-2.5"
      data-testid="security-rules-guide"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">{t("security.rulesGuide.title")}</div>
          <p className="mt-1 text-xs leading-5 text-text-subtle">{t("security.rulesGuide.body")}</p>
        </div>
        {onDismiss ? (
          <button
            type="button"
            aria-label={t("security.rulesGuide.dismissAria")}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-primary"
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
