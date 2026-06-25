import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

export type SettingsDropdownOption = { value: string; label: string };

type Props = {
  value: string;
  displayLabel: string;
  options: ReadonlyArray<SettingsDropdownOption>;
  onChange: (v: string) => void;
  className?: string;
  label?: string;
  size?: "default" | "compact" | "inline";
  disabled?: boolean;
  title?: string;
  /** Mount menu on document.body to escape overflow-hidden ancestors. */
  menuPortal?: boolean;
};

function measureMenuPosition(trigger: HTMLElement, fitContent: boolean) {
  const rect = trigger.getBoundingClientRect();
  return {
    top: rect.bottom + 4,
    left: rect.left,
    width: fitContent ? rect.width : Math.max(rect.width, 128),
  };
}

function findScrollParents(el: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = [];
  let node = el?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      out.push(node);
    }
    node = node.parentElement;
  }
  return out;
}

/** Custom dropdown replacing native select; matches settings panel theme pickers. */
export function SettingsDropdown({
  label,
  value,
  displayLabel,
  options,
  onChange,
  className = "",
  size = "default",
  disabled = false,
  title,
  menuPortal = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inline = size === "inline";
  const compact = size === "compact" || inline;

  const syncMenuPosition = useCallback(() => {
    if (!triggerRef.current) return;
    setMenuPos(measureMenuPosition(triggerRef.current, inline));
  }, [inline]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open || !menuPortal) return;
    syncMenuPosition();

    const isInsideMenu = (target: EventTarget | null) =>
      target instanceof Node && Boolean(menuRef.current?.contains(target));

    /** Portal menus dismiss on scroll so they never float detached from the trigger. */
    const dismissUnlessMenu = (e: Event) => {
      if (isInsideMenu(e.target)) return;
      setOpen(false);
    };

    const scrollParents = findScrollParents(triggerRef.current);
    for (const parent of scrollParents) {
      parent.addEventListener("scroll", dismissUnlessMenu, { passive: true });
    }
    window.addEventListener("scroll", dismissUnlessMenu, true);
    document.addEventListener("wheel", dismissUnlessMenu, { capture: true, passive: true });
    window.addEventListener("resize", dismissUnlessMenu);

    return () => {
      for (const parent of scrollParents) {
        parent.removeEventListener("scroll", dismissUnlessMenu);
      }
      window.removeEventListener("scroll", dismissUnlessMenu, true);
      document.removeEventListener("wheel", dismissUnlessMenu, true);
      window.removeEventListener("resize", dismissUnlessMenu);
    };
  }, [open, menuPortal, syncMenuPosition]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const triggerClass = inline
    ? "inline-flex h-7 w-auto shrink-0 items-center gap-0.5 rounded border border-border bg-surface-panel px-2 text-[11px] text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
    : compact
      ? "flex h-8 w-full items-center justify-between rounded-md border border-border bg-surface-panel px-2 text-xs text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
      : "flex w-full items-center justify-between rounded-md border border-border bg-surface-panel px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60";

  const itemClass = inline
    ? "flex w-full items-center gap-1 px-1.5 py-1 text-[11px] transition-colors hover:bg-surface-hover"
    : compact
      ? "flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-hover"
      : "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-hover";

  const menu = open && !disabled ? (
    <div
      ref={menuRef}
      style={
        menuPortal && menuPos
          ? {
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              zIndex: 10000,
            }
          : undefined
      }
      className={
        menuPortal
          ? inline
            ? "max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-popover p-0.5 shadow-lg"
            : "max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-popover p-1 shadow-xl"
          : "absolute left-0 top-full z-50 mt-1 max-h-48 w-full min-w-full overflow-y-auto rounded-lg border border-border bg-surface-popover p-1 shadow-lg"
      }
      role="listbox"
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => {
              onChange(opt.value);
              setOpen(false);
            }}
            className={`${itemClass} rounded-md ${
              selected ? "bg-surface-hover text-text-primary" : "text-text-subtle"
            }`}
          >
            <span className="flex w-3 shrink-0 justify-center">
              {selected ? <Check className="h-2.5 w-2.5 text-[rgb(var(--theme-color-rgb,59,130,246))]" strokeWidth={2.5} /> : null}
            </span>
            <span className="min-w-0 truncate text-left">{opt.label}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label ? <div className="mb-1.5 text-sm text-text-muted">{label}</div> : null}
      <button
        ref={triggerRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          if (!open && menuPortal) syncMenuPosition();
          setOpen((o) => !o);
        }}
        className={triggerClass}
      >
        <span className="min-w-0 truncate text-left">{displayLabel}</span>
        <svg
          className={`ml-1.5 size-3 shrink-0 text-text-subtle transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {menu ? (menuPortal ? createPortal(menu, document.body) : menu) : null}
    </div>
  );
}
