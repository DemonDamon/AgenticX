import type { ChangeEvent, CSSProperties } from "react";

type Props = {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  showNumberInput?: boolean;
  showMinMaxHints?: boolean;
  numberInputClassName?: string;
};

/** 设置内统一 range：主题色填充轨道 + 圆角滑钮 */
export function SettingsRangeField({
  min,
  max,
  step = 1,
  value,
  onChange,
  disabled,
  showNumberInput = true,
  showMinMaxHints = true,
  numberInputClassName,
}: Props) {
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value);
    if (Number.isNaN(raw)) return;
    onChange(Math.max(min, Math.min(max, raw)));
  };

  return (
    <div className="flex items-center gap-3">
      {showMinMaxHints ? (
        <span className="w-7 shrink-0 text-center text-[11px] tabular-nums text-text-faint">{min}</span>
      ) : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleSliderChange}
        disabled={disabled}
        className="agx-range-slider flex-1"
        style={{ "--agx-range-percent": `${percent}%` } as CSSProperties}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
      />
      {showNumberInput ? (
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleInputChange}
          disabled={disabled}
          className={
            numberInputClassName ??
            "w-[4.25rem] shrink-0 rounded-md border border-border bg-surface-card px-2 py-1.5 text-center text-xs tabular-nums text-text-primary outline-none transition focus:border-[rgba(var(--theme-color-rgb,16,185,129),0.55)] disabled:opacity-50"
          }
        />
      ) : showMinMaxHints ? (
        <span className="w-7 shrink-0 text-center text-[11px] tabular-nums text-text-faint">{max}</span>
      ) : null}
    </div>
  );
}
