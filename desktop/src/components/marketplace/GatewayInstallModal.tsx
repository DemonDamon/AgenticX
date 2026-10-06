/**
 * 连接器网关安装弹层:双形态(托管一键装 / 自建填 URL+token),
 * 确认后经 mcpPutRaw 本地直写主 MCP 配置(不经市场上游),
 * 纯函数合并逻辑见 gateway-model.applyGatewayToMcpJson。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { Modal } from "../ds/Modal";
import { i18n } from "../../i18n/i18n";
import { CONNECTOR_GATEWAY, defaultGatewayForm } from "../../data/connector-gateway";
import { applyGatewayToMcpJson, type GatewayForm, type GatewayFormMode } from "./gateway-model";

type Props = {
  open: boolean;
  /** 主 MCP 配置路径(与设置页本地直写链路一致)。 */
  configPath: string;
  /** 网关 server 是否已在本机名册(重复安装提示)。 */
  installed: boolean;
  onClose: () => void;
  /** 安装成功回调(刷新本机名册,让市场卡片切换已装态)。 */
  onInstalled: (message: string) => void | Promise<void>;
};

function mt(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "marketplace", ...(opts ?? {}) }));
}

const MODES: readonly GatewayFormMode[] = ["hosted", "self"];

export function GatewayInstallModal({ open, configPath, installed, onClose, onInstalled }: Props) {
  const { t } = useTranslation("marketplace");
  const [form, setForm] = useState<GatewayForm>(defaultGatewayForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 每次打开重置为托管默认表单,避免上一次的自建输入残留。
  useEffect(() => {
    if (open) {
      setForm(defaultGatewayForm());
      setError(null);
    }
  }, [open]);

  const setMode = (mode: GatewayFormMode) => {
    setForm((prev) =>
      mode === "hosted"
        ? { ...prev, mode, url: CONNECTOR_GATEWAY.hostedUrl }
        : { ...prev, mode, url: "" },
    );
  };

  const handleInstall = async () => {
    setSaving(true);
    setError(null);
    try {
      const raw = await window.agenticxDesktop.mcpGetRaw({ path: configPath });
      if (!raw.ok || typeof raw.text !== "string") {
        throw new Error(mt("gateway.cannotReadConfig"));
      }
      const applied = applyGatewayToMcpJson(raw.text, form);
      if (!applied.ok) {
        throw new Error(
          applied.error === "invalid_json"
            ? mt("gateway.cannotReadConfig")
            : mt("gateway.invalidUrl"),
        );
      }
      const save = await window.agenticxDesktop.mcpPutRaw({ path: configPath, text: applied.text });
      if (!save.ok) throw new Error(save.error ?? mt("gateway.saveFailed"));
      await onInstalled(mt("gateway.installOk", { name: applied.serverName }));
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={t("gateway.modalTitle")} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-text-muted">
          {t("gateway.intro", {
            providers: t("gateway.supplyProviders"),
            actions: t("gateway.supplyActions"),
          })}
        </p>

        <div className="flex gap-1 rounded-lg border border-border bg-surface-card p-1" role="tablist">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={form.mode === mode}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                form.mode === mode
                  ? "bg-surface-card-strong font-medium text-text-strong"
                  : "text-text-muted hover:text-text-strong"
              }`}
              onClick={() => setMode(mode)}
            >
              {t(`gateway.mode.${mode}`)}
            </button>
          ))}
        </div>

        <p className="text-[11px] leading-relaxed text-text-faint">
          {form.mode === "hosted" ? t("gateway.hostedHint") : t("gateway.selfHint")}
        </p>

        <label className="block text-[11px] text-text-muted">
          {t("gateway.url")}
          <input
            type="text"
            className="mt-0.5 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent disabled:opacity-60"
            value={form.url}
            placeholder="http://127.0.0.1:8787"
            disabled={form.mode === "hosted"}
            onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
          />
        </label>

        <label className="block text-[11px] text-text-muted">
          {t("gateway.token")}
          <input
            type="password"
            autoComplete="off"
            className="mt-0.5 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
            value={form.token}
            placeholder="oc_pat_…"
            onChange={(e) => setForm((prev) => ({ ...prev, token: e.target.value }))}
          />
        </label>
        <p className="text-[11px] leading-relaxed text-text-faint">{t("gateway.tokenHint")}</p>

        <div className="flex items-start gap-2 rounded-md border border-border bg-surface-card px-2.5 py-2 text-[11px] leading-relaxed text-text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
          <span>{t("gateway.security")}</span>
        </div>

        {installed ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-500">
            {t("gateway.installedHint")}
          </div>
        ) : null}

        {error ? (
          <div className="whitespace-pre-wrap break-words rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-400">
            {t("gateway.installFailed", { reason: error })}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11px] text-text-muted transition hover:text-text-strong"
            onClick={() => window.open(CONNECTOR_GATEWAY.officialUrl, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            {t("gateway.officialDocs")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
              onClick={onClose}
              disabled={saving}
            >
              {t("gateway.cancel")}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
              onClick={() => void handleInstall()}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {saving ? t("gateway.installing") : t("gateway.install")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
