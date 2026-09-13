import { AlertTriangle, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BudgetExceededInfo } from "../../utils/budget-exceeded";
import { budgetExceededPercent } from "../../utils/budget-exceeded";

type Props = {
  info: BudgetExceededInfo;
  onResumeInNewSession: () => void;
  onOpenSettings?: () => void;
};

export function BudgetExceededCard({ info, onResumeInNewSession, onOpenSettings }: Props) {
  const { t } = useTranslation("chat");
  const pct = budgetExceededPercent(info);

  const copySessionId = async () => {
    const sid = String(info.sessionId ?? "").trim();
    if (!sid) return;
    try {
      await navigator.clipboard.writeText(sid);
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 justify-start gap-2">
        <div className="flex min-w-0 flex-1 flex-row gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <div className="w-full min-w-0 overflow-hidden rounded-lg border border-rose-500/45 bg-surface-card text-[15px] leading-relaxed">
              <div className="flex items-start gap-3 px-4 py-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-text-strong">{t("budget.title")}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {t("budget.body", {
                      current: info.current.toLocaleString(),
                      max: info.maxAllowed.toLocaleString(),
                      pct,
                      source: info.source,
                    })}
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onResumeInNewSession}
                      className="rounded-md bg-btnPrimary px-3 py-1 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
                    >
                      {t("budget.newSession")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSettings?.()}
                      className="rounded-md border border-border bg-surface-hover px-3 py-1 text-xs font-medium text-text-strong transition hover:bg-surface-card"
                    >
                      {t("budget.adjust")}
                    </button>
                    {info.sessionId ? (
                      <button
                        type="button"
                        onClick={() => void copySessionId()}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-muted transition hover:text-text-strong"
                      >
                        <Copy className="h-3 w-3" aria-hidden />
                        {t("budget.copySession")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
