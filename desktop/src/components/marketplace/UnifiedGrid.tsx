/**
 * 统一条目卡片网格:「全部」「MCP」「专家」「指令」Tab 共用。
 * Comate 密度向:横向 icon | title+badge+desc | CTA，描述 2–3 行，悬停软阴影抬升。
 * - 图标与标题行顶对齐(非整块文字垂直居中)。
 * - 连接器/网关已接通 → badge「已连接」(含 kind=mcp+gateway 精选卡);技能/MCP 插件等仍用「已安装」。
 * - 「连接」「使用」悬停显:静态零宽(absolute + opacity-0),描述占满卡宽;悬停 / :focus-within
 *   再显 CTA,文字列 group-hover:pr 让出按钮宽,避免叠字。「安装」「重新授权」等常显走文档流。
 * 卡片按 kind 出 badge,CTA 分派:
 * - mcp:未装 → 打开详情浮层安装;已装 → 「使用」回对话
 * - connector:网关 → 安装弹层;已接线原生 → 握手;可表单 stub → 新建连接器;oauth stub → 暂未接线;
 *   已有实例(去重后唯一)→「使用」直达对话,不弹实例选择、不再新建
 * - skill:已装 → 「使用」;registry → 扫描安装;推荐位 install → Meta-Agent 安装;official_site → 外链
 * - agent/command:本机资产恒已装 → 「使用」
 */

import type { ReactNode } from "react";
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
  /** 已有连接实例(原生已连 / 模板已建):「使用」直达对话。缺省回退 onConnectNative。 */
  onUseConnector?: (item: MarketplaceItem) => void;
};

/** 悬停 CTA:绝对定位、静态零占位;悬停/键盘聚焦再显。配合文字列 group-hover:pr 防叠字。 */
const CTA_HOVER_ONLY =
  "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";

/** 悬停 CTA 出现时文字列右侧让出的宽度(约「连接/使用」+ icon 按钮)。 */
const CTA_HOVER_PAD =
  "pr-0 group-hover:pr-[5.5rem] group-focus-within:pr-[5.5rem]";

/** 已连接软绿徽章(Comate 填充感);技能/MCP「已安装」共用同一视觉。 */
const STATUS_BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400";

