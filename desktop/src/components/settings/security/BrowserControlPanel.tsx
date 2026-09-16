import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "../../ds/Panel";
import { SETTINGS_INTRO_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsSwitch } from "../SettingsSwitch";

/** WorkPanel 内嵌浏览器由 Agent 驱动的开关。 */
export function BrowserControlPanel() {
  const { t } = useTranslation("settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadBrowserControlConfig();
        if (!disposed && result?.ok && result.config) {
          setEnabled(Boolean(result.config.enabled));
        }
      } catch {
        if (!disposed) setMessage(t("security.browserControlLoadFailed"));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [t]);

  const persist = async (next: boolean) => {
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveBrowserControlConfig({ enabled: next });
      if (!result?.ok) {
        const detail = result?.error ? String(result.error) : t("security.browserControlSaveFailed");
        setMessage(detail);
        setEnabled(!next);
        return;
      }
      setEnabled(next);
      setMessage(t("security.browserControlSaved"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("security.browserControlSaveFailed"));
      setEnabled(!next);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Panel title={t("security.browserControlTitle")}>
        <div className="py-2 text-sm text-text-faint">{t("security.loading")}</div>
      </Panel>
    );
  }

  return (
    <Panel title={t("security.browserControlTitle")}>
      <p className={`mb-3 ${SETTINGS_INTRO_CLASS}`}>
        {t("security.browserControlIntro")}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className={SETTINGS_LABEL_CLASS}>
          {t("security.enableBrowserControl")}
        </span>
        <SettingsSwitch
          checked={enabled}
          disabled={saving}
          onChange={(next) => void persist(next)}
          aria-label={t("security.enableBrowserControlAria")}
        />
      </div>
      {message ? (
        <div
          className={`mt-2 text-xs ${message === t("security.browserControlSaved") ? "text-text-muted" : "text-rose-400"}`}
        >
          {message}
        </div>
      ) : null}
    </Panel>
  );
}
