/**
 * 连接器网关·连接管理弹层(最小):
 * 列出网关目录连接器与已建连接;api_key 连接器可配置密钥(创建连接),
 * no-auth 连接器零配置直接用;删除连接即时生效。
 * 全部走主进程 admin 代理 IPC(admin token 不落渲染层)。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Modal } from "../ds/Modal";

type ConnectorApp = {
  id: string;
  displayName: string;
  description?: string;
  authType: string;
  actionCount: number;
};

type ConnectionItem = {
  id: string;
  connectorId: string;
  name: string;
  authType: string;
  createdAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function GatewayConnectionsModal({ open, onClose }: Props) {
  const { t } = useTranslation("marketplace");
  const [apps, setApps] = useState<ConnectorApp[]>([]);
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 正在配置密钥的连接器 id(展开内联表单)。 */
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [keyName, setKeyName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const admin = useCallback(
    async (method: string, path: string, body?: unknown) => {
      const resp = await window.agenticxDesktop.connectorRuntimeAdmin({ method, path, body });
      if (!resp.ok) throw new Error(String(resp.error ?? `HTTP ${resp.status}`));
      return resp.body;
    },
    [],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [appsBody, connsBody] = await Promise.all([
        admin("GET", "/admin/apps"),
        admin("GET", "/admin/connections"),
      ]);
      const appsOut = (appsBody as { apps?: ConnectorApp[] })?.apps ?? [];
      const connsOut = (connsBody as { connections?: ConnectionItem[] })?.connections ?? [];
      setApps(appsOut);
      setConnections(connsOut);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [admin]);

  useEffect(() => {
    if (open) {
      setConfiguring(null);
      setKeyName("");
      setApiKey("");
      void reload();
    }
  }, [open, reload]);

  const handleCreate = async (connectorId: string) => {
    if (!keyName.trim() || !apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await admin("POST", "/admin/connections", {
        connectorId,
        name: keyName.trim(),
        apiKey: apiKey.trim(),
      });
      setConfiguring(null);
      setKeyName("");
      setApiKey("");
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await admin("DELETE", `/admin/connections/${id}`);
      await reload();
    } catch (err) {
      setError(String(err));
    }
  };

  const connectionsOf = (connectorId: string) =>
    connections.filter((c) => c.connectorId === connectorId);

  return (
    <Modal open={open} title={t("gateway.connections.title")} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-text-muted">{t("gateway.connections.intro")}</p>

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-faint">
            {t("gateway.connections.count", { apps: apps.length, conns: connections.length })}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
            {t("gateway.connections.refresh")}
          </button>
        </div>

        {error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-rose-400">
            {t("gateway.connections.failed", { reason: error })}
          </div>
        ) : null}

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {apps.map((app) => {
            const conns = connectionsOf(app.id);
            const needsKey = app.authType === "api_key";
            return (
              <div key={app.id} className="rounded-lg border border-border bg-surface-card px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-text-strong">{app.displayName}</span>
                      <span className="rounded bg-surface-panel px-1 py-0.5 text-[10px] text-text-faint">
                        {app.actionCount} {t("gateway.connections.actions")}
                      </span>
                      {needsKey ? (
                        <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-500">
                          {t("gateway.connections.needsKey")}
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-500">
                          {t("gateway.connections.noAuth")}
                        </span>
                      )}
                    </div>
                    {app.description ? (
                      <p className="mt-0.5 truncate text-[11px] text-text-faint">{app.description}</p>
                    ) : null}
                  </div>
                  {needsKey ? (
                    <button
                      type="button"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                      onClick={() => {
                        setConfiguring(configuring === app.id ? null : app.id);
                        setKeyName("");
                        setApiKey("");
                      }}
                    >
                      <KeyRound className="h-3 w-3" aria-hidden />
                      {conns.length > 0
                        ? t("gateway.connections.addAnother")
                        : t("gateway.connections.configureKey")}
                    </button>
                  ) : null}
                </div>

                {conns.length > 0 ? (
                  <ul className="mt-1.5 space-y-1">
                    {conns.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-md bg-surface-panel px-2 py-1 text-[11px] text-text-muted"
                      >
                        <span className="truncate">{c.name}</span>
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-text-faint transition hover:bg-surface-hover hover:text-rose-400"
                          title={t("gateway.connections.delete")}
                          onClick={() => void handleDelete(c.id)}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {configuring === app.id ? (
                  <div className="mt-2 space-y-1.5 rounded-md border border-border bg-surface-panel p-2">
                    <input
                      type="text"
                      className="w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-xs text-text-primary outline-none focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
                      placeholder={t("gateway.connections.namePlaceholder")}
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                    />
                    <input
                      type="password"
                      autoComplete="off"
                      className="w-full rounded-md border border-border bg-surface-card px-2 py-1.5 text-xs text-text-primary outline-none focus:border-[var(--ui-btn-primary-border,#3b82f6)]"
                      placeholder={t("gateway.connections.keyPlaceholder")}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition hover:bg-surface-hover"
                        onClick={() => setConfiguring(null)}
                        disabled={saving}
                      >
                        {t("gateway.cancel")}
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-btnPrimary px-2.5 py-1 text-[11px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-40"
                        onClick={() => void handleCreate(app.id)}
                        disabled={saving || !keyName.trim() || !apiKey.trim()}
                      >
                        {saving ? t("gateway.connections.saving") : t("gateway.connections.save")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {!loading && apps.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-text-faint">
              {t("gateway.connections.empty")}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
