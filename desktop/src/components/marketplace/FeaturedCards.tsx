/**
 * 精选推荐卡:三张渐变图标卡,点击跳转到目标 Tab 并预选筛选 chip。
 */

import { useTranslation } from "react-i18next";
import { FEATURED_CARDS, type FeaturedTarget } from "../../data/marketplace-config";

export function FeaturedCards({ onPick }: { onPick: (target: FeaturedTarget) => void }) {
  const { t } = useTranslation("marketplace");
  return (
    <section aria-label={t("featured.sectionTitle")}>
      <div className="mb-2.5 text-sm font-semibold text-text-strong">
        {t("featured.sectionTitle")}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {FEATURED_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              className="group flex items-start gap-3 rounded-xl border border-border bg-surface-card p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover/40"
              onClick={() => onPick(card.target)}
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${card.gradient} text-white shadow-sm`}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-text-strong">
                  {t(`featured.${card.id}.title`)}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                  {t(`featured.${card.id}.desc`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
