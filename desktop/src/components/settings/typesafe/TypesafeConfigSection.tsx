import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { Panel } from "../../ds/Panel";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsSwitch } from "../SettingsSwitch";
import { KB_FIELD_BASE } from "../knowledge/kb-field-classes";
import { rememberTypesafeSettings } from "../../../hooks/useTypesafeSettings";
import {
  DEFAULT_TYPESAFE_PUBLIC_SETTINGS,
  parseTypesafePublicSettings,
  type TypesafePublicSettings,
} from "../../../utils/typesafe-settings";

const PRIMARY_BTN =
  "inline-flex items-center rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1.5 text-xs font-medium text-[var(--ui-btn-primary-text)] transition hover:bg-[var(--ui-btn-primary-hover)] disabled:opacity-40";
const GHOST_BTN =
  "inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-subtle transition hover:bg-surface-hover hover:text-text-primary disabled:opacity-40";

function authHeaders(apiToken: string): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiToken) headers["x-agx-desktop-token"] = apiToken;
  return headers;
}

export function TypesafeConfigSection() {
  const { t } = useTranslation("workspace");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const [draft, setDraft] = useState<TypesafePublicSettings>(DEFAULT_TYPESAFE_PUBLIC_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [patching, setPatching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [testModel, setTestModel] = useState("");
  const [error, setError] = useState("");
  const [keyMessage, setKeyMessage] = useState("");

  const resolveBase = useCallback(async () => {
    const fromStore = String(apiBase ?? "").trim().replace(/\/+$/, "");
    if (fromStore) return fromStore;
    const raw = String((await window.agenticxDesktop.getApiBase()) || "").trim();
    return raw.replace(/\/+$/, "");
  }, [apiBase]);

  const applyPublic = useCallback((next: TypesafePublicSettings) => {
    setDraft(next);
    rememberTypesafeSettings(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const base = await resolveBase();
        if (!base) return;
        const resp = await fetch(`${base}/api/typesafe/settings`, { headers: authHeaders(apiToken) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const next = parseTypesafePublicSettings(await resp.json());
        if (!cancelled) applyPublic(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("typesafe.saveFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [apiToken, applyPublic, resolveBase, t]);

  const patchSettings = async (partial: Record<string, unknown>) => {
    setPatching(true);
    setError("");
    try {
      const base = await resolveBase();
      const resp = await fetch(`${base}/api/typesafe/settings`, {
        method: "PUT",
        headers: authHeaders(apiToken),
        body: JSON.stringify(partial),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      const next = parseTypesafePublicSettings(JSON.parse(text || "{}"));
      applyPublic(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("typesafe.saveFailed"));
    } finally {
      setPatching(false);
    }
  };

  const saveKey = async () => {
    setSavingKey(true);
    setError("");
    setKeyMessage("");
    try {
      const base = await resolveBase();
      const resp = await fetch(`${base}/api/typesafe/settings`, {
        method: "PUT",
        headers: authHeaders(apiToken),
        body: JSON.stringify({ api_key: apiKey }),
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      const next = parseTypesafePublicSettings(JSON.parse(text || "{}"));
      applyPublic(next);
      setApiKey("");
      setKeyMessage(apiKey.trim() ? t("typesafe.keySaved") : t("typesafe.keyCleared"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("typesafe.saveFailed"));
    } finally {
      setSavingKey(false);
    }
  };

  const testConnectivity = async () => {
    setTesting(true);
    setTestOk(null);
    setTestModel("");
    setError("");
    try {
      const base = await resolveBase();
      const resp = await fetch(`${base}/api/typesafe/test`, {
        method: "POST",
        headers: authHeaders(apiToken),
      });
      const body = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        model?: string;
        error?: string;
      };
      if (!resp.ok || body.ok !== true) {
        setTestOk(false);
        setError(String(body.error || `HTTP ${resp.status}`));
        return;
      }
      setTestOk(true);
      setTestModel(String(body.model || draft.model));
    } catch (e) {
      setTestOk(false);
      setError(e instanceof Error ? e.message : t("typesafe.testFailed"));
    } finally {
      setTesting(false);
    }
  };

  const toggle = (key: keyof TypesafePublicSettings, next: boolean) => {
    setDraft((prev) => ({ ...prev, [key]: next }));
    void patchSettings({ [key]: next });
  };

  return (
    <Panel title={t("typesafe.title")}>
      <p className={`${SETTINGS_HINT_CLASS} mb-3`}>{t("typesafe.hint")}</p>
      <label className={`${SETTINGS_LABEL_CLASS} mb-1 block`}>{t("typesafe.apiKey")}</label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          className={`min-w-[220px] flex-1 ${KB_FIELD_BASE}`}
          value={apiKey}
          placeholder={draft.has_key ? t("typesafe.hasKey") : t("typesafe.apiKeyPlaceholder")}
          onChange={(e) => setApiKey(e.target.value)}
          disabled={loading}
        />
        <button type="button" className={GHOST_BTN} disabled={testing || loading} onClick={() => void testConnectivity()}>
          {testing ? t("typesafe.testing") : t("typesafe.test")}
        </button>
        <button type="button" className={PRIMARY_BTN} disabled={savingKey || loading} onClick={() => void saveKey()}>
          {t("typesafe.saveKey")}
        </button>
      </div>
      {testOk === true ? (
        <div className="mt-1 text-xs text-emerald-500">{t("typesafe.connected", { model: testModel || draft.model })}</div>
      ) : null}
      {keyMessage ? <div className="mt-1 text-xs text-text-faint">{keyMessage}</div> : null}
      {error ? <div className="mt-1 text-xs text-rose-400">{error}</div> : null}

      <div className="mt-4 space-y-3">
        <SwitchRow
          label={t("typesafe.enabled")}
          checked={draft.enabled}
          disabled={loading || patching}
          onChange={(v) => toggle("enabled", v)}
        />
        <SwitchRow
          label={t("typesafe.groupRouting")}
          checked={draft.group_routing}
          disabled={loading || patching}
          onChange={(v) => toggle("group_routing", v)}
        />
        <SwitchRow
          label={t("typesafe.kbAuto")}
          checked={draft.kb_auto}
          disabled={loading || patching}
          onChange={(v) => toggle("kb_auto", v)}
        />
        <SwitchRow
          label={t("typesafe.showCard")}
          checked={draft.show_decision_card}
          disabled={loading || patching}
          onChange={(v) => toggle("show_decision_card", v)}
        />
      </div>
    </Panel>
  );
}

function SwitchRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-text-strong">{label}</span>
      <SettingsSwitch checked={checked} disabled={disabled} onChange={onChange} aria-label={label} />
    </div>
  );
}
