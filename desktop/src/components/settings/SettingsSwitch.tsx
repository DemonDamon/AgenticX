type Props = {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  size?: "sm" | "md";
  "aria-label"?: string;
};

/** 设置内统一开关：主题色轨道 + 白钮 */
export function SettingsSwitch({
  checked,
  disabled,
  onChange,
  size = "md",
  "aria-label": ariaLabel,
}: Props) {
  const trackClass = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knobClass = size === "sm" ? "left-0.5 top-0.5 h-3 w-3" : "left-0.5 top-0.5 h-4 w-4";
  const knobTranslate = size === "sm" ? "translate-x-3" : "translate-x-4";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative ${trackClass} shrink-0 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb,16,185,129),0.55)] disabled:opacity-40 ${
        checked ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-surface-hover"
      }`}
    >
      <span
        className={`pointer-events-none absolute ${knobClass} rounded-full bg-white shadow-sm transition-transform ${
          checked ? knobTranslate : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** 带 ON/OFF 字样的开关（用于面板右上角） */
export function SettingsOnOffSwitch({
  checked,
  disabled,
  onChange,
  "aria-label": ariaLabel,
}: Omit<Props, "size">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative h-6 w-[52px] shrink-0 overflow-hidden rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--theme-color-rgb,16,185,129),0.55)] disabled:opacity-40 ${
        checked ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-surface-hover"
      }`}
    >
      <span
        className={`pointer-events-none absolute top-1/2 z-0 -translate-y-1/2 text-[9px] font-semibold uppercase tracking-wide ${
          checked
            ? "left-2 text-white"
            : "right-2 text-text-subtle"
        }`}
      >
        {checked ? "ON" : "OFF"}
      </span>
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 z-10 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-[28px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}
