import { useEffect } from "react";

type Props = {
  open: boolean;
  message: string;
  onClose: () => void;
  timeoutMs?: number;
  /** Info row with icon (Cherry-style notice). */
  variant?: "default" | "info";
};

function InfoIcon() {
  return (
    <span
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: "var(--ui-btn-primary-bg, #2563eb)" }}
      aria-hidden
    >
      i
    </span>
  );
}

export function Toast({ open, message, onClose, timeoutMs = 2600, variant = "default" }: Props) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onClose, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [open, onClose, timeoutMs]);

  if (!open) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-toast">
      <div
        className={`rounded-lg border border-border bg-surface-card shadow-lg ${
          variant === "info" ? "flex max-w-[min(92vw,22rem)] items-start gap-2 px-3 py-2.5" : "px-3 py-2"
        } text-xs text-text-primary`}
      >
        {variant === "info" ? <InfoIcon /> : null}
        <span className={variant === "info" ? "pt-0.5 leading-snug" : ""}>{message}</span>
      </div>
    </div>
  );
}

