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
  className?: string;
};

function HarnessGlyph({ harnessId }: { harnessId: string }) {
  const kind = harnessDisplayKind(harnessId);
  const common = { size: 11 as const, strokeWidth: 2.4 as const, "aria-hidden": true as const };
  if (kind === "claude-code") return <Sparkles {...common} />;
  if (kind === "codebuddy") return <Code2 {...common} />;
  return <Bot {...common} />;
}

/**
 * Compact per-turn harness marker: Grok-style circular icon on the
 * top-right corner of the assistant answer bubble. Icon only; hover
 * title shows AgenticX / Claude Code / CodeBuddy. Omit when unknown.
 */
export function HarnessAvatarBadge({
  harnessId,
  metadata,
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

  return (
    <span
      data-harness-avatar-badge={id}
      data-harness-badge-corner=""
      title={label}
      aria-label={label}
      className={`pointer-events-auto absolute -right-1 -top-1 z-[2] inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/70 bg-surface-card text-text-muted shadow-sm ${className}`}
    >
      <HarnessGlyph harnessId={id} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
