/**
 * 精选分类大卡:按场景分类(研发工具/内容创作/数据分析/电商营销)展示入口卡,
 * 每张卡含分类名、描述与该分类下的示例条目,点击跳转到对应 tab + 分类筛选。
 */

import {
  BarChart3,
  Boxes,
  Code2,
  Palette,
  PenLine,
  Scale,
  Search,
  ShoppingBag,
  TrendingUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ALL_CATEGORIES,
  CATEGORY_META,
  type MarketCategory,
  type MarketplaceItem,
} from "./model";

/** 精选展示的分类顺序(4 张大卡,可按需调整)。 */
const FEATURED_CATEGORIES: MarketCategory[] = [
  "dev_tools",
  "content_creation",
  "data_analysis",
  "ecommerce",
];

const CATEGORY_ICONS: Record<MarketCategory, LucideIcon> = {
  dev_tools: Code2,
  content_creation: PenLine,
  data_analysis: BarChart3,
  ecommerce: ShoppingBag,
  finance: TrendingUp,
  legal: Scale,
  efficiency: Zap,
  ui_design: Palette,
  research: Search,
  other: Boxes,
};

export function FeaturedCategoryCards({
  items,
  onPickCategory,
}: {
  items: readonly MarketplaceItem[];
  onPickCategory: (category: MarketCategory) => void;
}) {
  const { t } = useTranslation("marketplace");
  return (
    <section aria-label={t("featured.categories")}>
      <div className="mb-2.5 text-sm font-semibold text-text-strong">
        {t("featured.categories")}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURED_CATEGORIES.map((cat) => {
          const meta = CATEGORY_META[cat];
          const Icon = CATEGORY_ICONS[cat];
          const samples = items
            .filter((it) => it.category === cat)
            .slice(0, 3)
            .map((it) => it.name);
          return (
            <button
              key={cat}
              type="button"
              data-market-category={cat}
              className="group flex flex-col gap-3 rounded-xl border border-border bg-surface-cardSolid p-4 text-left transition-colors hover:border-border-strong hover:bg-surface-cardSolidHover"
              onClick={() => onPickCategory(cat)}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-hover text-[rgb(var(--theme-color-rgb,59,130,246))]">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-text-strong">
                  {meta.label}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                  {meta.desc}
                </span>
              </span>
              {samples.length > 0 ? (
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {samples.map((name) => (
                    <span
                      key={name}
                      className="rounded bg-surface-hover px-1.5 py-0.5 text-[11px] text-text-muted"
                    >
                      {name}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="mt-1 text-[11px] text-text-faint">
                  {t("featured.noSamples")}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 供测试与外部调用:全部分类列表。 */
export { ALL_CATEGORIES, CATEGORY_META };
