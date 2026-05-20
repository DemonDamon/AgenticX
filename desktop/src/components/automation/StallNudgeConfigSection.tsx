import type { ChangeEvent } from "react";

export type StallNudgeConfig = {
  /** No SSE/tool progress for this many seconds → show stall warning (default 90). */
  stall_detect_silence_seconds: number;
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
  const nudgeBelowDetect =
    value.stall_auto_nudge_enabled &&
    value.stall_auto_nudge_after_seconds < value.stall_detect_silence_seconds;

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">长任务停滞与续跑</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        控制任务进度感叹号、顶部「可能已中断」提示，以及可选的自动续跑。修改后请点击窗口底部「保存」。
      </p>

      <div className="mt-3 space-y-2">
        <div className="rounded-md border border-border bg-surface-panel p-3">
          <div className="text-sm font-medium text-text-primary">停滞警告</div>
          <p className="mt-0.5 text-xs text-text-muted">
            连续无 SSE / 工具进展超过该秒数时，显示「已 Ns 无响应」与中断提示（默认 90 秒）。
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-text-muted">判定阈值（秒）</span>
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={value.stall_detect_silence_seconds}
              disabled={disabled}
              onChange={(e) => set({ stall_detect_silence_seconds: Number(e.target.value) })}
              className="h-4 flex-1 disabled:opacity-50"
            />
            <span className="w-10 text-center text-xs text-text-primary">
              {value.stall_detect_silence_seconds}
            </span>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface-panel p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">自动续跑</span>
                <span
                  className={`shrink-0 rounded-full border px-1.5 text-[10px] ${
                    value.stall_auto_nudge_enabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-surface-card text-text-faint"
                  }`}
                >
                  {value.stall_auto_nudge_enabled ? "已启用" : "未启用"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                已进入停滞警告时自动发送续跑提醒（不显示用户气泡）；支持 running / interrupted /
                通道 C。无人值守模式由下方「无人值守完成任务」与后端 Supervisor 接管。默认关闭。
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

          {nudgeBelowDetect ? (
            <p className="mt-2 text-[11px] text-amber-300/90">
              自动续跑触发时间应不小于停滞警告阈值；保存时将自动抬到{" "}
              {value.stall_detect_silence_seconds} 秒。
            </p>
          ) : null}

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
                className="w-16 rounded-md border border-border bg-surface-card px-2 py-1 text-center text-xs text-text-primary disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
