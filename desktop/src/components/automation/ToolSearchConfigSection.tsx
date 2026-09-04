import { SettingsDropdown } from "../ds/SettingsDropdown";
import { SettingsRangeField } from "../settings/SettingsRangeField";

export const TOOL_SEARCH_THRESHOLD_MIN = 1000;
export const TOOL_SEARCH_THRESHOLD_MAX = 50000;
export const TOOL_SEARCH_THRESHOLD_DEFAULT = 6000;
export const TOOL_SEARCH_RATIO_MIN = 1;
export const TOOL_SEARCH_RATIO_MAX = 25;
export const TOOL_SEARCH_RATIO_DEFAULT = 5;

export type ToolSearchMode = "off" | "auto" | "always";
export type ToolSearchThresholdStrategy = "adaptive" | "manual";

const TOOL_SEARCH_MODE_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "auto", label: "自动（超阈值启用）" },
  { value: "always", label: "始终" },
] as const;

const TOOL_SEARCH_STRATEGY_OPTIONS = [
  { value: "adaptive", label: "自适应（窗口只扩热缓存）" },
  { value: "manual", label: "手动（绝对 token）" },
] as const;

function clampThresholdTokens(windowTokens: number, percent: number): number {
  const raw = Math.round((windowTokens * percent) / 100);
  return Math.max(TOOL_SEARCH_THRESHOLD_MIN, Math.min(TOOL_SEARCH_THRESHOLD_MAX, raw));
}

type ToolSearchConfigSectionProps = {
  mode: ToolSearchMode;
  onModeChange: (value: ToolSearchMode) => void;
  threshold: number;
  onThresholdChange: (value: number) => void;
  thresholdStrategy: ToolSearchThresholdStrategy;
  onThresholdStrategyChange: (value: ToolSearchThresholdStrategy) => void;
  contextBudgetRatioPercent: number;
  onContextBudgetRatioPercentChange: (value: number) => void;
  disabled?: boolean;
};

export function ToolSearchConfigSection({
  mode,
  onModeChange,
  threshold,
  onThresholdChange,
  thresholdStrategy,
  onThresholdStrategyChange,
  contextBudgetRatioPercent,
  onContextBudgetRatioPercentChange,
  disabled,
}: ToolSearchConfigSectionProps) {
  const displayLabel =
    TOOL_SEARCH_MODE_OPTIONS.find((opt) => opt.value === mode)?.label ?? "关闭";
  const strategyLabel =
    TOOL_SEARCH_STRATEGY_OPTIONS.find((opt) => opt.value === thresholdStrategy)?.label ??
    "自适应（窗口只扩热缓存）";
  const example128k = clampThresholdTokens(128_000, contextBudgetRatioPercent);
  const example200k = clampThresholdTokens(200_000, contextBudgetRatioPercent);

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-strong">工具按需加载</div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            首轮仅暴露核心工具；需要更多能力时由模型检索后再加载完整定义，减少上下文占用。关闭时与旧版一致。切换后即时写入本机配置。
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
        <div className="mt-3 space-y-3 rounded-lg bg-surface-panel px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-text-muted">阈值策略</span>
            <SettingsDropdown
              value={thresholdStrategy}
              displayLabel={strategyLabel}
              options={TOOL_SEARCH_STRATEGY_OPTIONS}
              onChange={(next) =>
                onThresholdStrategyChange(next as ToolSearchThresholdStrategy)
              }
              size="compact"
              menuPortal
              disabled={disabled}
              className="w-[12.5rem] shrink-0"
              title="工具按需加载阈值策略"
            />
          </div>

          <div>
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
            <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
              整表 schema 超过该值才启用按需加载。与模型上下文窗口无关。
            </p>
          </div>

          {thresholdStrategy === "adaptive" ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-muted">延迟工具热缓存占窗口（%）</span>
                <span className="text-[11px] tabular-nums text-text-muted">
                  {contextBudgetRatioPercent}%
                </span>
              </div>
              <SettingsRangeField
                min={TOOL_SEARCH_RATIO_MIN}
                max={TOOL_SEARCH_RATIO_MAX}
                step={0.5}
                value={contextBudgetRatioPercent}
                onChange={onContextBudgetRatioPercentChange}
                disabled={disabled}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
                仅限制已加载的延迟工具可占窗口的比例（128k ≈ {example128k}，200k ≈{" "}
                {example200k}，1M 封顶 {TOOL_SEARCH_THRESHOLD_MAX}），不决定是否启用按需加载。
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
