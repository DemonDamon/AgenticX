import type { ChangeEvent } from "react";

export type StallNudgeConfig = {
  stall_auto_nudge_enabled: boolean;
  stall_auto_nudge_after_seconds: number;
  stall_auto_nudge_max_per_session: number;
};

type Props = {
  value: StallNudgeConfig;
  onChange: (value: StallNudgeConfig) => void;
  disabled?: boolean;
};

export function StallNudgeConfigSection({ value, onChange, disabled }: Props) {
  const set = (patch: Partial<StallNudgeConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
            <div className="text-sm font-semibold text-text-strong">长任务自动续跑</div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            检测到任务停滞且后端仍在运行时，自动发送一轮续跑提醒（不显示用户气泡）。默认关闭。
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={value.stall_auto_nudge_enabled}
            disabled={disabled}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              set({ stall_auto_nudge_enabled: e.target.checked })
            }
          />
          启用
        </label>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-text-muted">触发等待（秒）</span>
          <input
            type="range"
            min={60}
            max={300}
            step={10}
            value={value.stall_auto_nudge_after_seconds}
            disabled={disabled || !value.stall_auto_nudge_enabled}
            onChange={(e) => set({ stall_auto_nudge_after_seconds: Number(e.target.value) })}
            className="h-4 flex-1 disabled:opacity-50"
          />
          <span className="w-10 text-center text-xs text-text-primary">
            {value.stall_auto_nudge_after_seconds}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs text-text-muted">每会话最多次数</span>
          <input
            type="number"
            min={1}
            max={5}
            value={value.stall_auto_nudge_max_per_session}
            disabled={disabled || !value.stall_auto_nudge_enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n)) return;
              set({
                stall_auto_nudge_max_per_session: Math.max(1, Math.min(5, Math.round(n))),
              });
            }}
            className="w-16 rounded-md border border-border bg-surface-panel px-2 py-1 text-center text-xs text-text-primary disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
