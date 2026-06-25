import { RefreshCw } from "lucide-react";
import type { Message } from "../../store";
import {
  parseContinuationNotice,
  type ContinuationNoticeVariant,
} from "../../utils/continuation-notice";
import { SystemStatusLine } from "./SystemStatusLine";

type Props = {
  message: Message;
};

function variantTone(variant: ContinuationNoticeVariant) {
  if (variant === "supervisor") return "neutral" as const;
  if (variant === "auto_nudge") return "info" as const;
  return "info" as const;
}

function ReasonChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border-muted bg-surface-card px-2 py-0.5 text-[11px] font-medium text-text-subtle">
      {label}
    </span>
  );
}

function RoundLabel({
  round,
  maxRounds,
}: {
  round?: number;
  maxRounds?: number;
}) {
  if (round == null) return null;
  const text =
    maxRounds != null && maxRounds > 0
      ? `第 ${round}/${maxRounds} 次`
      : `第 ${round} 轮`;
  return <span className="text-[11px] tabular-nums text-text-faint">{text}</span>;
}

export function ContinuationNoticeLine({ message }: Props) {
  const parsed = parseContinuationNotice(message);
  const fallback = String(message.content ?? "")
    .replace(/^🔁\s*/u, "")
    .replace(/^🔔\s*/u, "")
    .trim();

  if (!parsed) {
    if (!fallback) return null;
    return (
      <SystemStatusLine icon={RefreshCw} tone="neutral" data-status-kind="continuation">
        <span className="text-text-subtle">{fallback}</span>
      </SystemStatusLine>
    );
  }

  return (
    <SystemStatusLine
      icon={RefreshCw}
      tone={variantTone(parsed.variant)}
      data-status-kind={`continuation-${parsed.variant}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-text-subtle">{parsed.title}</span>
        {parsed.reason ? <ReasonChip label={parsed.reason} /> : null}
        <RoundLabel round={parsed.round} maxRounds={parsed.maxRounds} />
      </div>
    </SystemStatusLine>
  );
}
