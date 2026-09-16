import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "../../ds/Panel";
import { SETTINGS_INTRO_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsSwitch } from "../SettingsSwitch";

/** 桌面操控开关。 */
export function ComputerUsePanel() {
  const { t } = useTranslation("settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadComputerUseConfig();
        if (!disposed && result?.ok && result.config) {
          setEnabled(Boolean(result.config.enabled));
        }
      } catch {
        if (!disposed) setMessage(t("security.computerUseLoadFailed"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const persist = async (next: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveComputerUseConfig({ enabled: next });
      if (!result?.ok) {
        const detail = result?.error ? String(result.error) : t("security.computerUseSaveFailed");
        setMessage(detail);
        setEnabled(!next);
        return;
      }
      setEnabled(next);
      setMessage(t("security.computerUseSaved"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("security.computerUseSaveFailed"));
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Panel title={t("security.computerUseTitle")}>
        <div className="py-2 text-sm text-text-faint">{t("security.loading")}</div>
      </Panel>
    );
  }

  return (
    <Panel title={t("security.computerUseTitle")}>
      <p className={`mb-3 ${SETTINGS_INTRO_CLASS}`}>
        {t("security.computerUseIntro")}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className={SETTINGS_LABEL_CLASS}>
          {t("security.enableComputerUse")}
        </span>
        <SettingsSwitch
          checked={enabled}
          disabled={saving}
          onChange={(next) => void persist(next)}
          aria-label={t("security.enableComputerUseAria")}
        />
      </div>
      {message ? (
        <div
          className={`mt-2 text-xs ${message === t("security.computerUseSaved") ? "text-text-muted" : "text-rose-400"}`}
        >
          {message}
        </div>
      ) : null}
    </Panel>
  );
}
