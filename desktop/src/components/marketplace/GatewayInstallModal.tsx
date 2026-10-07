/**
 * 连接器网关安装弹层:双形态(内置 sidecar 一键装 / 自建填 URL+token)。
 * 内置形态先经 connectorRuntimeEnsure 拉起本地 sidecar(拿端口与 runtime token),
 * 再经 mcpPutRaw 本地直写主 MCP 配置(不经市场上游);
 * 纯函数合并逻辑见 gateway-model.applyGatewayToMcpJson。
 * 已安装时提供连接管理入口(见 GatewayConnectionsModal)。
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cable, Loader2, ShieldCheck } from "lucide-react";
import { Modal } from "../ds/Modal";
import { i18n } from "../../i18n/i18n";
import { defaultGatewayForm } from "../../data/connector-gateway";
import {
  applyGatewayToMcpJson,
  buildBuiltinGatewayForm,
  type GatewayForm,
  type GatewayFormMode,
} from "./gateway-model";
import { GatewayConnectionsModal } from "./GatewayConnectionsModal";

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

const MODES: readonly GatewayFormMode[] = ["builtin", "self"];

export function GatewayInstallModal({ open, configPath, installed, onClose, onInstalled }: Props) {
  const { t } = useTranslation("marketplace");
  const [form, setForm] = useState<GatewayForm>(defaultGatewayForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);

  // 每次打开重置为内置默认表单,避免上一次的自建输入残留。
  useEffect(() => {
    if (open) {
      setForm(defaultGatewayForm());
      setError(null);
    }
  }, [open]);

  const setMode = (mode: GatewayFormMode) => {
    setForm((prev) => ({ ...prev, mode, url: mode === "self" ? "" : prev.url }));
  };

  const handleInstall = async () => {
    setSaving(true);
    setError(null);
    try {
      let effective = form;
      if (form.mode === "builtin") {
        // 先拉起本地 sidecar,拿端口与 runtime token 再生成配置。
        const ensure = await window.agenticxDesktop.connectorRuntimeEnsure();
        if (!ensure.ok) {
          throw new Error(mt(`gateway.ensureFailed.${ensure.error}`));
        }
        effective = buildBuiltinGatewayForm(ensure.port, ensure.runtimeToken);
      }
      const raw = await window.agenticxDesktop.mcpGetRaw({ path: configPath });
      if (!raw.ok || typeof raw.text !== "string") {
        throw new Error(mt("gateway.cannotReadConfig"));
      }
      const applied = applyGatewayToMcpJson(raw.text, effective);
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
        <p className="text-xs leading-relaxed text-text-muted">{t("gateway.intro")}</p>

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
          {form.mode === "builtin" ? t("gateway.builtinHint") : t("gateway.selfHint")}
        </p>

        {form.mode === "self" ? (
          <>
            <label className="block text-[11px] text-text-muted">
              {t("gateway.url")}
              <input
                type="text"
                className="mt-0.5 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary outline-none focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
                value={form.url}
                placeholder="http://127.0.0.1:8787"
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              />
            </label>

            <label className="block text-[11px] text-text-muted">
              {t("gateway.token")}
              <input
                type="password"
                autoComplete="off"
                className="mt-0.5 w-full rounded-md border border-border bg-surface-panel px-2 py-1.5 text-xs text-text-primary outline-none focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
                value={form.token}
                placeholder="…"
                onChange={(e) => setForm((prev) => ({ ...prev, token: e.target.value }))}
              />
            </label>
            <p className="text-[11px] leading-relaxed text-text-faint">{t("gateway.tokenHint")}</p>
          </>
        ) : null}

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
          {installed ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[11px] text-text-muted transition hover:text-text-strong"
              onClick={() => setConnectionsOpen(true)}
            >
              <Cable className="h-3 w-3" aria-hidden />
              {t("gateway.manageConnections")}
            </button>
          ) : (
            <span />
          )}
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
              className="inline-flex items-center gap-1 rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
              onClick={() => void handleInstall()}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {saving ? t("gateway.installing") : t("gateway.install")}
            </button>
          </div>
        </div>
      </div>

      <GatewayConnectionsModal open={connectionsOpen} onClose={() => setConnectionsOpen(false)} />
    </Modal>
  );
}
