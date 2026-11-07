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
 * Grok-style circular harness mark at the user-bubble top-right.
 * Offset ≈ -(radius + gap) on a 24px chip (~16px / -top-4) so the circle
 * sits fully outside the orange fill with a small page-bg gap. Chip fill
 * matches the chat pane canvas so that gap reads like Grok.
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
      className={`pointer-events-auto absolute -right-4 -top-4 z-[2] inline-flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-border bg-[var(--shell-canvas,var(--surface-base))] p-[3px] text-text-strong shadow-[0_1px_2px_rgba(0,0,0,0.14)] ${className}`}
    >
      <HarnessMark harnessId={id} size={18} className="h-[18px] w-[18px]" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
