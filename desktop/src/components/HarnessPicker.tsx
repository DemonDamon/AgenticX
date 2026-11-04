import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useAppStore } from "../store";
import {
  BUILTIN_HARNESS_ID,
  normalizePreferredHarnessId,
} from "../utils/preferred-harness";

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
 * Unavailable CLIs stay fail-closed (gray + disabled).
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
    <div className="flex flex-col gap-2">
      <div className="text-xs text-text-muted">{t("harness.hint")}</div>
      <div
        role="listbox"
        aria-label={t("harness.title")}
        className="rounded-xl border border-[var(--border-muted)] bg-surface-card p-1.5"
      >
        {loadError ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">
            {t("harness.loadFailed")}
          </div>
        ) : catalog == null ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">
            {t("harness.loading")}
          </div>
        ) : catalog.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">
            {t("harness.empty")}
          </div>
        ) : (
          catalog.map((entry) => {
            const isActive = entry.harness_id === currentHarnessId;
            const disabled = !entry.available;
            return (
              <button
                key={entry.harness_id}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={disabled}
                title={
                  disabled
                    ? t("harness.unavailable")
                    : entry.description || entry.display_name
                }
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] leading-5 transition-colors ${
                  isActive
                    ? "bg-surface-cardStrong"
                    : disabled
                      ? "cursor-not-allowed opacity-45"
                      : "hover:bg-surface-hover"
                }`}
                onClick={() => handleSelect(entry)}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    disabled ? "bg-zinc-600" : "bg-emerald-500"
                  }`}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={`truncate ${isActive ? "font-semibold text-text-strong" : "text-text-standard"}`}
                  >
                    {entry.builtin ? t("harness.builtin") : entry.display_name}
                  </span>
                  {disabled ? (
                    <span className="truncate text-[11px] font-normal text-text-faint">
                      {t("harness.unavailable")}
                    </span>
                  ) : null}
                </span>
                {isActive ? (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

