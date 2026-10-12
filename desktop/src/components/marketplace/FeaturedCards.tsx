/**
 * 精选推荐卡:三张淡色底座 + 手绘双色图标卡,点击跳转到目标 Tab 并预选筛选 chip。
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
        {FEATURED_CARDS.map((card) => (
          <button
            key={card.id}
            type="button"
            className="group flex items-start gap-3 rounded-xl border border-border bg-surface-cardSolid p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-cardSolidHover"
            onClick={() => onPick(card.target)}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${card.tint}`}
            >
              <img src={card.iconSrc} alt="" className="h-[22px] w-[22px]" draggable={false} />
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
        ))}
      </div>
    </section>
  );
}
