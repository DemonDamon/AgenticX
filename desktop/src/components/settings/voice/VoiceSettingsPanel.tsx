import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SETTINGS_HINT_CLASS, SETTINGS_INTRO_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { META_AGENT_DISPLAY_NAME } from "../../../constants/branding";
import { studioFetch } from "../../../utils/studio-fetch";
import {

  formatPttShortcutLabel,
  listPttShortcutPresets,
  loadPttShortcutPreset,
  savePttShortcutPreset,
  type PttShortcutPreset,
} from "../../../voice/ptt-config";
import { useAppStore } from "../../../store";
import { i18n } from "../../../i18n/i18n";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}


type VoiceForm = {
  provider: string;
  tool_scope: "default" | "advanced";
  openai_realtime: {
    api_key: string;
    base_url: string;
    model: string;
    voice: string;
    instructions: string;
  };
  doubao_realtime: {
    app_id: string;
    access_key: string;
    secret_key: string;
    api_app_key: string;
    resource_id: string;
    voice_type: string;
    model: string;
    bot_name: string;
    system_role: string;
    speaking_style: string;
  };
  input_device_id: string;
};

function emptyVoiceForm(): VoiceForm {
  return {
    provider: "openai_realtime",
    tool_scope: "default",
    openai_realtime: {
      api_key: "",
      base_url: "https://api.openai.com",
      model: "gpt-4o-realtime-preview",
      voice: "alloy",
      instructions: "",
    },
    doubao_realtime: {
      app_id: "",
      access_key: "",
      secret_key: "",
      api_app_key: "PlgvMymc7f3tQnJ6",
      resource_id: "volc.speech.dialog",
      voice_type: "zh_female_vv_jupiter_bigtts",
      model: "1.2.1.1",
      bot_name: META_AGENT_DISPLAY_NAME,
      system_role: "",
      speaking_style: "",
    },
    input_device_id: "",
  };
}

const SECRET_SAVED_HINT_CN = "密钥已保存在本机配置，修改请重新输入全文";

/** 服务端 ConfigManager._mask 或占位串：回填到表单时用于提示，不向 PUT 回传明文。 */
function isMaskedServerSecret(s: unknown): boolean {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  if (t === "****") return true;
  if (t.includes("***")) return true;
  if (/\*\*{2,}/.test(t) && t.length <= 16) return true;
  return /^.{4}\.{3}.{4}$/.test(t);
}

/** 草稿中的密钥是否应该视为「占位 / 回声」，不向服务端提交。 */
function isSecretDraftSentinel(t: string): boolean {
  const s = t.trim();
  if (!s) return true;
  if (s.includes("密钥已保存在本机配置") || s.includes("Key is saved in local config")) return true;
  if (isMaskedServerSecret(s)) return true;
  if (s.startsWith("••")) return true;
  return false;
}

/** 若非实际新密钥则返回 undefined（PUT 不传该字段，磁盘保留原值）。 */
function pickSecretForPut(raw: string): string | undefined {
  if (isSecretDraftSentinel(raw)) return undefined;
  return raw.trim();
}

/** App ID：YAML 常为数字类型，转为十进制字符串供输入框固定展示。 */
function normalizeAppIdFromApi(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return String(raw).trim();
}

export type VoiceSettingsPanelHandle = {
  /** 由设置弹窗底部「保存」触发，写入 `PUT /api/voice/settings`（未打开语音 Tab 时组件未挂载，跳过）。 */
  persist: () => Promise<{ ok: boolean; error?: string }>;
};

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative mt-1">
      <input
        type={visible ? "text" : "password"}
        autoComplete="off"
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-surface-panel py-1 pl-2 pr-11 text-sm text-text-primary"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? st("voice.hideKey") : st("voice.showKey")}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-subtle"
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff className="h-4 w-4 shrink-0" aria-hidden /> : <Eye className="h-4 w-4 shrink-0" aria-hidden />}
      </button>
    </div>
  );
}

