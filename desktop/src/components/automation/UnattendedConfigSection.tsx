import type { ChangeEvent } from "react";

export type UnattendedConfig = {
  unattended_enabled: boolean;
  unattended_max_continuations_per_session: number;
  unattended_max_wall_clock_hours: number;
  unattended_stall_continue_after_seconds: number;
  unattended_auto_resume_exhausted: boolean;
  unattended_auto_resume_interrupted: boolean;
};

type Props = {
  value: UnattendedConfig;
  onChange: (value: UnattendedConfig) => void;
  disabled?: boolean;
};

export function UnattendedConfigSection({ value, onChange, disabled }: Props) {
  const set = (patch: Partial<UnattendedConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">无人值守完成任务</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        全局开关开启后，可在会话中单独启用无人值守；Supervisor 在后台续跑（关窗后仍有效）。
        仅对当前会话生效，不会替你回答新问题。与上方「自动续跑」配合：前者为前端在线 nudge，本项由后端接管。
      </p>

      <div className="mt-3 rounded-md border border-border bg-surface-panel p-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text-primary">启用无人值守（全局）</span>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-border"
            checked={value.unattended_enabled}
            disabled={disabled}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              set({ unattended_enabled: e.target.checked })
            }
          />
        </label>

        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-xs text-text-muted">每会话最多续跑</span>
            <input
              type="number"
              min={1}
              max={100}
              disabled={disabled || !value.unattended_enabled}
              value={value.unattended_max_continuations_per_session}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                set({
                  unattended_max_continuations_per_session: Math.max(1, Math.min(100, Math.round(n))),
                });
              }}
              className="w-20 rounded-md border border-border bg-surface-card px-2 py-1 text-center text-xs"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-36 shrink-0 text-xs text-text-muted">最长运行（小时）</span>
            <input
              type="number"
              min={1}
              max={48}
              step={0.5}
              disabled={disabled || !value.unattended_enabled}
              value={value.unattended_max_wall_clock_hours}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                set({
                  unattended_max_wall_clock_hours: Math.max(0.5, Math.min(48, n)),
                });
              }}
              className="w-20 rounded-md border border-border bg-surface-card px-2 py-1 text-center text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              disabled={disabled || !value.unattended_enabled}
              checked={value.unattended_auto_resume_interrupted}
              onChange={(e) => set({ unattended_auto_resume_interrupted: e.target.checked })}
            />
            中断后自动续跑
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              disabled={disabled || !value.unattended_enabled}
              checked={value.unattended_auto_resume_exhausted}
              onChange={(e) => set({ unattended_auto_resume_exhausted: e.target.checked })}
            />
            工具轮次耗尽后自动续跑
          </label>
        </div>
      </div>
    </div>
  );
}
