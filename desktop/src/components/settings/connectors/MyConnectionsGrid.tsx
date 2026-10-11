/**
 * 「我的连接」卡片网格（Comate 风格，2 列）：logo / 字母头像、名称、状态徽章、来源徽章（官方/企业/自定义）
 * + 形态（MCP / REST API / 数据库），2 行描述（无则「暂无描述」）。
 * 与市场卡片同一 agx-market-card 实底 + 悬停阴影；「使用」与「…」菜单（管理 / 删除）悬停显，静态零占位。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, MessageSquarePlus, MoreHorizontal, SquarePlus } from "lucide-react";
import { MarketIcon } from "../../marketplace/MarketIcon";
import { buildNewConnectorChatDraft } from "./NewConnectorButton";
import {
  connectionRowShape,
  connectionRowSource,
  connectionRowStatus,
  type ConnectionStatus,
} from "./connector-buckets";
import { connectorSupplyDisplay } from "./connector-display";
import { findSupplyById } from "./connector-supply";
import { deleteConnectionRow } from "./my-connections-actions";
import type { MyConnectionRow } from "./my-connections-model";
import type { ConnectorsController } from "./useConnectorsController";

const CTA_HOVER_ONLY =
  "pointer-events-none absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";
const CTA_PINNED = "absolute right-3 top-3 flex items-center gap-1";
const CTA_HOVER_PAD = "pr-0 group-hover:pr-[7.5rem] group-focus-within:pr-[7.5rem]";

const STATUS_STYLE: Record<ConnectionStatus, string> = {
  connected: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  needs_credential: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  needs_auth: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  invalid: "border-rose-500/40 bg-rose-500/10 text-rose-400",
};

const LETTER_COLORS = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#14B8A6", "#6366F1", "#EF4444"];

function LetterAvatar({ name }: { name: string }) {
  const ch = (Array.from(name.trim())[0] ?? "?").toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[17px] font-semibold text-white"
      style={{ background: LETTER_COLORS[h % LETTER_COLORS.length] }}
      aria-hidden
    >
      {ch}
    </span>
  );
}

/** 卡片描述：REST 登记说明 → 供给目录描述（原生/模板/网关）→ 空。 */
export function connectionRowDescription(row: MyConnectionRow): string {
  if (row.description) return row.description;
  const supply = findSupplyById(row.templateId ?? row.supplyId);
  return supply ? connectorSupplyDisplay(supply).description : "";
}

type Props = {
  ctl: ConnectorsController;
  rows: readonly MyConnectionRow[];
  emptyText: string;
};

