import { useTranslation } from "react-i18next";
import { SettingsRangeField } from "../settings/SettingsRangeField";
import { SettingsSwitch } from "../settings/SettingsSwitch";

export const RUNTIME_MIN_TOOL_ROUNDS = 10;
export const RUNTIME_MAX_TOOL_ROUNDS = 120;
export const RUNTIME_MIN_TASKSPACES = 5;
export const RUNTIME_MAX_TASKSPACES = 100;
export const RUNTIME_DEFAULT_TASKSPACES = 20;
const TOOL_ROUNDS_STEP = 10;
const TASKSPACES_STEP = 1;

type RuntimeConfigSectionProps = {
  maxToolRounds: number;
  onMaxToolRoundsChange: (value: number) => void;
  maxTaskspaces: number;
  onMaxTaskspacesChange: (value: number) => void;
  opsToolsEnabled: boolean;
  onOpsToolsEnabledChange: (value: boolean) => void;
  disabled?: boolean;
};

export function RuntimeConfigSection({
  maxToolRounds,
  onMaxToolRoundsChange,
  maxTaskspaces,
  onMaxTaskspacesChange,
  opsToolsEnabled,
  onOpsToolsEnabledChange,
  disabled,
}: RuntimeConfigSectionProps) {
  const { t } = useTranslation("workspace");
  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">{t("automation.runtimeTitle")}</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        {t("automation.runtimeHint")}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-faint">
        {t("automation.mentionHops")}{" "}
        <code className="rounded bg-surface-panel px-1">~/.agenticx/config.yaml</code>{" "}
        {t("automation.mentionHopsSuffix")}
      </p>

      <div className="mt-4 space-y-3">
        <div className="rounded-lg border border-border bg-surface-panel px-3 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-text-primary">{t("automation.opsTitle")}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
                {t("automation.opsHint")}
              </p>
            </div>
            <SettingsSwitch
              checked={opsToolsEnabled}
              disabled={disabled}
              onChange={onOpsToolsEnabledChange}
              aria-label={t("automation.opsTitle")}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-panel px-3 py-3">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-primary">{t("automation.maxToolRounds")}</span>
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
            <span className="text-xs font-medium text-text-primary">{t("automation.maxWorkspaces")}</span>
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
            {t("automation.maxWorkspacesHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
