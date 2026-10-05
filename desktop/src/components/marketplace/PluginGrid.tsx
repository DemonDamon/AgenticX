/**
 * 插件 Tab 的卡片网格:MCP 连接器与精选工具混合,图标统一走 MarketIcon
 * (上游 logo 优先,无图回退渐变底座 + 行业图标)。
 * MCP 主按钮(安装/使用)都打开详情浮层;工具走 Meta-Agent 安装或「使用」回对话。
 */

import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, MessageSquarePlus, SquarePlus } from "lucide-react";
import type { MarketPluginItem } from "./model";
import { MarketIcon } from "./MarketIcon";

type Props = {
  items: readonly MarketPluginItem[];
  promptBusy: boolean;
  onOpenMcpDetail: (item: MarketPluginItem) => void;
  onInstallTool: (item: MarketPluginItem) => void;
  onUseTool: (item: MarketPluginItem) => void;
};

export function PluginGrid({ items, promptBusy, onOpenMcpDetail, onInstallTool, onUseTool }: Props) {
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
      {items.map((item) => (
        <div
          key={item.key}
          className="flex min-h-[148px] flex-col rounded-xl border border-border bg-surface-card px-4 py-3.5 transition-colors hover:bg-surface-hover/40"
          data-market-plugin={item.name}
        >
          <div className="flex items-center gap-2.5">
            <MarketIcon name={item.name} logoUrl={item.logoUrl} iconSrc={item.iconSrc} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold tracking-tight text-text-strong">
                {item.name}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-text-faint">
                <span className="shrink-0 rounded border border-border px-1 py-0.5">
                  {t(item.kind === "mcp" ? "badge.mcp" : "badge.tool")}
                </span>
                <span className="shrink-0 text-border">·</span>
                <span className="truncate font-normal">
                  {item.kind === "mcp" ? item.serverId : item.provider}
                </span>
              </div>
            </div>
            {item.installed ? (
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
            {item.kind === "mcp" ? (
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
            ) : item.installed ? (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => onUseTool(item)}
              >
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
                {t("actions.use")}
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                disabled={promptBusy}
                onClick={() => onInstallTool(item)}
              >
                {promptBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                )}
                {promptBusy ? t("actions.installing") : t("actions.install")}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
