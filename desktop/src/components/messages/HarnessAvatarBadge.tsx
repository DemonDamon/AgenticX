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
 * top-right corner of the user input bubble. Solid opaque chip so the
 * orange bubble does not wash through; exclusive / Near marks fill most
 * of the circle.
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
      className={`pointer-events-auto absolute -right-1.5 -top-1.5 z-[2] inline-flex h-6 w-6 items-center justify-center rounded-full border border-black/10 bg-white p-0.5 text-text-strong shadow-md [html[data-theme=dark]_&]:border-white/20 [html[data-theme=dark]_&]:bg-[#2c2c30] ${className}`}
    >
      <HarnessMark harnessId={id} size={18} className="h-[18px] w-[18px]" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