function CtaButton({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "amber";
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40";
  const styles =
    variant === "amber"
      ? "bg-amber-500 text-white hover:opacity-90"
      : variant === "ghost"
        ? "border border-border-strong bg-surface-cardSolid text-text-strong hover:bg-surface-hover"
        : "bg-btnPrimary text-btnPrimary-text hover:bg-btnPrimary-hover";
  return (
    <button type="button" className={`${base} ${styles} ${className}`} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

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
  onUseConnector,
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
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {items.map((item) => {
        const skillKey = `${item.source}:${item.name}`;
        const isInstalling = item.kind === "skill" && installingKey === skillKey;
        const isQueued = item.kind === "skill" && queuedKeys.includes(skillKey);
        const isOfficialSite = item.kind === "skill" && item.cta === "official_site";
        const subtitle =
          item.kind === "command"
            ? `/${item.name}`
            : (item.provider ?? "");

        /** 连接器(含 kind=mcp+gateway 精选卡)健康已装 →「已连接」;其余仍「已安装」。 */
        const isConnectorLike = item.kind === "connector" || item.gateway === true;
        const showConnectedBadge =
          isConnectorLike && item.installed && item.health !== "degraded";
        const showInstalledBadge =
          !showConnectedBadge && item.installed && !(isConnectorLike && item.health === "degraded");

        let cta: ReactNode = null;
        /** 「连接」「使用」悬停显;「安装」「重新授权」等常显。 */
        let ctaHoverOnly = false;

        if (item.kind === "connector") {
          const action = resolveConnectorConnectAction({
            kind: item.kind,
            wired: item.wired,
            gateway: item.gateway,
            connectorId: item.connectorId,
            authType: item.authType,
          });
          if (action === "gateway") {
            if (item.installed) {
              ctaHoverOnly = true;
              cta = (
                <CtaButton variant="ghost" onClick={() => onOpenMcpDetail(item)}>
                  <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                  {t("actions.use")}
                </CtaButton>
              );
            } else {
              ctaHoverOnly = true;
              cta = (
                <CtaButton onClick={() => onOpenMcpDetail(item)}>
                  <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                  {t("actions.connect")}
                </CtaButton>
              );
            }
          } else if (item.installed && item.health !== "degraded") {
            // 已有唯一实例(原生已连 / 模板已建):直达使用,不再走新建或握手。
            ctaHoverOnly = true;
            cta = (
              <CtaButton
                variant="ghost"
                onClick={() => (onUseConnector ? onUseConnector(item) : onConnectNative?.(item))}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.use")}
              </CtaButton>
            );
          } else if (action === "create_form") {
            ctaHoverOnly = true;
            cta = (
              <CtaButton onClick={() => onCreateConnector?.(item)}>
                <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.connect")}
              </CtaButton>
            );
          } else if (action === "unwired_sheet") {
            cta = (
              <CtaButton variant="ghost" onClick={() => onUnwiredConnector?.(item)}>
                {t("actions.notWired")}
              </CtaButton>
            );
          } else if (item.health === "degraded") {
            cta = (
              <CtaButton variant="amber" onClick={() => onConnectNative?.(item)}>
                <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.reauth")}
              </CtaButton>
            );
          } else {
            ctaHoverOnly = true;
            cta = (
              <CtaButton onClick={() => onConnectNative?.(item)}>
                <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.connect")}
              </CtaButton>
            );
          }
        } else if (item.kind === "mcp") {
          if (item.installed) {
            ctaHoverOnly = true;
            cta = (
              <CtaButton variant="ghost" onClick={() => onOpenMcpDetail(item)}>
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.use")}
              </CtaButton>
            );
          } else if (item.gateway) {
            // 网关精选卡 kind=mcp+gateway:与连接器一致用「连接」悬停显(非「安装」常显)。
            ctaHoverOnly = true;
            cta = (
              <CtaButton onClick={() => onOpenMcpDetail(item)}>
                <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.connect")}
              </CtaButton>
            );
          } else {
            cta = (
              <CtaButton onClick={() => onOpenMcpDetail(item)}>
                <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.install")}
              </CtaButton>
            );
          }
        } else if (item.kind === "skill") {
          if (item.installed) {
            ctaHoverOnly = true;
            cta = (
              <CtaButton variant="ghost" onClick={() => onUse(item)}>
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.use")}
              </CtaButton>
            );
          } else if (isInstalling || isQueued) {
            cta = (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t("actions.installing")}
              </span>
            );
          } else if (isOfficialSite) {
            cta = (
              <CtaButton
                variant="ghost"
                onClick={() => {
                  if (item.officialUrl) window.open(item.officialUrl, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t("actions.openSite")}
              </CtaButton>
            );
          } else {
            cta = (
              <CtaButton
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
              </CtaButton>
            );
          }
        } else {
          ctaHoverOnly = true;
          cta = (
            <CtaButton variant="ghost" onClick={() => onUse(item)}>
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
              {t("actions.use")}
            </CtaButton>
          );
        }

        return (
          <div
            key={item.key}
            className="agx-market-card group relative flex items-start gap-3 rounded-xl border border-border bg-surface-cardSolid px-4 py-3.5"
            data-market-item={item.name}
            data-market-kind={item.kind}
          >
            <MarketIcon
              name={item.name}
              logoUrl={item.logoUrl}
              iconSrc={item.iconSrc}
              className="h-11 w-11"
            />

            <div className={`min-w-0 flex-1 ${ctaHoverOnly ? CTA_HOVER_PAD : ""}`}>
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="truncate text-[14px] font-semibold tracking-tight text-text-strong">
                  {item.kind === "command" ? `/${item.name}` : item.name}
                </div>
                <span className="shrink-0 rounded border border-border px-1 py-0.5 text-[10px] text-text-faint">
                  {t(`badge.${item.kind}`)}
                </span>
                {item.kind === "connector" && item.health === "degraded" ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                    {t("badge.needsReauth")}
                  </span>
                ) : showConnectedBadge ? (
                  <span className={STATUS_BADGE}>
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    {t("badge.connected")}
                  </span>
                ) : showInstalledBadge ? (
                  <span className={STATUS_BADGE}>
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    {t("badge.installed")}
                  </span>
                ) : null}
              </div>
              {subtitle && item.kind !== "command" ? (
                <div className="mt-0.5 truncate text-[11px] text-text-faint">{subtitle}</div>
              ) : null}
              <p className="mt-1.5 line-clamp-3 min-h-[3.9em] text-[13px] leading-[1.45] text-text-muted">
                {item.description}
              </p>
            </div>

            {/* Hover-only: absolute zero-width at rest. Always-visible (安装等): in-flow. */}
            {ctaHoverOnly ? (
              <div className={CTA_HOVER_ONLY}>{cta}</div>
            ) : (
              <div className="flex shrink-0 self-center items-center">{cta}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
