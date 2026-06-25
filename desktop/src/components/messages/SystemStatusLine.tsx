import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type SystemStatusTone = "neutral" | "info" | "success" | "warning";

const TONE: Record<
  SystemStatusTone,
  { bg: string; ring: string; fg: string }
> = {
  neutral: {
    bg: "rgba(var(--theme-color-rgb, 139, 92, 246), 0.11)",
    ring: "rgba(var(--theme-color-rgb, 139, 92, 246), 0.28)",
    fg: "color-mix(in srgb, rgb(var(--theme-color-rgb, 139, 92, 246)) 72%, var(--text-primary) 28%)",
  },
  info: {
    bg: "rgba(var(--theme-color-rgb, 59, 130, 246), 0.12)",
    ring: "rgba(var(--theme-color-rgb, 59, 130, 246), 0.32)",
    fg: "rgb(var(--theme-color-rgb, 59, 130, 246))",
  },
  success: {
    bg: "rgba(52, 211, 153, 0.12)",
    ring: "rgba(52, 211, 153, 0.32)",
    fg: "rgba(134, 239, 172, 0.96)",
  },
  warning: {
    bg: "rgba(251, 191, 36, 0.12)",
    ring: "rgba(251, 191, 36, 0.34)",
    fg: "rgba(253, 224, 71, 0.96)",
  },
};

type Props = {
  icon: LucideIcon;
  tone?: SystemStatusTone;
  children: ReactNode;
  className?: string;
  "data-status-kind"?: string;
};

/** Claude-style flat system row: soft icon tile + muted body (no ToolCallCard chrome). */
export function SystemStatusLine({
  icon: Icon,
  tone = "neutral",
  children,
  className = "",
  "data-status-kind": dataStatusKind,
}: Props) {
  const palette = TONE[tone];
  return (
    <div
      className={`agx-system-status-line flex min-w-0 items-start gap-2.5 px-3 py-2 text-[13px] leading-[1.65] ${className}`}
      data-status-kind={dataStatusKind}
    >
      <span
        className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
        style={{
          backgroundColor: palette.bg,
          boxShadow: `inset 0 0 0 1px ${palette.ring}`,
          color: palette.fg,
        }}
        aria-hidden
      >
        <Icon className="h-3 w-3" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1 text-text-muted">{children}</div>
    </div>
  );
}
