/**
 * 统一条目卡片网格:「全部」「MCP」「专家」「指令」Tab 共用。
 * 卡片按 kind 出 badge,CTA 分派:
 * - mcp:未装 → 打开详情浮层安装;已装 → 「使用」回对话
 * - connector:网关 → 安装弹层;已接线原生 → 握手;可表单 stub → 新建连接器;oauth stub → 暂未接线
 * - skill:已装 → 「使用」;registry → 扫描安装;推荐位 install → Meta-Agent 安装;official_site → 外链
 * - agent/command:本机资产恒已装 → 「使用」
 */

import { useTranslation } from "react-i18next";
import { CheckCircle2, ExternalLink, Loader2, MessageSquarePlus, SquarePlus } from "lucide-react";
import type { MarketplaceItem } from "./model";
import { MarketIcon } from "./MarketIcon";
import { resolveConnectorConnectAction } from "../settings/connectors/create-connector-model";

type Props = {
  items: readonly MarketplaceItem[];
  /** registry 扫描安装状态机(技能卡片安装中/排队态)。 */
  installingKey?: string | null;
  queuedKeys?: readonly string[];
  /** Meta-Agent 安装提示词流程进行中(禁用推荐位安装按钮)。 */
  promptBusy: boolean;
  onOpenMcpDetail: (item: MarketplaceItem) => void;
  onInstallSkill: (item: MarketplaceItem) => void;
  onUse: (item: MarketplaceItem) => void;
  /** 已接线原生连接器:打开设置握手,不进聊天。 */
  onConnectNative?: (item: MarketplaceItem) => void;
  /** stub + form auth:打开「新建连接器」弹层。 */
  onCreateConnector?: (item: MarketplaceItem) => void;
  /** oauth/无表单 stub:打开「暂未接线」说明。 */
  onUnwiredConnector?: (item: MarketplaceItem) => void;
};

export function UnifiedGrid({
  items,
  installingKey = null,
  queuedKeys = [],
  promptBusy,
  onOpenMcpDetail,
  onInstallSkill,
  onUse,
  onConnectNative,
  onCreateConnector,
  onUnwiredConnector,
}: Props) {
  const { t } = useTranslation("marketplace");

  if (items.length === 0) {
    return (
      <div className="py-14 text-center">
        <div className="text-sm text-text-muted">{t("empty.title")}</div>
        <div className="mt-1 text-xs text-text-faint">{t("empty.desc")}</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const skillKey = `${item.source}:${item.name}`;
        const isInstalling = item.kind === "skill" && installingKey === skillKey;
        const isQueued = item.kind === "skill" && queuedKeys.includes(skillKey);
        const isOfficialSite = item.kind === "skill" && item.cta === "official_site";
        const subtitle =
          item.kind === "command"
            ? `/${item.name}`
            : (item.provider ?? "");
        return (
          <div
            key={item.key}
            className="flex min-h-[148px] flex-col rounded-xl border border-border bg-surface-cardSolid px-4 py-3.5 transition-colors hover:bg-surface-cardSolidHover"
            data-market-item={item.name}
            data-market-kind={item.kind}
          >
            <div className="flex items-center gap-2.5">
              <MarketIcon name={item.name} logoUrl={item.logoUrl} iconSrc={item.iconSrc} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold tracking-tight text-text-strong">
                  {item.kind === "command" ? `/${item.name}` : item.name}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-text-faint">
                  <span className="shrink-0 rounded border border-border px-1 py-0.5">
                    {t(`badge.${item.kind}`)}
                  </span>
                  {subtitle ? (
                    <>
                      <span className="shrink-0 text-border">·</span>
                      <span className="truncate font-normal">{subtitle}</span>
                    </>
                  ) : null}
                </div>
              </div>
              {item.kind === "connector" && item.health === "degraded" ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                  {t("badge.needsReauth")}
                </span>
              ) : item.installed ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {t("badge.installed")}
                </span>
              ) : null}
            </div>

            <p className="mt-2 line-clamp-2 min-h-8 text-[12px] leading-4 text-text-muted">
              {item.description}
            </p>

            <div className="mt-auto flex items-center justify-end gap-2 pt-2.5">
              {item.kind === "connector" ? (
                (() => {
                  const action = resolveConnectorConnectAction({
                    kind: item.kind,
                    wired: item.wired,
                    gateway: item.gateway,
                    connectorId: item.connectorId,
                    authType: item.authType,
                  });
                  if (action === "gateway") {
                    return (
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                        onClick={() => onOpenMcpDetail(item)}
                      >
                        {item.installed ? (
                          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {item.installed ? t("actions.manage") : t("actions.connect")}
                      </button>
                    );
                  }
                  if (action === "create_form") {
                    return (
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                        onClick={() => onCreateConnector?.(item)}
                      >
                        <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                        {t("actions.connect")}
                      </button>
                    );
                  }
                  if (action === "unwired_sheet") {
                    return (
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                        onClick={() => onUnwiredConnector?.(item)}
                      >
                        {t("actions.notWired")}
                      </button>
                    );
                  }
                  return (
                    <button
                      type="button"
                      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 ${
                        item.health === "degraded" ? "bg-amber-500" : "bg-accent"
                      }`}
                      onClick={() => onConnectNative?.(item)}
                    >
                      {item.health === "degraded" ? (
                        <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                      ) : item.installed ? (
                        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {item.health === "degraded"
                        ? t("actions.reauth")
                        : item.installed
                          ? t("actions.manage")
                          : t("actions.connect")}
                    </button>
                  );
                })()
              ) : item.kind === "mcp" ? (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                  onClick={() => onOpenMcpDetail(item)}
                >
                  {item.installed ? (
                    <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {item.installed ? t("actions.use") : t("actions.install")}
                </button>
              ) : item.kind === "skill" ? (
                item.installed ? (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => onUse(item)}
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                    {t("actions.use")}
                  </button>
                ) : isInstalling || isQueued ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-faint">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {t("actions.installing")}
                  </span>
                ) : isOfficialSite ? (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => {
                      if (item.officialUrl) window.open(item.officialUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {t("actions.openSite")}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                    disabled={item.origin === "recommended" && promptBusy}
                    onClick={() => onInstallSkill(item)}
                  >
                    {promptBusy && item.origin === "recommended" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {promptBusy && item.origin === "recommended"
                      ? t("actions.installing")
                      : t("actions.install")}
                  </button>
                )
              ) : (
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                  onClick={() => onUse(item)}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                  {t("actions.use")}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
