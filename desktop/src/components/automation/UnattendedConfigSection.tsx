import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation("workspace");
  const set = (patch: Partial<UnattendedConfig>) => onChange({ ...value, ...patch });

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">{t("automation.unattendedTitle")}</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        {t("automation.unattendedHint")}
      </p>

      <div className="mt-3 rounded-md border border-border bg-surface-panel p-3">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-text-primary">{t("automation.unattendedEnable")}</span>
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
            <span className="w-36 shrink-0 text-xs text-text-muted">{t("automation.maxContinuations")}</span>
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
            <span className="w-36 shrink-0 text-xs text-text-muted">{t("automation.maxHours")}</span>
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
            {t("automation.resumeInterrupted")}
          </label>
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              disabled={disabled || !value.unattended_enabled}
              checked={value.unattended_auto_resume_exhausted}
              onChange={(e) => set({ unattended_auto_resume_exhausted: e.target.checked })}
            />
            {t("automation.resumeExhausted")}
          </label>
        </div>
      </div>
    </div>
  );
}
