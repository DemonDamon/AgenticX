import { useEffect } from "react";

type Props = {
  open: boolean;
  message: string;
  onClose: () => void;
  timeoutMs?: number;
};

export function Toast({ open, message, onClose, timeoutMs = 2600 }: Props) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onClose, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [open, onClose, timeoutMs]);

  if (!open) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-toast">
      <div className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-primary shadow-lg">
        {message}
      </div>
    </div>
  );
}
