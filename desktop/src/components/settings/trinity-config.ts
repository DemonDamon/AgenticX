import { useCallback, useEffect, useState } from "react";

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
      ? "「允许助手改本地技能」已开启。需完全退出 Near（⌘Q）后重新打开，模型才能调用 skill_manage 修改 ~/.agenticx/skills/ 下的技能。"
      : "「允许助手改本地技能」已关闭。需重启 Near 后，后端才会禁止 skill_manage。";
  } else {
    message =
      "智能体三件套设置已保存。需完全退出 Near（⌘Q）后重新打开，内置助手才会加载新配置。";
  }

  const restartDlg = await window.agenticxDesktop.confirmDialog({
    title: "需要重启 Near",
    message,
    detail:
      "内置 agx serve 仅在启动时注入相关环境变量；不重启则当前对话里 skill_manage 等能力仍按旧设置运行。",
    confirmText: "立即重启",
    cancelText: "稍后手动重启",
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
          setMessage(result?.error ? String(result.error) : "读取配置失败。");
        }
      } catch {
        if (!disposed) setMessage("读取配置失败。");
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
        setMessage(result?.error ? String(result.error) : "保存失败。");
        return;
      }
      setLastSaved(next);
      const relaunched = await promptNearRestartAfterTrinitySave(patch);
      if (!relaunched) {
        setMessage("已保存。完全退出 Near（⌘Q）后重新打开生效。");
      }
    } catch (e) {
      setForm(lastSaved);
      setMessage(e instanceof Error ? e.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }, [form, lastSaved]);

  return { loading, saving, form, message, update };
}
