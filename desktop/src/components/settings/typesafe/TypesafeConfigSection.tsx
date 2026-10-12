import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../../store";
import { Panel } from "../../ds/Panel";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsSwitch } from "../SettingsSwitch";
import { rememberTypesafeSettings } from "../../../hooks/useTypesafeSettings";
import { TypesafeIcon } from "../../../utils/provider-icons";
import {
  DEFAULT_TYPESAFE_PUBLIC_SETTINGS,
  parseTypesafeApiKey,
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

export function TypesafeConfigSection({
  variant = "panel",
}: {
  variant?: "panel" | "embedded";
} = {}) {
  const { t } = useTranslation("workspace");
  const { t: ts } = useTranslation("settings");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const [draft, setDraft] = useState<TypesafePublicSettings>(DEFAULT_TYPESAFE_PUBLIC_SETTINGS);
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
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
        const raw = await resp.json();
        const next = parseTypesafePublicSettings(raw);
        if (!cancelled) {
          applyPublic(next);
          setApiKey(parseTypesafeApiKey(raw));
        }
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
      const raw = JSON.parse(text || "{}");
      const next = parseTypesafePublicSettings(raw);
      applyPublic(next);
      setApiKey(parseTypesafeApiKey(raw));
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

  const body = (
    <>
      {variant === "embedded" ? (
        <div className="flex items-center gap-3 pt-1">
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#111] text-white shadow-sm"
            aria-hidden
          >
            <TypesafeIcon size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug text-text-primary">{t("typesafe.listName")}</h2>
            <p className={`${SETTINGS_HINT_CLASS} mt-0.5`}>{t("typesafe.hint")}</p>
          </div>
          <label className="flex cursor-pointer flex-col items-center gap-1">
            <span className="text-[10px] text-text-faint">{t("typesafe.enabled")}</span>
            <SettingsSwitch
              checked={draft.enabled}
              disabled={loading || patching}
              onChange={(v) => toggle("enabled", v)}
              aria-label={t("typesafe.enabled")}
            />
          </label>
        </div>
      ) : (
        <p className={`${SETTINGS_HINT_CLASS} mb-3`}>{t("typesafe.hint")}</p>
      )}
      <label className={`${SETTINGS_LABEL_CLASS} ${variant === "embedded" ? "mt-4" : "mb-1"} block`}>
        {t("typesafe.apiKey")}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type={keyVisible ? "text" : "password"}
            autoComplete="off"
            className="w-full rounded-md border border-border bg-surface-panel py-1.5 pl-2 pr-11 text-sm text-text-primary placeholder:text-text-faint outline-none focus:border-[var(--settings-accent-focus)]"
            value={apiKey}
            placeholder={t("typesafe.apiKeyPlaceholder")}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={loading}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label={keyVisible ? ts("commonSettings.hideKey") : ts("commonSettings.showKey")}
            className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-subtle"
            onClick={() => setKeyVisible((v) => !v)}
          >
            {keyVisible ? (
              <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <Eye className="h-4 w-4 shrink-0" aria-hidden />
            )}
          </button>
        </div>
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
        {variant === "panel" ? (
          <SwitchRow
            label={t("typesafe.enabled")}
            checked={draft.enabled}
            disabled={loading || patching}
            onChange={(v) => toggle("enabled", v)}
          />
        ) : null}
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
    </>
  );

  if (variant === "embedded") {
    return <div className="space-y-1">{body}</div>;
  }
  return <Panel title={t("typesafe.title")}>{body}</Panel>;
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
