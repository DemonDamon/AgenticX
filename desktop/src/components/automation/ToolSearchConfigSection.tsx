import { SettingsDropdown } from "../ds/SettingsDropdown";
import { SettingsRangeField } from "../settings/SettingsRangeField";

export const TOOL_SEARCH_THRESHOLD_MIN = 1000;
export const TOOL_SEARCH_THRESHOLD_MAX = 50000;
export const TOOL_SEARCH_THRESHOLD_DEFAULT = 6000;

export type ToolSearchMode = "off" | "auto" | "always";

const TOOL_SEARCH_MODE_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "auto", label: "自动（超阈值启用）" },
  { value: "always", label: "始终" },
] as const;

type ToolSearchConfigSectionProps = {
  mode: ToolSearchMode;
  onModeChange: (value: ToolSearchMode) => void;
  threshold: number;
  onThresholdChange: (value: number) => void;
  disabled?: boolean;
};

export function ToolSearchConfigSection({
  mode,
  onModeChange,
  threshold,
  onThresholdChange,
  disabled,
}: ToolSearchConfigSectionProps) {
  const displayLabel =
    TOOL_SEARCH_MODE_OPTIONS.find((opt) => opt.value === mode)?.label ?? "关闭";

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-strong">工具按需加载</div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            首轮仅暴露核心工具；需要更多能力时由模型检索后再加载完整定义，减少上下文占用。关闭时与旧版一致。
          </p>
        </div>
        <SettingsDropdown
          value={mode}
          displayLabel={displayLabel}
          options={TOOL_SEARCH_MODE_OPTIONS}
          onChange={(next) => onModeChange(next as ToolSearchMode)}
          size="compact"
          menuPortal
          disabled={disabled}
          className="w-[9.5rem] shrink-0"
          title="工具按需加载模式"
        />
      </div>

      {mode === "auto" ? (
        <div className="mt-3 rounded-lg bg-surface-panel px-3 py-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-muted">自动启用阈值（约 token）</span>
            <span className="text-[11px] tabular-nums text-text-muted">{threshold}</span>
          </div>
          <SettingsRangeField
            min={TOOL_SEARCH_THRESHOLD_MIN}
            max={TOOL_SEARCH_THRESHOLD_MAX}
            step={500}
            value={threshold}
            onChange={onThresholdChange}
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  );
}
