import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "../../ds/Panel";
import {
  emptyGatewayAdapterForm,
  type GatewayAdapterForm,
} from "../../../../electron/gateway-adapter-config";

export function GatewayAdaptersPanel() {
  const { t } = useTranslation("settings");
  const [form, setForm] = useState<GatewayAdapterForm>(emptyGatewayAdapterForm());
  const [hint, setHint] = useState("");

  useEffect(() => {
    void window.agenticxDesktop.loadGatewayAdapters().then((loaded) => {
      setForm(loaded);
    });
  }, []);

  async function save() {
    await window.agenticxDesktop.saveGatewayAdapters(form);
    setHint(t("server.restartGateway"));
  }

  return (
    <Panel title={t("server.channelBots")}>
      <p className="mb-3 text-xs text-text-faint">{t("server.restartGateway")}</p>
      <label className="mb-3 flex items-center gap-2 text-sm text-text-subtle">
        <input
          type="checkbox"
          checked={form.dingtalk.enabled}
          onChange={(e) =>
            setForm({ ...form, dingtalk: { ...form.dingtalk, enabled: e.target.checked } })
          }
        />
        {t("server.dingtalkEnable")}
      </label>
      <input
        className="mb-4 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
        type="password"
        value={form.dingtalk.appSecret}
        placeholder={t("server.appSecret")}
        onChange={(e) =>
          setForm({ ...form, dingtalk: { ...form.dingtalk, appSecret: e.target.value } })
        }
      />
      <p className="mb-4 font-mono text-xs text-text-faint">/webhook/dingtalk</p>

      <label className="mb-3 flex items-center gap-2 text-sm text-text-subtle">
        <input
          type="checkbox"
          checked={form.slack.enabled}
          onChange={(e) => setForm({ ...form, slack: { ...form.slack, enabled: e.target.checked } })}
        />
        Slack
      </label>
      <input
        className="mb-2 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
        type="password"
        value={form.slack.botToken}
        placeholder="Bot Token"
        onChange={(e) => setForm({ ...form, slack: { ...form.slack, botToken: e.target.value } })}
      />
      <input
        className="mb-4 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
        type="password"
        value={form.slack.signingSecret}
        placeholder={t("server.signingSecret")}
        onChange={(e) =>
          setForm({ ...form, slack: { ...form.slack, signingSecret: e.target.value } })
        }
      />

      <label className="mb-3 flex items-center gap-2 text-sm text-text-subtle">
        <input
          type="checkbox"
          checked={form.telegram.enabled}
          onChange={(e) =>
            setForm({ ...form, telegram: { ...form.telegram, enabled: e.target.checked } })
          }
        />
        Telegram
      </label>
      <input
        className="mb-2 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
        type="password"
        value={form.telegram.botToken}
        placeholder="Bot Token"
        onChange={(e) =>
          setForm({ ...form, telegram: { ...form.telegram, botToken: e.target.value } })
        }
      />
      <input
        className="mb-4 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
        type="password"
        value={form.telegram.webhookSecret}
        placeholder={t("server.webhookSecret")}
        onChange={(e) =>
          setForm({ ...form, telegram: { ...form.telegram, webhookSecret: e.target.value } })
        }
      />

      <label className="mb-3 flex items-center gap-2 text-sm text-text-subtle">
        <input
          type="checkbox"
          checked={form.qqbot.enabled}
          onChange={(e) => setForm({ ...form, qqbot: { ...form.qqbot, enabled: e.target.checked } })}
        />
        {t("server.qqBot")}
      </label>
      <input
        className="mb-2 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
        value={form.qqbot.appId}
        placeholder="App ID"
        onChange={(e) => setForm({ ...form, qqbot: { ...form.qqbot, appId: e.target.value } })}
      />
      <input
        className="mb-2 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm"
        type="password"
        value={form.qqbot.appSecret}
        placeholder={t("server.appSecret")}
        onChange={(e) => setForm({ ...form, qqbot: { ...form.qqbot, appSecret: e.target.value } })}
      />
      <p className="mb-4 text-xs text-text-faint">{t("server.qqReceiveOnly")}</p>
      <button
        type="button"
        className="rounded-md bg-btnPrimary px-3 py-1.5 text-sm font-medium text-btnPrimary-text"
        onClick={() => void save()}
      >
        {t("server.saveChannels")}
      </button>
      {hint ? <p className="mt-2 text-xs text-text-muted">{hint}</p> : null}
    </Panel>
  );
}
