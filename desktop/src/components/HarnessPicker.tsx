import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import {
  BUILTIN_HARNESS_ID,
  normalizePreferredHarnessId,
  toStoredPreferredHarnessId,
} from "../utils/preferred-harness";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "./ds/settings-typography";
import { SettingsDropdown, type SettingsDropdownOption } from "./ds/SettingsDropdown";

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
 * Settings → General Preferences harness enum (compact SettingsDropdown).
 *
 * Same row layout as language / appearance. Persists the global default.
 * Existing sessions follow it on their next user turn (no immediate
 * switch from this picker). Unavailable CLIs stay in the menu as
 * disabled options (fail-closed).
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

  const options: SettingsDropdownOption[] = useMemo(() => {
    if (!catalog) return [];
    return catalog.map((entry) => {
      const name = entry.builtin ? t("harness.builtin") : entry.display_name;
      if (entry.available) {
        return { value: entry.harness_id, label: name };
      }
      return {
        value: entry.harness_id,
        label: t("harness.unavailableOption", { name }),
        disabled: true,
      };
    });
  }, [catalog, t]);

  const displayLabel = useMemo(() => {
    if (loadError) return t("harness.loadFailed");
    if (catalog == null) return t("harness.loading");
    if (options.length === 0) return t("harness.empty");
    const hit = options.find((opt) => opt.value === currentHarnessId);
    if (hit) {
      // Trigger shows clean name even when option label includes unavailable suffix.
      const entry = catalog.find((h) => h.harness_id === currentHarnessId);
      if (entry?.builtin) return t("harness.builtin");
      if (entry) return entry.display_name;
      return hit.label;
    }
    return t("harness.builtin");
  }, [catalog, currentHarnessId, loadError, options, t]);

  const handleChange = (next: string) => {
    const entry = catalog?.find((h) => h.harness_id === next);
    if (!entry || !entry.available) return;
    setPreferredHarnessId(toStoredPreferredHarnessId(next));
  };

  return (
    <div className="flex min-h-14 items-center justify-between gap-6 py-1">
      <div className="min-w-0">
        <div className={SETTINGS_LABEL_CLASS}>{t("harness.title")}</div>
        <div className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>{t("harness.hint")}</div>
      </div>
      <SettingsDropdown
        value={currentHarnessId}
        displayLabel={displayLabel}
        options={options}
        onChange={handleChange}
        className="w-52 shrink-0"
        size="compact"
        menuPortal
        disabled={loadError || catalog == null || options.length === 0}
        title={t("harness.title")}
      />
    </div>
  );
}
