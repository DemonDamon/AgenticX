import type { ChangeEvent } from "react";

export const RUNTIME_MIN_TOOL_ROUNDS = 10;
export const RUNTIME_MAX_TOOL_ROUNDS = 120;
const STEP = 10;

type RuntimeConfigSectionProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function RuntimeConfigSection({ value, onChange, disabled }: RuntimeConfigSectionProps) {
  const handleSliderChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value);
    if (Number.isNaN(raw)) return;
    const clamped = Math.max(
      RUNTIME_MIN_TOOL_ROUNDS,
      Math.min(RUNTIME_MAX_TOOL_ROUNDS, raw),
    );
    onChange(clamped);
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">运行时参数</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        Agent 单次对话中可连续调用工具的最大轮数。长任务建议适当提高。修改后请点击窗口底部「保存」写入本机配置。
      </p>

      <div className="mt-3 flex items-center gap-3">
        <input
          type="range"
          min={RUNTIME_MIN_TOOL_ROUNDS}
          max={RUNTIME_MAX_TOOL_ROUNDS}
          step={STEP}
          value={value}
          onChange={handleSliderChange}
          disabled={disabled}
          className={
            "h-4 flex-1 cursor-pointer appearance-none bg-transparent accent-transparent disabled:opacity-50 " +
            "[&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:rounded-full " +
            "[&::-webkit-slider-runnable-track]:bg-text-muted " +
            "[&::-webkit-slider-thumb]:-mt-[5px] [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 " +
            "[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none " +
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 " +
            "[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm " +
            "[&::-moz-range-track]:h-[2px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-text-muted " +
            "[&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:cursor-pointer " +
            "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 " +
            "[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-sm"
          }
        />
        <input
          type="number"
          min={RUNTIME_MIN_TOOL_ROUNDS}
          max={RUNTIME_MAX_TOOL_ROUNDS}
          step={STEP}
          value={value}
          onChange={handleInputChange}
          disabled={disabled}
          className="w-16 rounded-md border border-border bg-surface-panel px-2 py-1 text-center text-xs text-text-primary disabled:opacity-50"
        />
      </div>
    </div>
  );
}
