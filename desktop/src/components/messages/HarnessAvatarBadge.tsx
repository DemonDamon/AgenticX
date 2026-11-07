import { Bot, Code2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  harnessBadgeFallbackLabel,
  harnessBadgeI18nKey,
  harnessDisplayKind,
  resolveMessageHarnessId,
} from "../../utils/harness-display";
import { BUILTIN_HARNESS_ID } from "../../utils/preferred-harness";

type Props = {
  harnessId?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Overlay on avatar (bottom-right) vs inline chip beside avatar/name. */
  variant?: "overlay" | "inline";
  className?: string;
};

function HarnessGlyph({ harnessId }: { harnessId: string }) {
  const kind = harnessDisplayKind(harnessId);
  const common = { size: 10 as const, strokeWidth: 2.25 as const, "aria-hidden": true as const };
  if (kind === "claude-code") return <Sparkles {...common} />;
  if (kind === "codebuddy") return <Code2 {...common} />;
  return <Bot {...common} />;
}

/**
 * Small per-turn harness marker for assistant bubbles (Damon: avatar_badge).
 * Omit when harness is unknown so historical rows stay uncluttered.
 */
export function HarnessAvatarBadge({
  harnessId,
  metadata,
  variant = "inline",
  className = "",
}: Props) {
  const { t } = useTranslation("chat");
  const resolved =
    (harnessId && String(harnessId).trim()) ||
    resolveMessageHarnessId(metadata ?? undefined);
  if (!resolved) return null;

  const id = resolved || BUILTIN_HARNESS_ID;
  const label = t(harnessBadgeI18nKey(id), {
    name: harnessBadgeFallbackLabel(id),
    defaultValue: harnessBadgeFallbackLabel(id),
  });

  const chip = (
    <span
      data-harness-avatar-badge={id}
      title={label}
      className={`inline-flex max-w-[9.5rem] items-center gap-0.5 rounded-full border border-border/80 bg-surface-card/95 px-1.5 py-0.5 text-[10px] font-medium leading-none text-text-muted shadow-sm ${className}`}
    >
      <HarnessGlyph harnessId={id} />
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );

  if (variant === "overlay") {
    return (
      <span className="pointer-events-none absolute -bottom-1 left-1/2 z-[1] -translate-x-1/2 whitespace-nowrap">
        {chip}
      </span>
    );
  }
  return chip;
}
