import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Sparkles, Terminal } from "lucide-react";
import { useAppStore } from "../store";
import {
  BUILTIN_HARNESS_ID,
  normalizePreferredHarnessId,
} from "../utils/preferred-harness";
import { SETTINGS_HINT_CLASS } from "./ds/settings-typography";

/** Catalog entry returned by GET /api/harnesses (studio server). */
export type HarnessCatalogEntry = {
  harness_id: string;
  display_name: string;
  description?: string;
  available: boolean;
  builtin?: boolean;
  capabilities?: Record<string, boolean>;
};

type Props = {
  apiBase: string;
  apiToken: string;
};

/**
 * Settings → General Preferences harness picker.
 *
 * Persists the default coding-agent harness for *new* sessions only.
 * Does not perform mid-session harness switching / context handoff.
 * Unavailable CLIs stay fail-closed (disabled + muted copy).
 *
 * Visual: sits inside the settings Panel card — no nested gray frame.
 * Rows use dividers + soft theme selection (same family as SettingsDropdown).
 */
export function PreferredHarnessPicker({ apiBase, apiToken }: Props) {
  const { t } = useTranslation("settings");
  const preferredHarnessId = useAppStore((s) => s.preferredHarnessId);
  const setPreferredHarnessId = useAppStore((s) => s.setPreferredHarnessId);
  const [catalog, setCatalog] = useState<HarnessCatalogEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const currentHarnessId = normalizePreferredHarnessId(preferredHarnessId);

  const loadCatalog = useCallback(async () => {
    if (!apiBase) return;
    try {
      const resp = await fetch(`${apiBase.replace(/\/$/, "")}/api/harnesses`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { harnesses?: HarnessCatalogEntry[] };
      setCatalog(Array.isArray(body.harnesses) ? body.harnesses : []);
      setLoadError(false);
    } catch {
      setCatalog(null);
      setLoadError(true);
    }
  }, [apiBase, apiToken]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const handleSelect = (entry: HarnessCatalogEntry) => {
    if (!entry.available) return;
    const nextId =
      entry.harness_id === BUILTIN_HARNESS_ID ? null : entry.harness_id;
    setPreferredHarnessId(nextId);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className={SETTINGS_HINT_CLASS}>{t("harness.hint")}</p>

      <div role="listbox" aria-label={t("harness.title")} className="-mx-1">
        {loadError ? (
          <div className={`px-3.5 py-5 text-center ${SETTINGS_HINT_CLASS}`}>
            {t("harness.loadFailed")}
          </div>
        ) : catalog == null ? (
          <div className={`px-3.5 py-5 text-center ${SETTINGS_HINT_CLASS}`}>
            {t("harness.loading")}
          </div>
        ) : catalog.length === 0 ? (
          <div className={`px-3.5 py-5 text-center ${SETTINGS_HINT_CLASS}`}>
            {t("harness.empty")}
          </div>
        ) : (
          catalog.map((entry, index) => {
            const isActive = entry.harness_id === currentHarnessId;
            const disabled = !entry.available;
            const label = entry.builtin
              ? t("harness.builtin")
              : entry.display_name;
            const Icon = entry.builtin ? Terminal : Sparkles;
            return (
              <div key={entry.harness_id}>
                {index > 0 ? (
                  <div
                    className="mx-2 h-px bg-[var(--border-muted)]"
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={disabled}
                  title={
                    disabled
                      ? t("harness.unavailable")
                      : entry.description || label
                  }
                  className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-3 text-left transition-colors focus:outline-none focus-visible:bg-surface-hover ${
                    isActive
                      ? "bg-[rgba(var(--theme-color-rgb,42,79,215),0.08)] ring-1 ring-inset ring-[rgba(var(--theme-color-rgb,42,79,215),0.28)]"
                      : disabled
                        ? "cursor-not-allowed bg-transparent"
                        : "hover:bg-surface-hover"
                  }`}
                  onClick={() => handleSelect(entry)}
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                      isActive
                        ? "border-[rgba(var(--theme-color-rgb,42,79,215),0.35)] bg-[rgba(var(--theme-color-rgb,42,79,215),0.12)] text-[rgb(var(--theme-color-rgb,42,79,215))]"
                        : disabled
                          ? "border-border bg-surface-panel text-text-faint"
                          : "border-border bg-surface-panel text-text-muted"
                    }`}
                    aria-hidden
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  </span>

                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={`truncate text-sm leading-5 ${
                        isActive
                          ? "font-semibold text-text-strong"
                          : disabled
                            ? "font-medium text-text-faint"
                            : "font-medium text-text-strong"
                      }`}
                    >
                      {label}
                    </span>
                    {disabled ? (
                      <span className="text-[12px] leading-relaxed text-text-faint">
                        {t("harness.unavailable")}
                      </span>
                    ) : entry.description ? (
                      <span className="line-clamp-2 text-[12px] leading-relaxed text-text-muted">
                        {entry.description}
                      </span>
                    ) : entry.builtin ? (
                      <span className="text-[12px] leading-relaxed text-text-muted">
                        {t("harness.builtinHint")}
                      </span>
                    ) : null}
                  </span>

                  <span
                    className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      isActive
                        ? "border-[rgb(var(--theme-color-rgb,42,79,215))] bg-[rgb(var(--theme-color-rgb,42,79,215))] text-white"
                        : "border-border bg-transparent"
                    }`}
                    aria-hidden
                  >
                    {isActive ? (
                      <Check className="h-3 w-3" strokeWidth={3} />
                    ) : null}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
