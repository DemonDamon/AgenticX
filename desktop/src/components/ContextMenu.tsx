import { useEffect, useLayoutEffect, useRef } from "react";

export type ContextMenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
};

type Props = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({ open, x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open, x, y, items]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="fixed z-[200] min-w-[168px] rounded-xl border border-border bg-surface-panel/95 py-1 shadow-2xl backdrop-blur-md"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          className={`flex w-full px-3 py-2 text-left text-[13px] transition ${
            item.danger 
              ? "text-rose-500 hover:bg-surface-hover hover:text-rose-600 hover:font-semibold" 
              : "text-text-primary hover:bg-surface-hover"
          }`}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
