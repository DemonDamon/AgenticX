import { AlertTriangle, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BudgetExceededInfo } from "../../utils/budget-exceeded";
import { budgetExceededPercent } from "../../utils/budget-exceeded";

type Props = {
  /** token = budget-exceeded card; rounds = rounds-exhausted truncation card (same treatment). */
  kind?: "token" | "rounds";
  /** Token budget numbers (kind="token"). */
  info?: BudgetExceededInfo;
  /** Round numbers (kind="rounds"). */
  rounds?: { round: number; maxRounds: number };
  /** Primary CTA: inject the resume draft into the current session's composer. */
  onResumeDraft: () => void;
  /** Secondary: continue in a brand-new session with the draft. */
  onResumeInNewSession: () => void;
  onOpenSettings?: () => void;
};

export function BudgetExceededCard({
  kind = "token",
  info,
  rounds,
  onResumeDraft,
  onResumeInNewSession,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation("chat");
  const isRounds = kind === "rounds";
  const pct = info ? budgetExceededPercent(info) : 0;

  const copySessionId = async () => {
    const sid = String(info?.sessionId ?? "").trim();
    if (!sid) return;
    try {
      await navigator.clipboard.writeText(sid);
    } catch {
      // ignore clipboard failures
    }
  };

  const title = isRounds
    ? t("budget.roundsTitle", {
        rounds: rounds?.round ?? rounds?.maxRounds ?? "?",
        max: rounds?.maxRounds ?? rounds?.round ?? "?",
      })
    : info?.source === "session"
      ? t("budget.titleSession")
      : t("budget.title");
  const body = isRounds ? t("budget.roundsBody") : null;
  const tokenBodyKey =
    info?.source === "session" ? "budget.bodySession" : "budget.body";

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 justify-start gap-2">
        <div className="flex min-w-0 flex-1 flex-row gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <div
              className={`w-full min-w-0 overflow-hidden rounded-lg border bg-surface-card text-[15px] leading-relaxed ${
                isRounds
                  ? "border-amber-500/45"
                  : "border-rose-500/45"
              }`}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${isRounds ? "text-amber-400" : "text-rose-400"}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-text-strong">{title}</p>
                  {isRounds ? (
                    body ? <p className="mt-1 text-xs text-text-muted">{body}</p> : null
                  ) : info ? (
                    <>
                      <p className="mt-1 text-sm font-medium tabular-nums text-text-strong">
                        {t("budget.usageLine", {
                          current: info.current.toLocaleString(),
                          max: info.maxAllowed.toLocaleString(),
                        })}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {t(tokenBodyKey, {
                          current: info.current.toLocaleString(),
                          max: info.maxAllowed.toLocaleString(),
                          pct,
                          source: info.source,
                        })}
                      </p>
                    </>
                  ) : null}

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onResumeDraft}
                      className="rounded-md bg-btnPrimary px-3 py-1 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
                    >
                      {t("budget.resumeDraft")}
                    </button>
                    <button
                      type="button"
                      onClick={onResumeInNewSession}
                      className="rounded-md border border-border bg-surface-hover px-3 py-1 text-xs font-medium text-text-strong transition hover:bg-surface-card"
                    >
                      {t("budget.newSession")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSettings?.()}
                      className="rounded-md border border-border bg-surface-hover px-3 py-1 text-xs font-medium text-text-strong transition hover:bg-surface-card"
                    >
                      {isRounds ? t("budget.adjustRounds") : t("budget.adjust")}
                    </button>
                    {!isRounds && info?.sessionId ? (
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
