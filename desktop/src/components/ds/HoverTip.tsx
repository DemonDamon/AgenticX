import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  /** Show delay; native `title` is often ~500–1000ms and cannot be tuned. */
  delayMs?: number;
  children: ReactNode;
};

export function HoverTip({ label, delayMs = 280, children }: Props) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  return (
    <div
      className="relative flex shrink-0"
      onPointerEnter={() => {
        clearTimer();
        timerRef.current = setTimeout(() => setOpen(true), delayMs);
      }}
      onPointerLeave={() => {
        clearTimer();
        setOpen(false);
      }}
    >
      {children}
      {open ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-[60] mb-1.5 w-max max-w-[min(288px,calc(100vw-24px))] -translate-x-1/2 rounded-md border border-border bg-surface-panel px-2.5 py-1.5 text-left text-[11px] leading-snug text-text-primary shadow-lg backdrop-blur-xl"
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}
