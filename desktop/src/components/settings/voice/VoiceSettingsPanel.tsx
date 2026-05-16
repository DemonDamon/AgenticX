import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Panel } from "../../ds/Panel";
import { useAppStore } from "../../../store";

type VoiceForm = {
  provider: string;
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
      bot_name: "Machi",
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
  if (s.includes("密钥已保存在本机配置")) return true;
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

/** 灵巧模式语音：Realtime Provider、凭证与麦克风选择（服务端落盘 ~/.agenticx/config.yaml `voice:`） */
export const VoiceSettingsPanel = forwardRef<VoiceSettingsPanelHandle>(function VoiceSettingsPanel(_props, ref) {
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
      const base = apiBase.replace(/\/+$/, "");
      const resp = await fetch(`${base}/api/voice/settings`, { headers: heads });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = (await resp.json()) as { voice?: Record<string, unknown> };
      const v = body.voice && typeof body.voice === "object" ? body.voice : {};

      const oaRaw = v.openai_realtime;
      const oa = typeof oaRaw === "object" && oaRaw ? (oaRaw as Record<string, unknown>) : {};

      const dbRaw = v.doubao_realtime;
      const db = typeof dbRaw === "object" && dbRaw ? (dbRaw as Record<string, unknown>) : {};

      setDraft({
        provider: String(v.provider || "openai_realtime"),
        openai_realtime: {
          api_key:
            typeof oa.api_key === "string" && oa.api_key.trim().length > 0
              ? `•••••• (${SECRET_SAVED_HINT_CN})`
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
              ? `•••••• (${SECRET_SAVED_HINT_CN})`
              : "",
          secret_key:
            typeof db.secret_key === "string" && db.secret_key.trim().length > 0
              ? `•••••• (${SECRET_SAVED_HINT_CN})`
              : "",
          api_app_key: String(db.api_app_key || "PlgvMymc7f3tQnJ6"),
          resource_id: String(db.resource_id || "volc.speech.dialog"),
          voice_type: String(db.voice_type || "zh_female_vv_jupiter_bigtts"),
          model: String(db.model || "1.2.1.1"),
          bot_name: String(db.bot_name || "Machi"),
          system_role: String(db.system_role || ""),
          speaking_style: String(db.speaking_style || ""),
        },
        input_device_id: String(v.input_device_id || ""),
      });
    } catch (e) {
      setPanelMsg(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [apiBase, heads]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistVoice = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (loadingRef.current) {
      return { ok: false, error: "语音设置仍在加载，请稍后在窗口底部再点「保存」。" };
    }
    setPanelMsg("");
    setProbeMsg("");
    try {
      const base = apiBase.replace(/\/+$/, "");
      const d = draftRef.current;
      const openaiKeyPut = pickSecretForPut(d.openai_realtime.api_key);
      const doubaoAkPut = pickSecretForPut(d.doubao_realtime.access_key);
      const doubaoSkPut = pickSecretForPut(d.doubao_realtime.secret_key);
      const payload = {
        voice: {
          provider: d.provider,
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
      const resp = await fetch(`${base}/api/voice/settings`, {
        method: "PUT",
        headers: heads,
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await load();
      setPanelMsg("已与窗口底部「保存」一并写入本机配置（realtime 计费见云厂商控制台）。");
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e.message : "保存失败";
      setPanelMsg(err);
      return { ok: false, error: err };
    }
  }, [apiBase, heads, load]);

  useImperativeHandle(ref, () => ({ persist: persistVoice }), [persistVoice]);

  const test = async () => {
    setTesting(true);
    const provider = draft.provider.includes("doubao") ? "doubao" : "openai";
    setProbeMsg(provider === "doubao" ? "正在握手 wss://openspeech.bytedance.com …" : "正在测试 OpenAI Realtime 连通性 …");
    try {
      const base = apiBase.replace(/\/+$/, "");
      const resp = await fetch(`${base}/api/voice/realtime/probe`, {
        method: "POST",
        headers: heads,
        body: JSON.stringify({ provider }),
      });
      let body: { ok?: boolean; detail?: string; error?: string } = {};
      try {
        body = (await resp.json()) as typeof body;
      } catch {
        setProbeMsg(`HTTP ${resp.status}: 响应不是合法 JSON`);
        return;
      }
      if (!resp.ok && !body.error && !body.detail) {
        setProbeMsg(`HTTP ${resp.status}`);
        return;
      }
      if (body.ok) setProbeMsg(`✅ ${body.detail || "连通性检查通过"}`);
      else setProbeMsg(`❌ ${body.error || body.detail || "连通性校验未通过"}`);
    } catch (e) {
      setProbeMsg(`❌ ${e instanceof Error ? e.message : "测试失败"}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Panel title="语音">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="语音">
      <p className="mb-4 text-[11px] leading-relaxed text-text-faint">
        灵巧模式胶囊走 Meta-Agent（Machi）：对话轮次归档到当前元智能体会话，`metadata.source = voice-focus`。
        实时链路按使用量计费——OpenAI Realtime 与豆包/火山均需自备账号与密钥。国内调用 OpenAI 需自行配置可访问代理的{" "}
        <code className="text-text-subtle">base_url</code>。请使用窗口<strong>底部</strong>的「保存」将本页写入{" "}
        <code className="text-text-subtle">~/.agenticx/config.yaml</code>（本页不再提供重复保存按钮）。
      </p>

      {panelMsg ? (
        <div className="mb-4 rounded-md border border-border bg-surface-panel px-3 py-2 text-xs text-text-muted">{panelMsg}</div>
      ) : null}

      <div className="space-y-3 text-sm text-text-muted">
        <fieldset className="space-y-2">
          <legend className="text-text-subtle">Provider</legend>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="voice-provider"
              checked={draft.provider === "openai_realtime"}
              onChange={() => setDraft((d) => ({ ...d, provider: "openai_realtime" }))}
              className="accent-[rgb(var(--theme-color-rgb,16,185,129))]"
            />
            OpenAI Realtime（WebRTC，经本机后端换 SDP）
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="voice-provider"
              checked={draft.provider === "doubao_realtime"}
              onChange={() => setDraft((d) => ({ ...d, provider: "doubao_realtime" }))}
              className="accent-[rgb(var(--theme-color-rgb,16,185,129))]"
            />
            豆包实时语音（火山 RTC 协议，经由 Studio WebSocket 桥接）
          </label>
        </fieldset>

        <div>
          <div className="mb-1 text-text-subtle">麦克风</div>
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
            <option value="default">系统默认输入</option>
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
            刷新设备列表
          </button>
        </div>

        {draft.provider === "openai_realtime" ? (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-text-subtle text-xs uppercase tracking-wide">OpenAI Realtime</div>
            <label className="block">
              API Key
              <input
                type="password"
                placeholder="仅在覆盖时填写；留空保持不变"
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.api_key}
                onChange={(e) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, api_key: e.target.value } }))}
              />
            </label>
            <label className="block">
              Base URL
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.base_url}
                onChange={(e) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, base_url: e.target.value } }))}
              />
            </label>
            <label className="block">
              Model
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.model}
                onChange={(e) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, model: e.target.value } }))}
              />
            </label>
            <label className="block">
              Voice
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.openai_realtime.voice}
                onChange={(e) => setDraft((d) => ({ ...d, openai_realtime: { ...d.openai_realtime, voice: e.target.value } }))}
              />
            </label>
            <label className="block">
              指令 Instructions（可选，注入 realtime session）
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
            <div className="text-text-subtle text-xs uppercase tracking-wide">豆包 / 火山</div>
            <label className="block">
              App ID
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
              Access Key
              <input
                type="password"
                placeholder="仅在覆盖时填写"
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.access_key}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, access_key: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              Secret Key（可选）
              <input
                type="password"
                placeholder="部分账号需要填写"
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.secret_key}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, secret_key: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              API App Key
              <input
                className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2 py-1 text-sm text-text-primary"
                value={draft.doubao_realtime.api_app_key}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    doubao_realtime: { ...d.doubao_realtime, api_app_key: e.target.value },
                  }))
                }
              />
            </label>
            <label className="block">
              Resource Id
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
              Model 版本
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
                <option value="1.2.1.1">O2.0（1.2.1.1）— 精品音色 + bot_name/system_role/speaking_style</option>
                <option value="2.2.0.0">SC2.0（2.2.0.0）— 克隆音色（saturn_/S_）+ 角色扮演</option>
              </select>
              <span className="mt-1 block text-[11px] text-text-faint">
                文档 §1.1：必传 dialog.extra.model；O 系列适配精品音色，SC 系列适配克隆音色，请勿混用。
              </span>
            </label>
            <label className="block">
              Voice Type（音色）
              <input
                placeholder="如 zh_female_vv_jupiter_bigtts / saturn_xxx / S_xxx"
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
              Bot Name（角色称呼，仅 O 版本生效，≤20 字）
              <input
                maxLength={20}
                placeholder="Machi"
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
              System Role（背景人设，仅 O 版本生效）
              <textarea
                rows={3}
                placeholder='例如："你是一个理性、克制、技术导向的开发者助手。"'
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
              Speaking Style（口吻，仅 O 版本生效）
              <textarea
                rows={2}
                placeholder='例如："你说话简洁、就事论事，不寒暄。"'
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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={testing}
              onClick={() => void test()}
              className="rounded-md border border-border px-4 py-1.5 text-sm text-text-muted hover:bg-surface-hover"
            >
              {testing ? "测试中…" : "测试连通性"}
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
