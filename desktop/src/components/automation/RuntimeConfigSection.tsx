import { SettingsRangeField } from "../settings/SettingsRangeField";

export const RUNTIME_MIN_TOOL_ROUNDS = 10;
export const RUNTIME_MAX_TOOL_ROUNDS = 120;
const STEP = 10;

type RuntimeConfigSectionProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function RuntimeConfigSection({ value, onChange, disabled }: RuntimeConfigSectionProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">运行时参数</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        Agent 单次对话中可连续调用工具的最大轮数。长任务建议适当提高。修改后请点击窗口底部「退出」写入本机配置。
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-faint">
        群聊 @mention 多跳次数（默认 2）可在{" "}
        <code className="rounded bg-surface-panel px-1">~/.agenticx/config.yaml</code>{" "}
        中设置 <code className="rounded bg-surface-panel px-1">group_chat.mention_hops: 2</code>（范围 1-10）。
      </p>

      <div className="mt-4 rounded-lg border border-border/80 bg-surface-panel px-3 py-3">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-text-primary">最大工具轮数</span>
          <span className="text-[11px] tabular-nums text-text-muted">
            {value} / {RUNTIME_MAX_TOOL_ROUNDS}
          </span>
        </div>
        <SettingsRangeField
          min={RUNTIME_MIN_TOOL_ROUNDS}
          max={RUNTIME_MAX_TOOL_ROUNDS}
          step={STEP}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
