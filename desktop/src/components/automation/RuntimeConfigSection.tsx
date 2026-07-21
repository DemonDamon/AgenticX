import { SettingsRangeField } from "../settings/SettingsRangeField";

export const RUNTIME_MIN_TOOL_ROUNDS = 10;
export const RUNTIME_MAX_TOOL_ROUNDS = 120;
export const RUNTIME_MIN_TASKSPACES = 5;
export const RUNTIME_MAX_TASKSPACES = 100;
export const RUNTIME_DEFAULT_TASKSPACES = 20;
export const TOOL_SEARCH_THRESHOLD_MIN = 1000;
export const TOOL_SEARCH_THRESHOLD_MAX = 50000;
export const TOOL_SEARCH_THRESHOLD_DEFAULT = 6000;
const TOOL_ROUNDS_STEP = 10;
const TASKSPACES_STEP = 1;

export type ToolSearchMode = "off" | "auto" | "always";

type RuntimeConfigSectionProps = {
  maxToolRounds: number;
  onMaxToolRoundsChange: (value: number) => void;
  maxTaskspaces: number;
  onMaxTaskspacesChange: (value: number) => void;
  toolSearchMode: ToolSearchMode;
  onToolSearchModeChange: (value: ToolSearchMode) => void;
  toolSearchThreshold: number;
  onToolSearchThresholdChange: (value: number) => void;
  disabled?: boolean;
};

export function RuntimeConfigSection({
  maxToolRounds,
  onMaxToolRoundsChange,
  maxTaskspaces,
  onMaxTaskspacesChange,
  toolSearchMode,
  onToolSearchModeChange,
  toolSearchThreshold,
  onToolSearchThresholdChange,
  disabled,
}: RuntimeConfigSectionProps) {
  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">运行时参数</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        控制 Agent 单次对话的工具轮数上限，以及每个分身/Meta 可绑定的工作区目录总数（含默认工作区）。
        修改后请点击窗口底部「退出」写入本机配置。
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-faint">
        群聊 @mention 多跳次数（默认 2）可在{" "}
        <code className="rounded bg-surface-panel px-1">~/.agenticx/config.yaml</code>{" "}
        中设置 <code className="rounded bg-surface-panel px-1">group_chat.mention_hops: 2</code>（范围 1-10）。
      </p>

      <div className="mt-4 space-y-3">
        <div className="rounded-lg border border-border bg-surface-panel px-3 py-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-primary">最大工具轮数</span>
            <span className="text-[11px] tabular-nums text-text-muted">
              {maxToolRounds} / {RUNTIME_MAX_TOOL_ROUNDS}
            </span>
          </div>
          <SettingsRangeField
            min={RUNTIME_MIN_TOOL_ROUNDS}
            max={RUNTIME_MAX_TOOL_ROUNDS}
            step={TOOL_ROUNDS_STEP}
            value={maxToolRounds}
            onChange={onMaxToolRoundsChange}
            disabled={disabled}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface-panel px-3 py-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-primary">工作区数量上限</span>
            <span className="text-[11px] tabular-nums text-text-muted">
              {maxTaskspaces} / {RUNTIME_MAX_TASKSPACES}
            </span>
          </div>
          <SettingsRangeField
            min={RUNTIME_MIN_TASKSPACES}
            max={RUNTIME_MAX_TASKSPACES}
            step={TASKSPACES_STEP}
            value={maxTaskspaces}
            onChange={onMaxTaskspacesChange}
            disabled={disabled}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
            含 1 个默认工作区；同一分身或 Meta 下手动添加的目录共享此上限。
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface-panel px-3 py-3">
          <div className="mb-1.5 text-xs font-medium text-text-primary">工具按需加载</div>
          <p className="mb-2.5 text-[11px] leading-relaxed text-text-faint">
            首轮只提供核心工具，需要时通过检索加载更多工具定义，可减少上下文占用。关闭时与旧版行为一致。
          </p>
          <select
            className="w-full rounded-md border border-border bg-surface-card px-2.5 py-1.5 pr-8 text-xs text-text-primary"
            value={toolSearchMode}
            disabled={disabled}
            onChange={(e) => onToolSearchModeChange(e.target.value as ToolSearchMode)}
          >
            <option value="off">关闭</option>
            <option value="auto">自动（超过阈值启用）</option>
            <option value="always">始终</option>
          </select>
          {toolSearchMode === "auto" ? (
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-muted">自动启用阈值（约 token）</span>
                <span className="text-[11px] tabular-nums text-text-muted">
                  {toolSearchThreshold}
                </span>
              </div>
              <SettingsRangeField
                min={TOOL_SEARCH_THRESHOLD_MIN}
                max={TOOL_SEARCH_THRESHOLD_MAX}
                step={500}
                value={toolSearchThreshold}
                onChange={onToolSearchThresholdChange}
                disabled={disabled}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
