import { useMemo } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("workspace");
  const modeOptions = useMemo(
    () => [
      { value: "off" as const, label: t("automation.modeOff") },
      { value: "auto" as const, label: t("automation.modeAuto") },
      { value: "always" as const, label: t("automation.modeAlways") },
    ],
    [t],
  );
  const strategyOptions = useMemo(
    () => [
      { value: "adaptive" as const, label: t("automation.strategyAdaptive") },
      { value: "manual" as const, label: t("automation.strategyManual") },
    ],
    [t],
  );
  const displayLabel =
    modeOptions.find((opt) => opt.value === mode)?.label ?? t("automation.modeOff");
  const strategyLabel =
    strategyOptions.find((opt) => opt.value === thresholdStrategy)?.label ??
    t("automation.strategyAdaptive");
  const example128k = clampThresholdTokens(128_000, contextBudgetRatioPercent);
  const example200k = clampThresholdTokens(200_000, contextBudgetRatioPercent);

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-strong">{t("automation.toolSearchTitle")}</div>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            {t("automation.toolSearchHint")}
          </p>
        </div>
        <SettingsDropdown
          value={mode}
          displayLabel={displayLabel}
          options={modeOptions}
          onChange={(next) => onModeChange(next as ToolSearchMode)}
          size="compact"
          menuPortal
          disabled={disabled}
          className="w-[9.5rem] shrink-0"
          title={t("automation.toolSearchMode")}
        />
      </div>

      {mode === "auto" ? (
        <div className="mt-3 space-y-3 rounded-lg bg-surface-panel px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-text-muted">{t("automation.thresholdStrategy")}</span>
            <SettingsDropdown
              value={thresholdStrategy}
              displayLabel={strategyLabel}
              options={strategyOptions}
              onChange={(next) =>
                onThresholdStrategyChange(next as ToolSearchThresholdStrategy)
              }
              size="compact"
              menuPortal
              disabled={disabled}
              className="w-[12.5rem] shrink-0"
              title={t("automation.thresholdStrategyTitle")}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-text-muted">{t("automation.autoThreshold")}</span>
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
              {t("automation.autoThresholdHint")}
            </p>
          </div>

          {thresholdStrategy === "adaptive" ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-muted">{t("automation.hotCacheRatio")}</span>
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
                {t("automation.hotCacheHint", {
                  example128k,
                  example200k,
                  max: TOOL_SEARCH_THRESHOLD_MAX,
                })}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
