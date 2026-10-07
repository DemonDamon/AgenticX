/**
 * 「我的连接」列表面板：展示已连接/需重新授权实例，确认后断开（native logout / MCP 删除）。
 * 成功后回调 onChanged，供市场与设置刷新同一套 health SSOT。
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trash2 } from "lucide-react";
import { MarketIcon } from "../../marketplace/MarketIcon";
import { i18n } from "../../../i18n/i18n";
import { MCP_PRIMARY_CONFIG_PATH } from "../../../utils/mcp-remote-config";
import type { ConnectorHealth } from "./connector-health";
import type { ConnectorId } from "./connector-catalog";
import {
  buildMyConnectionRows,
  removeMcpServerFromDocument,
  type MyConnectionRow,
} from "./my-connections-model";

function st(key: string, opts?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: "settings", ...(opts ?? {}) }));
}

type Props = {
  sessionId: string;
  healthByConnectorId: Readonly<Record<string, ConnectorHealth | undefined>>;
  accountsByConnectorId?: Readonly<Record<string, string | undefined>>;
  configuredMcpNames: readonly string[];
  gatewayInstalled?: boolean;
  displayNames?: Readonly<Record<string, string>>;
  /** 断开或删除后通知宿主刷新 marketplace / settings SSOT。 */
  onChanged: () => void;
  /** 点「管理」或 degraded 行：打开握手弹层。 */
  onOpenHandshake?: (connectorId: ConnectorId) => void;
  query?: string;
  className?: string;
};

async function logoutNative(connectorId: ConnectorId): Promise<{ ok: boolean; error?: string }> {
  const api = window.agenticxDesktop;
  switch (connectorId) {
    case "tencent-meeting":
      return api.nativeConnectorTmeetLogout();
    case "github":
      return api.nativeConnectorGithubLogout();
    case "feishu":
      return api.nativeConnectorFeishuLogout();
    case "wecom":
      return api.nativeConnectorWecomLogout();
    case "qqmail":
      return api.nativeConnectorQqmailLogout();
    default:
      return { ok: false, error: `unsupported logout: ${connectorId}` };
  }
}

async function removeMcpServer(serverName: string): Promise<{ ok: boolean; error?: string }> {
  const path = MCP_PRIMARY_CONFIG_PATH;
  const raw = await window.agenticxDesktop.mcpGetRaw({ path }).catch(() => null);
  if (!raw?.ok || typeof raw.text !== "string") {
    return { ok: false, error: raw?.error || "read mcp.json failed" };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.text) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  const { document, removed } = removeMcpServerFromDocument(parsed, serverName);
  if (!removed) return { ok: true };
  const save = await window.agenticxDesktop.mcpPutRaw({
    path,
    text: `${JSON.stringify(document, null, 2)}\n`,
  });
  if (!save?.ok) return { ok: false, error: save?.error || "write mcp.json failed" };
  return { ok: true };
}

export function MyConnectionsPanel({
  sessionId,
  healthByConnectorId,
  accountsByConnectorId,
  configuredMcpNames,
  gatewayInstalled,
  displayNames,
  onChanged,
  onOpenHandshake,
  query = "",
  className = "",
}: Props) {
  const { t } = useTranslation("marketplace");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const rows = useMemo(
    () =>
      buildMyConnectionRows({
        healthByConnectorId,
        accountsByConnectorId,
        configuredMcpNames,
        gatewayInstalled,
        displayNames,
        query,
      }),
    [
      healthByConnectorId,
      accountsByConnectorId,
      configuredMcpNames,
      gatewayInstalled,
      displayNames,
      query,
    ],
  );

  const disconnect = useCallback(
    async (row: MyConnectionRow) => {
      setBusyKey(row.key);
      setError("");
      try {
        if (row.action === "native_logout" && row.connectorId) {
          const res = await logoutNative(row.connectorId);
          if (!res.ok) {
            setError(res.error || st("connectors.myConnections.disconnectFail"));
            return;
          }
          // GitHub：原生登出后顺带摘掉 mcp.json 里的 github，避免 SSOT 仍 degraded。
          if (row.mcpServerName) {
            await removeMcpServer(row.mcpServerName);
          }
        } else if (row.action === "mcp_remove" && row.mcpServerName) {
          const disc = await window.agenticxDesktop.disconnectMcp({
            sessionId,
            name: row.mcpServerName,
          });
          if (!disc.ok) {
            setError(disc.error || st("connectors.myConnections.disconnectFail"));
            return;
          }
          const rm = await removeMcpServer(row.mcpServerName);
          if (!rm.ok) {
            setError(rm.error || st("connectors.myConnections.disconnectFail"));
            return;
          }
        } else if (row.action === "gateway_remove" && row.mcpServerName) {
          const rm = await removeMcpServer(row.mcpServerName);
          if (!rm.ok) {
            setError(rm.error || st("connectors.myConnections.disconnectFail"));
            return;
          }
        } else {
          setError(st("connectors.myConnections.disconnectFail"));
          return;
        }
        setPendingKey(null);
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyKey(null);
      }
    },
    [onChanged, sessionId],
  );

  if (rows.length === 0) {
    return (
      <div
        className={`rounded-xl border border-dashed border-border bg-surface-card/40 px-4 py-8 text-center text-sm text-text-muted ${className}`}
        data-my-connections="empty"
      >
        {t("connectors.myConnectionsEmpty")}
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`} data-my-connections="list">
      {error ? (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}
      <ul className="space-y-2">
        {rows.map((row) => {
          const busy = busyKey === row.key;
          const confirming = pendingKey === row.key;
          return (
            <li
              key={row.key}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface-cardSolid px-3 py-3"
              data-my-connection={row.key}
            >
              <MarketIcon name={row.name} iconSrc={row.iconSrc} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-text-strong">{row.name}</span>
                  {row.health === "degraded" ? (
                    <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                      {t("badge.needsReauth")}
                    </span>
                  ) : (
                    <span className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                      {t("badge.installed")}
                    </span>
                  )}
                </div>
                {row.detail ? (
                  <p className="mt-1 truncate text-[11px] text-text-muted">{row.detail}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {row.connectorId && onOpenHandshake ? (
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                    disabled={busy}
                    onClick={() => onOpenHandshake(row.connectorId!)}
                  >
                    {row.health === "degraded"
                      ? t("actions.reauth")
                      : t("actions.manage")}
                  </button>
                ) : null}
                {confirming ? (
                  <>
                    <button
                      type="button"
                      className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300"
                      disabled={busy}
                      onClick={() => void disconnect(row)}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      ) : (
                        st("connectors.myConnections.confirmDelete")
                      )}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-border px-2 py-1 text-[11px] text-text-muted"
                      disabled={busy}
                      onClick={() => setPendingKey(null)}
                    >
                      {st("connectors.cancel")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-text-muted transition hover:bg-surface-hover hover:text-rose-400"
                    disabled={busy}
                    title={st("connectors.myConnections.delete")}
                    aria-label={st("connectors.myConnections.deleteAria", { name: row.name })}
                    onClick={() => setPendingKey(row.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {st("connectors.myConnections.delete")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
