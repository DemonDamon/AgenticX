import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  label?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  /** Visual divider between menu groups */
  separator?: boolean;
};

export type ContextMenuAnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Props = {
  open: boolean;
  x: number;
  y: number;
  /** When set, menu opens below the anchor row (flips above if needed). */
  anchorRect?: ContextMenuAnchorRect | null;
  items: ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({ open, x, y, anchorRect, items, onClose }: Props) {
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
    const gap = 4;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (anchorRect) {
      left = anchorRect.left;
      top = anchorRect.bottom + gap;
      if (top + rect.height > vh - pad) {
        const above = anchorRect.top - rect.height - gap;
        if (above >= pad) top = above;
      }
    }
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (left < pad) left = pad;
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    if (top < pad) top = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open, x, y, anchorRect, items]);

  if (!open) return null;

  // Portal to body so fixed positioning uses viewport coords even inside
  // transformed ancestors (e.g. SidebarSessionHistory slide panels).
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] min-w-[168px] rounded-xl border border-border bg-surface-panel/95 py-1 shadow-2xl backdrop-blur-md"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="my-1 border-t border-border" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition ${
              item.danger
                ? "text-rose-500 hover:bg-surface-hover hover:text-rose-600 hover:font-semibold"
                : "text-text-primary hover:bg-surface-hover"
            }`}
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
          >
            {item.icon ? <span className="shrink-0" aria-hidden>{item.icon}</span> : null}
            {item.label}
          </button>
        )
      )}
    </div>,
    document.body
  );
}
