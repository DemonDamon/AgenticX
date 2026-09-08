import { useCallback, useEffect, useState } from "react";
import { i18n } from "../../i18n/i18n";

export type TrinityConfigForm = {
  skill_protocol: boolean;
  session_summary: boolean;
  learning_enabled: boolean;
  skill_manage_enabled: boolean;
  learning_nudge_interval: number;
  learning_min_tool_calls: number;
};

const TRINITY_DEFAULTS: TrinityConfigForm = {
  skill_protocol: true,
  session_summary: false,
  learning_enabled: false,
  skill_manage_enabled: false,
  learning_nudge_interval: 10,
  learning_min_tool_calls: 5,
};

/** Keys mirrored into agx serve env at startup — toggling requires app restart. */
const TRINITY_RESTART_ENV_KEYS = new Set<keyof TrinityConfigForm>([
  "skill_protocol",
  "session_summary",
  "learning_enabled",
  "skill_manage_enabled",
  "learning_nudge_interval",
  "learning_min_tool_calls",
]);

async function promptNearRestartAfterTrinitySave(
  patch: Partial<TrinityConfigForm>,
): Promise<boolean> {
  const touched = (Object.keys(patch) as (keyof TrinityConfigForm)[]).some((key) =>
    TRINITY_RESTART_ENV_KEYS.has(key),
  );
  if (!touched || typeof window === "undefined" || !window.agenticxDesktop?.confirmDialog) {
    return false;
  }

  let message: string;
  if ("skill_manage_enabled" in patch) {
    message = patch.skill_manage_enabled
      ? String(i18n.t("commonSettings.trinitySkillManageOn", { ns: "settings" }))
      : String(i18n.t("commonSettings.trinitySkillManageOff", { ns: "settings" }));
  } else {
    message = String(i18n.t("commonSettings.trinitySaved", { ns: "settings" }));
  }

  const restartDlg = await window.agenticxDesktop.confirmDialog({
    title: String(i18n.t("commonSettings.needRestartTitle", { ns: "settings" })),
    message,
    detail: String(i18n.t("commonSettings.trinityRestartDetail", { ns: "settings" })),
    confirmText: String(i18n.t("commonSettings.restartNow", { ns: "settings" })),
    cancelText: String(i18n.t("commonSettings.restartLater", { ns: "settings" })),
  });
  if (restartDlg.confirmed && window.agenticxDesktop.appRelaunch) {
    await window.agenticxDesktop.appRelaunch();
    return true;
  }
  return false;
}

export function useTrinityConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TrinityConfigForm>({ ...TRINITY_DEFAULTS });
  const [message, setMessage] = useState("");
  const [lastSaved, setLastSaved] = useState<TrinityConfigForm>({ ...TRINITY_DEFAULTS });

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadTrinityConfig();
        if (!disposed && result?.ok && result.config) {
          const loaded: TrinityConfigForm = {
            skill_protocol: Boolean(result.config.skill_protocol),
            session_summary: Boolean(result.config.session_summary),
            learning_enabled: Boolean(result.config.learning_enabled),
            skill_manage_enabled: Boolean(result.config.skill_manage_enabled),
            learning_nudge_interval:
              Number(result.config.learning_nudge_interval) > 0
                ? Number(result.config.learning_nudge_interval)
                : TRINITY_DEFAULTS.learning_nudge_interval,
            learning_min_tool_calls:
              Number(result.config.learning_min_tool_calls) > 0
                ? Number(result.config.learning_min_tool_calls)
                : TRINITY_DEFAULTS.learning_min_tool_calls,
          };
          setForm(loaded);
          setLastSaved(loaded);
        } else if (!disposed) {
          setMessage(result?.error ? String(result.error) : String(i18n.t("commonSettings.loadConfigFailed", { ns: "settings" })));
        }
      } catch {
        if (!disposed) setMessage(String(i18n.t("commonSettings.loadConfigFailed", { ns: "settings" })));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => { disposed = true; };
  }, []);

  const update = useCallback(async (patch: Partial<TrinityConfigForm>) => {
    const next = { ...form, ...patch };
    setForm(next);
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveTrinityConfig(next);
      if (!result?.ok) {
        setForm(lastSaved);
        setMessage(result?.error ? String(result.error) : String(i18n.t("commonSettings.saveFailed", { ns: "settings" })));
        return;
      }
      setLastSaved(next);
      const relaunched = await promptNearRestartAfterTrinitySave(patch);
      if (!relaunched) {
        setMessage(String(i18n.t("commonSettings.trinitySavedInline", { ns: "settings" })));
      }
    } catch (e) {
      setForm(lastSaved);
      setMessage(e instanceof Error ? e.message : String(i18n.t("commonSettings.saveFailed", { ns: "settings" })));
    } finally {
      setSaving(false);
    }
  }, [form, lastSaved]);

  return { loading, saving, form, message, update };
}
