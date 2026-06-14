import { useEffect, useRef, useState } from "react";

export type SettingsDropdownOption = { value: string; label: string };

type Props = {
  value: string;
  displayLabel: string;
  options: ReadonlyArray<SettingsDropdownOption>;
  onChange: (v: string) => void;
  className?: string;
  label?: string;
  size?: "default" | "compact";
  disabled?: boolean;
  title?: string;
};

/** 自定义下拉，替代原生 select，与设置页主题选择器同款样式 */
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
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const compact = size === "compact";

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const triggerClass = compact
    ? "flex h-8 w-full items-center justify-between rounded-md border border-border bg-surface-panel px-2 text-xs text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
    : "flex w-full items-center justify-between rounded-md border border-border bg-surface-panel px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60";

  const itemClass = compact
    ? "flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors hover:bg-surface-hover"
    : "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-hover";

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label ? <div className="mb-1.5 text-sm text-text-muted">{label}</div> : null}
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((o) => !o);
        }}
        className={triggerClass}
      >
        <span className="min-w-0 truncate text-left">{displayLabel}</span>
        <svg
          className={`ml-2 size-3.5 shrink-0 text-text-subtle transition-transform duration-150 ${open ? "rotate-180" : ""}`}
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
      {open && !disabled ? (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full min-w-full overflow-y-auto rounded-lg border border-border bg-surface-popover shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={`${itemClass} ${
                value === opt.value ? "text-text-primary" : "text-text-subtle"
              }`}
            >
              <span
                className={`size-1.5 shrink-0 rounded-full ${
                  value === opt.value ? "bg-[rgba(var(--theme-color-rgb),0.9)]" : "bg-transparent"
                }`}
              />
              <span className="min-w-0 truncate text-left">{opt.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
