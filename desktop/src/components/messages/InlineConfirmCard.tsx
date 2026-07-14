import { useEffect, useId, useMemo, useState } from "react";
import { AlertCircle, Check, Clock, X } from "lucide-react";
import type {
  ActionConfirmationDecision,
  PendingActionConfirmation,
} from "../../utils/action-confirmation";
import {
  formatActionConfirmationCountdown,
  isActionConfirmationExpired,
  remainingActionConfirmationMs,
} from "../../utils/action-confirmation";
import { ASSISTANT_INLINE_CARD_SHELL_CLASS, GROUP_INLINE_CARD_SHELL_CLASS } from "./im-layout";

type Props = {
  confirmation: PendingActionConfirmation;
  groupChatRail?: boolean;
  onResolve: (
    confirmation: PendingActionConfirmation,
    decision: ActionConfirmationDecision,
  ) => Promise<void> | void;
};

function statusLabel(confirmation: PendingActionConfirmation): string {
  switch (confirmation.status) {
    case "approved":
      return "已确认";
    case "rejected":
      return "已取消";
    case "expired":
      return "确认已失效";
    case "resolving":
      return "提交中…";
    case "uncertain":
      return "请求可能已送达，请稍候观察";
    case "pending":
    default:
      return "待确认";
  }
}

export function InlineConfirmCard({
  confirmation,
  groupChatRail = false,
  onResolve,
}: Props) {
  const titleId = useId();
  const shellClass = groupChatRail ? GROUP_INLINE_CARD_SHELL_CLASS : ASSISTANT_INLINE_CARD_SHELL_CLASS;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [localBusy, setLocalBusy] = useState(false);

  const expiredByTime = isActionConfirmationExpired(confirmation, nowMs);
  const effectiveStatus =
    confirmation.status === "pending" && expiredByTime ? "expired" : confirmation.status;
  const interactive = effectiveStatus === "pending" && !localBusy;

  useEffect(() => {
    if (effectiveStatus !== "pending") return;
    if (
      typeof confirmation.expiresAtMs !== "number" ||
      !Number.isFinite(confirmation.expiresAtMs) ||
      confirmation.expiresAtMs <= 0
    ) {
      return;
    }
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tickMs = reducedMotion ? 1000 : 250;
    const timer = window.setInterval(() => setNowMs(Date.now()), tickMs);
    return () => window.clearInterval(timer);
  }, [confirmation.expiresAtMs, effectiveStatus]);

  const countdown = useMemo(() => {
    const remaining = remainingActionConfirmationMs(confirmation, nowMs);
    if (remaining === null) return null;
    return formatActionConfirmationCountdown(remaining);
  }, [confirmation, nowMs]);

  const handleResolve = async (decision: ActionConfirmationDecision) => {
    if (!interactive) return;
    setLocalBusy(true);
    try {
      await onResolve(confirmation, decision);
    } finally {
      setLocalBusy(false);
    }
  };

  const resolvedIcon =
    effectiveStatus === "approved" ? (
      <Check className="h-3.5 w-3.5 text-[var(--ui-btn-primary-bg)]" aria-hidden />
    ) : effectiveStatus === "rejected" ? (
      <X className="h-3.5 w-3.5 text-text-muted" aria-hidden />
    ) : effectiveStatus === "expired" || effectiveStatus === "uncertain" ? (
      <AlertCircle className="h-3.5 w-3.5 text-status-warning" aria-hidden />
    ) : (
      <Clock className="h-3.5 w-3.5 text-text-muted" aria-hidden />
    );

  return (
    <div
      className={`${shellClass} rounded-xl border border-border bg-surface-card px-3.5 py-3 shadow-sm`}
      role="dialog"
      aria-labelledby={titleId}
      aria-busy={effectiveStatus === "resolving" || localBusy}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            {resolvedIcon}
            <span>{statusLabel({ ...confirmation, status: effectiveStatus })}</span>
            {confirmation.source ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{confirmation.source}</span>
              </>
            ) : null}
          </div>
          <h3 id={titleId} className="mt-1 text-[14px] font-medium leading-snug text-text-strong">
            {confirmation.title}
          </h3>
        </div>
        {effectiveStatus === "pending" && countdown ? (
          <div
            className="shrink-0 rounded-md border border-border/70 bg-surface-hover/60 px-2 py-1 font-mono text-[11px] tabular-nums text-text-muted"
            aria-label={`剩余 ${countdown}`}
          >
            剩余 {countdown}
          </div>
        ) : null}
      </div>

      {confirmation.summary.length > 0 ? (
        <dl className="mt-3 space-y-1.5">
          {confirmation.summary.map((row) => (
            <div key={`${row.label}:${row.value.slice(0, 24)}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] leading-snug">
              <dt className="whitespace-nowrap text-text-muted">{row.label}</dt>
              <dd className="min-w-0 break-words text-text-primary">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {confirmation.error ? (
        <p className="mt-2 text-[12px] text-status-warning">{confirmation.error}</p>
      ) : null}

      {effectiveStatus === "uncertain" ? (
        <p className="mt-2 text-[12px] text-status-warning">
          请求可能已送达，请稍候观察；不要重复点击以免重复执行。
        </p>
      ) : null}

      {effectiveStatus === "expired" ? (
        <p className="mt-2 text-[12px] text-text-muted">
          确认已失效，请让智能体重新生成。
        </p>
      ) : null}

      {interactive || effectiveStatus === "resolving" ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!interactive}
              aria-label={confirmation.approveLabel}
              onClick={() => void handleResolve("approved")}
              className="inline-flex h-9 items-center justify-center rounded-lg border px-3 text-[13px] font-medium transition active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--ui-btn-primary-bg)",
                color: "var(--ui-btn-primary-text)",
                borderColor: "var(--ui-btn-primary-border)",
              }}
            >
              {confirmation.approveLabel}
            </button>
            <button
              type="button"
              disabled={!interactive}
              aria-label={confirmation.rejectLabel}
              onClick={() => void handleResolve("rejected")}
              className="inline-flex h-9 items-center justify-center rounded-lg border bg-transparent px-3 text-[13px] font-medium text-[rgb(var(--theme-color-rgb))] transition hover:bg-[rgba(var(--theme-color-rgb),0.08)] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: "var(--ui-btn-primary-border)" }}
            >
              {confirmation.rejectLabel}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            也可在输入框直接回复「确认」或「取消」
          </p>
        </>
      ) : null}
    </div>
  );
}
