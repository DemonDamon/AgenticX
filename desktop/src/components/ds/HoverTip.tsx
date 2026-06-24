import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  /** Show delay; native `title` is often ~500–1000ms and cannot be tuned. */
  delayMs?: number;
  /** Keep wrapper inline for @file chips inside message text. */
  inline?: boolean;
  children: ReactNode;
};

export function HoverTip({ label, delayMs = 280, inline = false, children }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const updateCoords = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCoords({ x: rect.left + rect.width / 2, y: rect.top });
  };

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updateCoords();
    const reposition = () => updateCoords();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const tooltip =
    open && coords && label.trim()
      ? createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[100] w-max max-w-[min(360px,calc(100vw-24px))] break-all rounded-md border border-border bg-surface-panel px-2.5 py-1.5 text-left text-[11px] leading-snug text-text-primary shadow-lg backdrop-blur-xl"
            style={{
              left: coords.x,
              top: coords.y,
              transform: "translate(-50%, calc(-100% - 6px))",
            }}
          >
            {label}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <div
        ref={anchorRef}
        className={inline ? "relative inline align-baseline" : "relative flex shrink-0"}
        onPointerEnter={() => {
          clearTimer();
          timerRef.current = setTimeout(() => {
            updateCoords();
            setOpen(true);
          }, delayMs);
        }}
        onPointerLeave={() => {
          clearTimer();
          setOpen(false);
        }}
      >
        {children}
      </div>
      {tooltip}
    </>
  );
}
