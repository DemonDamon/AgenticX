import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { SettingsRangeField } from "../settings/SettingsRangeField";

export type StallNudgeConfig = {
  /** No SSE/tool progress for this many seconds → show stall warning (default 90). */
  stall_detect_silence_seconds: number;
  stall_auto_nudge_enabled: boolean;
  stall_auto_nudge_after_seconds: number;
  stall_auto_nudge_max_per_session: number;
  /** LLM round-timeout patience mode: wait + auto retry instead of dying. */
  llm_stall_patience_enabled: boolean;
  llm_stall_patience_max_attempts: number;
  llm_stall_patience_budget_seconds: number;
};

type Props = {
  value: StallNudgeConfig;
  onChange: (value: StallNudgeConfig) => void;
  disabled?: boolean;
};

export function StallNudgeConfigSection({ value, onChange, disabled }: Props) {
  const { t } = useTranslation("workspace");
  const set = (patch: Partial<StallNudgeConfig>) => onChange({ ...value, ...patch });
  const nudgeBelowDetect =
    value.stall_auto_nudge_enabled &&
    value.stall_auto_nudge_after_seconds < value.stall_detect_silence_seconds;

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">{t("automation.stallTitle")}</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        {t("automation.stallHint")}
      </p>

      <div className="mt-3 space-y-2">
        <div className="rounded-md border border-border bg-surface-panel p-3">
          <div className="text-sm font-medium text-text-primary">{t("automation.stallWarn")}</div>
          <p className="mt-0.5 text-xs text-text-muted">
            {t("automation.stallWarnHint")}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs text-text-muted">{t("automation.detectSeconds")}</span>
            <div className="min-w-0 flex-1">
              <SettingsRangeField
                min={30}
                max={300}
                step={10}
                value={value.stall_detect_silence_seconds}
                onChange={(v) => set({ stall_detect_silence_seconds: v })}
                disabled={disabled}
                showNumberInput={false}
                showMinMaxHints={false}
              />
            </div>
            <span className="w-10 text-center text-xs text-text-primary">
              {value.stall_detect_silence_seconds}
            </span>
          </div>
        </div>

        <div className="rounded-md border border-border bg-surface-panel p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{t("automation.autoNudge")}</span>
                <span
                  className={`shrink-0 rounded-full border px-1.5 text-[10px] ${
                    value.stall_auto_nudge_enabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-surface-card text-text-faint"
                  }`}
                >
                  {value.stall_auto_nudge_enabled ? t("automation.enabled") : t("automation.disabled")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {t("automation.autoNudgeHint")}
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
              {t("automation.enable")}
            </label>
          </div>

          {nudgeBelowDetect ? (
            <p className="mt-2 text-[11px] text-amber-300/90">
              {t("automation.nudgeBelow", { seconds: value.stall_detect_silence_seconds })}
            </p>
          ) : null}

          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-text-muted">{t("automation.triggerWait")}</span>
              <div className="min-w-0 flex-1">
                <SettingsRangeField
                  min={60}
                  max={300}
                  step={10}
                  value={value.stall_auto_nudge_after_seconds}
                  onChange={(v) => set({ stall_auto_nudge_after_seconds: v })}
                  disabled={disabled || !value.stall_auto_nudge_enabled}
                  showNumberInput={false}
                  showMinMaxHints={false}
                />
              </div>
              <span className="w-10 text-center text-xs text-text-primary">
                {value.stall_auto_nudge_after_seconds}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-text-muted">{t("automation.maxPerSession")}</span>
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

        <div className="rounded-md border border-border bg-surface-panel p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{t("automation.llmPatience")}</span>
                <span
                  className={`shrink-0 rounded-full border px-1.5 text-[10px] ${
                    value.llm_stall_patience_enabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-border bg-surface-card text-text-faint"
                  }`}
                >
                  {value.llm_stall_patience_enabled ? t("automation.enabled") : t("automation.disabled")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {t("automation.llmPatienceHint")}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={value.llm_stall_patience_enabled}
                disabled={disabled}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  set({ llm_stall_patience_enabled: e.target.checked })
                }
              />
              {t("automation.enable")}
            </label>
          </div>

          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-text-muted">{t("automation.retryCount")}</span>
              <input
                type="number"
                min={1}
                max={10}
                value={value.llm_stall_patience_max_attempts}
                disabled={disabled || !value.llm_stall_patience_enabled}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  set({
                    llm_stall_patience_max_attempts: Math.max(1, Math.min(10, Math.round(n))),
                  });
                }}
                className="w-16 rounded-md border border-border bg-surface-card px-2 py-1 text-center text-xs text-text-primary disabled:opacity-50"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-text-muted">{t("automation.waitBudget")}</span>
              <input
                type="number"
                min={60}
                max={3600}
                step={60}
                value={value.llm_stall_patience_budget_seconds}
                disabled={disabled || !value.llm_stall_patience_enabled}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  set({
                    llm_stall_patience_budget_seconds: Math.max(60, Math.min(3600, Math.round(n))),
                  });
                }}
                className="w-20 rounded-md border border-border bg-surface-card px-2 py-1 text-center text-xs text-text-primary disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
