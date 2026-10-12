import { useTranslation } from "react-i18next";
import type { AgentActivitySummary } from "../utils/agent-activity";

type Props = {
  summary: AgentActivitySummary;
  /** 子智能体已全部结束，主智能体正在汇总其结果。 */
  summarizing?: boolean;
  onOpen: () => void;
};

export function AgentActivityPill({ summary, summarizing = false, onOpen }: Props) {
  const { t } = useTranslation("chat");
  if (summary.active <= 0 && !summarizing) return null;
  const needsUser = summary.awaitingConfirm > 0 || summary.awaitingInput > 0;
  const parts: string[] = [];
  if (summary.running > 0) parts.push(t("activity.running", { count: summary.running }));
  if (summary.awaitingConfirm > 0) parts.push(t("activity.awaiting", { count: summary.awaitingConfirm }));
  if (summary.awaitingInput > 0) parts.push(t("activity.input", { count: summary.awaitingInput }));
  if (summary.active <= 0 && summarizing) parts.push(t("activity.summarizing"));
  return (
    <div className="flex justify-center px-4 pb-1.5">
      <button
        type="button"
        onClick={onOpen}
        title={t("activity.open")}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] transition-colors hover:bg-surface-hover ${
          needsUser
            ? "border-[color-mix(in_srgb,var(--status-warning)_45%,transparent)] text-[var(--status-warning)]"
            : "border-border text-text-muted"
        }`}
      >
        <span className="inline-flex items-center gap-0.5" aria-hidden>
          <span className="agx-dot-pulse h-1.5 w-1.5 rounded-full bg-current" />
          <span className="agx-dot-pulse h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: "0.2s" }} />
          <span className="agx-dot-pulse h-1.5 w-1.5 rounded-full bg-current" style={{ animationDelay: "0.4s" }} />
        </span>
        <span>{parts.join(" · ")}</span>
      </button>
    </div>
  );
}
