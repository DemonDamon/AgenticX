import { useEffect } from "react";

export type ToastPlacement = "fixed-bottom-right" | "inline-center" | "inline-bottom-center";

type Props = {
  open: boolean;
  message: string;
  onClose: () => void;
  timeoutMs?: number;
  /** Warning row with yellow exclamation (model / attach notices). */
  variant?: "default" | "warning";
  placement?: ToastPlacement;
};

function WarningIcon() {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[13px] font-bold leading-none text-amber-950 shadow-sm"
      aria-hidden
    >
      !
    </span>
  );
}

export function Toast({
  open,
  message,
  onClose,
  timeoutMs = 2600,
  variant = "default",
  placement = "fixed-bottom-right",
}: Props) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onClose, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [open, onClose, timeoutMs]);

  if (!open) return null;

  const inner = (
    <div
      className={`rounded-lg border border-border bg-surface-card/95 shadow-lg backdrop-blur-sm ${
        variant === "warning" ? "flex max-w-[min(90%,20rem)] items-center gap-2 px-3 py-2.5" : "px-3 py-2"
      } text-xs text-text-primary`}
    >
      {variant === "warning" ? <WarningIcon /> : null}
      <span className={variant === "warning" ? "leading-snug" : ""}>{message}</span>
    </div>
  );

  if (placement === "inline-center") {
    return (
      <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
        {inner}
      </div>
    );
  }

  if (placement === "inline-bottom-center") {
    return (
      <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-center px-2 pb-5 pt-0">
        {inner}
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-toast">
      {inner}
    </div>
  );
}
