import { AlertTriangle, Copy } from "lucide-react";
import type { BudgetExceededInfo } from "../../utils/budget-exceeded";
import { budgetExceededPercent } from "../../utils/budget-exceeded";

type Props = {
  info: BudgetExceededInfo;
  onResumeInNewSession: () => void;
  onOpenSettings?: () => void;
};

export function BudgetExceededCard({ info, onResumeInNewSession, onOpenSettings }: Props) {
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
                  <p className="text-[15px] font-medium text-text-strong">会话累计 token 已达上限</p>
                  <p className="mt-1 text-xs text-text-muted">
                    当前累计 {info.current.toLocaleString()} / 上限 {info.maxAllowed.toLocaleString()}（约 {pct}%，source=
                    {info.source}）。无人值守续跑无法绕过此限制，建议新建会话续接此任务。
                  </p>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={onResumeInNewSession}
                      className="rounded-md bg-btnPrimary px-3 py-1 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
                    >
                      新建会话续接此任务
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSettings?.()}
                      className="rounded-md border border-border bg-surface-hover px-3 py-1 text-xs font-medium text-text-strong transition hover:bg-surface-card"
                    >
                      调整预算上限
                    </button>
                    {info.sessionId ? (
                      <button
                        type="button"
                        onClick={() => void copySessionId()}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-text-muted transition hover:text-text-strong"
                      >
                        <Copy className="h-3 w-3" aria-hidden />
                        复制 session_id
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