export function MyConnectionsGrid({ ctl, rows, emptyText }: Props) {
  const { t } = useTranslation("marketplace");
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuKey) return;
    const onDown = (e: MouseEvent) => {
      const menu = rootRef.current?.querySelector(`[data-connection-menu="${CSS.escape(menuKey)}"]`);
      if (menu && menu.contains(e.target as Node)) return;
      setMenuKey(null);
      setConfirmKey(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuKey]);

  const manage = (row: MyConnectionRow) => {
    setMenuKey(null);
    if (row.kind === "native" && row.connectorId) ctl.openHandshake(row.connectorId);
    else if (row.kind === "gateway" && row.connectorKind !== "rest") ctl.openGateway();
    else ctl.startChat(buildNewConnectorChatDraft(t("connectors.hub.manageDraft", { name: row.name })));
  };

  const remove = async (row: MyConnectionRow) => {
    setBusyKey(row.key);
    setError("");
    try {
      const res = await deleteConnectionRow(row, ctl.sessionId);
      if (!res.ok) {
        setError(res.error || t("connectors.hub.deleteFailed"));
        return;
      }
      setMenuKey(null);
      setConfirmKey(null);
      ctl.setStatus({ message: t("connectors.hub.deleted", { name: row.name }), kind: "success" });
      await ctl.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="py-14 text-center text-sm text-text-faint" data-my-connections="empty">
        {emptyText}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="space-y-2" data-my-connections="grid">
      {error ? (
        <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map((row) => {
          const status = connectionRowStatus(row);
          const source = connectionRowSource(row);
          const shape = connectionRowShape(row);
          const description = connectionRowDescription(row);
          const busy = busyKey === row.key;
          const menuOpen = menuKey === row.key;
          const oauthServer = row.oauth ? row.mcpServerName : undefined;
          const authorizing = Boolean(oauthServer && ctl.authorizingServers.has(oauthServer));
          const primary =
            status === "connected" ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface-cardSolid px-2.5 py-1.5 text-xs font-medium text-text-strong transition hover:bg-surface-hover"
                onClick={() => ctl.chatWithConnection(row.name)}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("connectors.hub.actions.use")}
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-60"
                disabled={authorizing}
                data-connection-authorize={oauthServer}
                onClick={() =>
                  oauthServer
                    ? void ctl.authorizeOauth(oauthServer, row.name)
                    : row.kind === "native" && row.connectorId
                      ? ctl.openHandshake(row.connectorId)
                      : ctl.startChat(
                          buildNewConnectorChatDraft(t("connectors.hub.credentialDraft", { name: row.name })),
                        )
                }
              >
                {authorizing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                )}
                {status === "needs_credential"
                  ? t("connectors.hub.actions.fillCredential")
                  : status === "needs_auth"
                    ? t("connectors.hub.actions.authorize")
                    : t("connectors.hub.actions.reauth")}
              </button>
            );
          return (
            <div
              key={row.key}
              className="agx-market-card group relative flex items-start gap-3 rounded-xl border border-border bg-surface-cardSolid px-4 py-3.5"
              data-my-connection={row.key}
              data-connection-source={source}
            >
              {row.iconSrc ? (
                <MarketIcon name={row.name} iconSrc={row.iconSrc} className="h-11 w-11" />
              ) : (
                <LetterAvatar name={row.name} />
              )}
              <div className={`min-w-0 flex-1 ${status === "connected" && !menuOpen ? CTA_HOVER_PAD : "pr-[7.5rem]"}`}>
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="min-w-0 max-w-full truncate text-[14px] font-semibold tracking-tight text-text-strong">{row.name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[status]}`}
                    data-connection-status={status}
                  >
                    {status === "connected" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : null}
                    {t(`connectors.hub.status.${status}`)}
                  </span>
                  <span className="shrink-0 rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-muted">
                    {t(`connectors.hub.source.${source}`)}
                  </span>
                  {shape ? (
                    <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-text-faint">
                      {t(`connectors.hub.shape.${shape}`)}
                    </span>
                  ) : null}
                  {row.connectorKind === "database" && row.readOnly ? (
                    <span className="shrink-0 rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-400">
                      {t("connectors.hub.readOnly")}
                    </span>
                  ) : null}
                  </span>
                </div>
                {row.detail && row.detail !== row.name ? (
                  <div className="mt-0.5 truncate text-[11px] text-text-faint">{row.detail}</div>
                ) : null}
                <p
                  className={`mt-1.5 line-clamp-2 text-[13px] leading-[1.45] ${description ? "text-text-muted" : "text-text-faint"}`}
                >
                  {description || t("connectors.hub.noDescription")}
                </p>
              </div>

              <div className={status === "connected" && !menuOpen ? CTA_HOVER_ONLY : CTA_PINNED}>
                {primary}
                <div className="relative" data-connection-menu={row.key}>
                  <button
                    type="button"
                    className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border-strong bg-surface-cardSolid text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                    aria-label={t("connectors.hub.actions.more")}
                    aria-expanded={menuOpen}
                    onClick={() => {
                      setConfirmKey(null);
                      setMenuKey(menuOpen ? null : row.key);
                    }}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <MoreHorizontal className="h-4 w-4" aria-hidden />}
                  </button>
                  {menuOpen ? (
                    <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-border bg-surface-panel py-1 shadow-xl">
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
                        onClick={() => manage(row)}
                      >
                        {t("connectors.hub.actions.manage")}
                      </button>
                      {oauthServer ? (
                        <button
                          type="button"
                          className="block w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover disabled:opacity-50"
                          disabled={authorizing}
                          data-connection-reauth={oauthServer}
                          onClick={() => {
                            setMenuKey(null);
                            void ctl.authorizeOauth(oauthServer, row.name, { reauth: true });
                          }}
                        >
                          {t("connectors.hub.actions.reauth")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-xs text-rose-400 hover:bg-surface-hover disabled:opacity-50"
                        disabled={busy}
                        aria-label={t("connectors.hub.deleteAria", { name: row.name })}
                        onClick={() => (confirmKey === row.key ? void remove(row) : setConfirmKey(row.key))}
                      >
                        {confirmKey === row.key ? t("connectors.hub.actions.confirmDelete") : t("connectors.hub.actions.delete")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
