/**
 * 技能 Tab 的卡片网格:官方推荐位 + registry 技能统一渲染。
 * 安装动作三分支:registry → 扫描安装状态机;推荐位 cta=install → Meta-Agent 安装;
 * 推荐位 cta=official_site → 打开官网。已安装 → 「使用」回到对话并预填草稿。
 */

import { useTranslation } from "react-i18next";
import { CheckCircle2, ExternalLink, Loader2, MessageSquarePlus, SquarePlus } from "lucide-react";
import type { MarketSkillItem } from "./model";
import { MarketIcon } from "./MarketIcon";

type Props = {
  items: readonly MarketSkillItem[];
  installingKey: string | null;
  queuedKeys: readonly string[];
  /** Meta-Agent 安装提示词流程进行中(禁用推荐位安装按钮)。 */
  promptBusy: boolean;
  onInstallRegistry: (item: MarketSkillItem) => void;
  onInstallRecommended: (item: MarketSkillItem) => void;
  onUse: (item: MarketSkillItem) => void;
};

export function SkillGrid({
  items,
  installingKey,
  queuedKeys,
  promptBusy,
  onInstallRegistry,
  onInstallRecommended,
  onUse,
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
        const isInstalling = installingKey === `${item.source}:${item.name}`;
        const isQueued = queuedKeys.includes(`${item.source}:${item.name}`);
        const isOfficialSite = item.cta === "official_site";
        return (
          <div
            key={item.key}
            className="flex min-h-[148px] flex-col rounded-xl border border-border bg-surface-card px-4 py-3.5 transition-colors hover:bg-surface-hover/40"
            data-market-skill={item.name}
          >
            <div className="flex items-center gap-2.5">
              <MarketIcon name={item.name} iconSrc={item.iconSrc} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold tracking-tight text-text-strong">
                  {item.name}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-text-faint">
                  <span
                    className={
                      item.tier === "enterprise"
                        ? "shrink-0 font-medium text-[#07C160]"
                        : "shrink-0"
                    }
                  >
                    {item.tier === "enterprise"
                      ? t("filters.enterprise")
                      : item.origin === "recommended"
                        ? t("filters.recommended")
                        : t("filters.thirdParty")}
                  </span>
                  <span className="shrink-0 text-border">·</span>
                  <span className="truncate font-normal">{item.provider}</span>
                  {item.category ? (
                    <>
                      <span className="shrink-0 text-border">·</span>
                      <span className="truncate font-normal">{item.category}</span>
                    </>
                  ) : null}
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

            <div className="mt-auto flex items-center justify-between gap-2 pt-2.5">
              <span className="truncate text-[10px] text-text-faint">
                {item.origin === "registry" && item.source ? `${item.source}${item.version ? ` · v${item.version}` : ""}` : ""}
              </span>
              {item.installed ? (
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
                  onClick={() => {
                    if (item.origin === "registry") onInstallRegistry(item);
                    else onInstallRecommended(item);
                  }}
                >
                  <SquarePlus className="h-3.5 w-3.5" aria-hidden />
                  {t("actions.install")}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
