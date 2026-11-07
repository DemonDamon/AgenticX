import { useTranslation } from "react-i18next";

import { HarnessMark } from "../harness/HarnessMark";
import {
  harnessBadgeFallbackLabel,
  harnessBadgeI18nKey,
  resolveMessageHarnessId,
  canonicalizeHarnessId,
} from "../../utils/harness-display";
import { BUILTIN_HARNESS_ID } from "../../utils/preferred-harness";

type Props = {
  harnessId?: string | null;
  metadata?: Record<string, unknown> | null;
  className?: string;
};

/**
 * Compact per-turn harness marker: Grok-style circular icon on the
 * top-right corner of the user input bubble. Exclusive SVG when known;
 * hover title shows the display name. Omit when unknown.
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

  const id = canonicalizeHarnessId(resolved) || BUILTIN_HARNESS_ID;
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
      <HarnessMark harnessId={id} size={12} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