/** 灵巧模式语音：Realtime Provider、凭证与麦克风选择（服务端落盘 ~/.agenticx/config.yaml `voice:`） */
export const VoiceSettingsPanel = forwardRef<VoiceSettingsPanelHandle>(function VoiceSettingsPanel(_props, ref) {
  const { t } = useTranslation("settings");
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);

  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  /** 加载 / 保存等通用提示（靠上，紧贴说明文案） */
  const [panelMsg, setPanelMsg] = useState("");
  /** 仅「测试连通性」反馈（挨着按钮底部，避免与表单脱节） */
  const [probeMsg, setProbeMsg] = useState("");
  const [draft, setDraft] = useState<VoiceForm>(emptyVoiceForm);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [pttShortcutPreset, setPttShortcutPreset] = useState<PttShortcutPreset>(() => loadPttShortcutPreset());
  const draftRef = useRef(draft);
  const loadingRef = useRef(loading);
  draftRef.current = draft;
  loadingRef.current = loading;

  const heads = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-agx-desktop-token": apiToken,
    }),
    [apiToken]
  );

  const refreshDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === "audioinput"));
      }
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const load = useCallback(async () => {
    setLoading(true);
    setPanelMsg("");
    setProbeMsg("");
    try {
      const resp = await studioFetch("/api/voice/settings", {
        headers: heads,
        storeBase: apiBase,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { voice?: Record<string, unknown> };
      const v = body.voice && typeof body.voice === "object" ? body.voice : {};

      const oaRaw = v.openai_realtime;
      const oa = typeof oaRaw === "object" && oaRaw ? (oaRaw as Record<string, unknown>) : {};

      const dbRaw = v.doubao_realtime;
      const db = typeof dbRaw === "object" && dbRaw ? (dbRaw as Record<string, unknown>) : {};

      setDraft({
        provider: String(v.provider || "openai_realtime"),
        tool_scope: String(v.tool_scope || "default").toLowerCase() === "advanced" ? "advanced" : "default",
        openai_realtime: {
          api_key:
            typeof oa.api_key === "string" && oa.api_key.trim().length > 0
              ? `•••••• (${st("voice.secretSavedHint")})`
              : "",
          base_url: String(oa.base_url || "https://api.openai.com"),
          model: String(oa.model || "gpt-4o-realtime-preview"),
          voice: String(oa.voice || "alloy"),
          instructions: String(oa.instructions || ""),
        },
        doubao_realtime: {
          app_id: normalizeAppIdFromApi(db.app_id ?? ""),
          access_key:
            typeof db.access_key === "string" && db.access_key.trim().length > 0
              ? `•••••• (${st("voice.secretSavedHint")})`
              : "",
          secret_key:
            typeof db.secret_key === "string" && db.secret_key.trim().length > 0
              ? `•••••• (${st("voice.secretSavedHint")})`
              : "",
          api_app_key: String(db.api_app_key || "PlgvMymc7f3tQnJ6"),
          resource_id: String(db.resource_id || "volc.speech.dialog"),
          voice_type: String(db.voice_type || "zh_female_vv_jupiter_bigtts"),
          model: String(db.model || "1.2.1.1"),
          bot_name: String(db.bot_name || META_AGENT_DISPLAY_NAME),
          system_role: String(db.system_role || ""),
          speaking_style: String(db.speaking_style || ""),
        },
        input_device_id: String(v.input_device_id || ""),
      });
    } catch (e) {
      setPanelMsg(e instanceof Error ? e.message : st("voice.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [apiBase, heads]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistVoice = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (loadingRef.current) {
      return { ok: false, error: st("voice.stillLoading") };
    }
    setPanelMsg("");
    setProbeMsg("");
    try {
      const d = draftRef.current;
      const openaiKeyPut = pickSecretForPut(d.openai_realtime.api_key);
      const doubaoAkPut = pickSecretForPut(d.doubao_realtime.access_key);
      const doubaoSkPut = pickSecretForPut(d.doubao_realtime.secret_key);
      const payload = {
        voice: {
          provider: d.provider,
          tool_scope: d.tool_scope,
          openai_realtime: {
            base_url: d.openai_realtime.base_url,
            model: d.openai_realtime.model,
            voice: d.openai_realtime.voice,
            instructions: d.openai_realtime.instructions,
            ...(openaiKeyPut !== undefined ? { api_key: openaiKeyPut } : {}),
          },
          doubao_realtime: {
            app_id: normalizeAppIdFromApi(d.doubao_realtime.app_id),
            api_app_key: d.doubao_realtime.api_app_key,
            resource_id: d.doubao_realtime.resource_id,
            voice_type: d.doubao_realtime.voice_type,
            model: d.doubao_realtime.model,
            bot_name: d.doubao_realtime.bot_name,
            system_role: d.doubao_realtime.system_role,
            speaking_style: d.doubao_realtime.speaking_style,
            ...(doubaoAkPut !== undefined ? { access_key: doubaoAkPut } : {}),
            ...(doubaoSkPut !== undefined ? { secret_key: doubaoSkPut } : {}),
          },
          input_device_id: d.input_device_id,
        },
      };
      const resp = await studioFetch("/api/voice/settings", {
        method: "PUT",
        headers: heads,
        body: JSON.stringify(payload),
        storeBase: apiBase,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await load();
      setPanelMsg(st("voice.savedWithExit"));
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e.message : st("voice.saveFailed");
      setPanelMsg(err);
      return { ok: false, error: err };
    }
  }, [apiBase, heads, load]);

  useImperativeHandle(ref, () => ({ persist: persistVoice }), [persistVoice]);

  const test = async () => {
    setTesting(true);
    const provider = draft.provider.includes("doubao") ? "doubao" : "openai";
    setProbeMsg(provider === "doubao" ? st("voice.probingDoubao") : st("voice.probingOpenai"));
    try {
      const resp = await studioFetch("/api/voice/realtime/probe", {
        method: "POST",
        headers: heads,
        body: JSON.stringify({ provider }),
        storeBase: apiBase,
      });
      let body: { ok?: boolean; detail?: string; error?: string } = {};
      try {
        body = (await resp.json()) as typeof body;
      } catch {
        setProbeMsg(st("voice.badJson", { status: resp.status }));
        return;
      }
      if (!resp.ok && !body.error && !body.detail) {
        setProbeMsg(`HTTP ${resp.status}`);
        return;
      }
      if (body.ok) setProbeMsg(`✅ ${body.detail || st("voice.probeOk")}`);
      else setProbeMsg(`❌ ${body.error || body.detail || st("voice.probeFail")}`);
    } catch (e) {
      setProbeMsg(`❌ ${e instanceof Error ? e.message : st("voice.testFailed")}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Panel title={st("voice.title")}>
        <div className="py-2 text-sm text-text-faint">{st("voice.loading")}</div>
      </Panel>
    );
  }

  return (
    <Panel title={st("voice.title")}>
      <p className={`mb-4 ${SETTINGS_INTRO_CLASS}`}>
        {st("voice.intro")}
      </p>

      {panelMsg ? (
        <div className="mb-4 rounded-md border border-border bg-surface-panel px-3 py-2 text-xs text-text-muted">{panelMsg}</div>
      ) : null}

      <div className="space-y-3 text-sm text-text-muted">
        <fieldset className="space-y-2">
          <legend className={SETTINGS_LABEL_CLASS}>{st("voice.provider")}</legend>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="voice-provider"
              checked={draft.provider === "openai_realtime"}
              onChange={() => setDraft((d) => ({ ...d, provider: "openai_realtime" }))}
              className="accent-[rgb(var(--theme-color-rgb,16,185,129))]"
            />
            {st("voice.openaiRealtime")}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="voice-provider"
              checked={draft.provider === "doubao_realtime"}
              onChange={() => setDraft((d) => ({ ...d, provider: "doubao_realtime" }))}
              className="accent-[rgb(var(--theme-color-rgb,16,185,129))]"
            />
            {st("voice.doubaoRealtime")}
          </label>
        </fieldset>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 text-xs text-text-subtle">{st("voice.advancedTools")}</legend>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={draft.tool_scope === "advanced"}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  tool_scope: e.target.checked ? "advanced" : "default",
                }))
              }
              className="accent-[rgb(var(--theme-color-rgb,16,185,129))]"
            />
            {st("voice.enableWriteTools")}
          </label>
          <p className={SETTINGS_HINT_CLASS}>
            {st("voice.writeToolsHint")}
          </p>
        </fieldset>

        <div>
          <div className={`mb-1 ${SETTINGS_LABEL_CLASS}`}>{st("voice.mic")}</div>
          <select
            className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
            value={draft.input_device_id || "default"}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                input_device_id: e.target.value === "default" ? "" : e.target.value,
              }))
            }
          >
            <option value="default">{st("voice.systemDefaultInput")}</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mt-2 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-surface-hover"
            onClick={() => void refreshDevices()}
          >
            {st("voice.refreshDevices")}
          </button>
        </div>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className={`px-1 ${SETTINGS_LABEL_CLASS}`}>{st("voice.pttLegend")}</legend>
          <label className={`block ${SETTINGS_LABEL_CLASS}`}>
            {st("voice.shortcut")}
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
              value={pttShortcutPreset}
              onChange={(e) => {
                const preset = e.target.value as PttShortcutPreset;
                setPttShortcutPreset(preset);
                savePttShortcutPreset(preset);
              }}
            >
              {listPttShortcutPresets().map((preset) => (
                <option key={preset} value={preset}>
                  {formatPttShortcutLabel(preset)}
                </option>
              ))}
            </select>
          </label>
          <p className={SETTINGS_HINT_CLASS}>
            {st("voice.pttHint", { shortcut: formatPttShortcutLabel("ctrl+space") })}
          </p>
        </fieldset>

        {draft.provider === "openai_realtime" ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className={SETTINGS_LABEL_CLASS}>OpenAI Realtime</div>
            <label className="block">
              {st("voice.apiKey")}
              <SecretInput
                placeholder={st("voice.apiKeyPh")}
                value={draft.openai_realtime.api_key}
                onChange={(api_key) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, api_key } }))}
              />
            </label>
            <label className="block">
              {st("voice.apiBase")}
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.base_url}
                onChange={(e) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, base_url: e.target.value } }))}
              />
            </label>
            <label className="block">
              {st("voice.model")}
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.model}
                onChange={(e) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, model: e.target.value } }))}
              />
            </label>
            <label className="block">
              {st("voice.voice")}
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.voice}
                onChange={(e) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, voice: e.target.value } }))}
              />
            </label>
            <label className="block">
              {st("voice.instructions")}
              <textarea
                rows={4}
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.instructions}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    openai_realtime: { ...d.openai_realtime, instructions: e.target.value },
                  }))
                }
              />
            </label>
          </div>
        ) : (
          <div className="space-y-2 border-t border-border pt-3">
            <div className={SETTINGS_LABEL_CLASS}>{st("voice.doubaoTitle")}</div>
            <p className="text-xs text-amber-500">
              {st("voice.doubaoHint")}
            </p>
            <label className="block">
              {st("voice.appId")}
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.app_id}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, app_id: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.accessKey")}
              <SecretInput
                placeholder={st("voice.accessKeyPh")}
                value={draft.doubao_realtime.access_key}
                onChange={(access_key) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, access_key },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.secretOptional")}
              <SecretInput
                placeholder={st("voice.secretPh")}
                value={draft.doubao_realtime.secret_key}
                onChange={(secret_key) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, secret_key },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.apiAppKey")}
              <SecretInput
                placeholder={st("voice.accessKeyPh")}
                value={draft.doubao_realtime.api_app_key}
                onChange={(api_app_key) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, api_app_key },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.resourceId")}
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.resource_id}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, resource_id: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.modelVersion")}
              <select
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-sm text-text-primary"
                value={draft.doubao_realtime.model}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, model: e.target.value },
                  }))
                }
              >
                <option value="1.2.1.1">{st("voice.modelO")}</option>
                <option value="2.2.0.0">{st("voice.modelSc")}</option>
              </select>
              <span className={`mt-1 block ${SETTINGS_HINT_CLASS}`}>
                {st("voice.modelHint")}
              </span>
            </label>
            <label className="block">
              {st("voice.voice")}
              <input
                placeholder={st("voice.voicePh")}
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.voice_type}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, voice_type: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.botName")}
              <input
                maxLength={20}
                placeholder="Near"
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.bot_name}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, bot_name: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.systemRole")}
              <textarea
                rows={3}
                placeholder={st("voice.systemRolePh")}
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.system_role}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, system_role: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              {st("voice.speakingStyle")}
              <textarea
                rows={2}
                placeholder={st("voice.speakingStylePh")}
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.speaking_style}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, speaking_style: e.target.value },
                  }))
                }
              />
            </label>
          </div>
        )}

        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={testing}
              onClick={() => void test()}
              className="rounded-md border border-border px-4 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            >
              {testing ? st("voice.testing") : st("voice.testConn")}
            </button>
          </div>
          {probeMsg ? (
            <div
              className="mt-3 rounded-md border border-border bg-surface-panel px-3 py-2 text-xs text-text-muted"
              role="status"
              aria-live="polite"
            >
              {probeMsg}
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
});
