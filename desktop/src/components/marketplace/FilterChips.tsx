/**
 * 筛选 chips:技能/插件 Tab 与连接器页共用。
 * 选中态 = 主题色浅填充 + 主题色文字(.agx-filter-chip-active,浅/深主题见 index.css);未选 = 实底 + 描边。
 * 固定语义 tag(all/recommended/enterprise/third_party/mcp/tool)走 i18n;
 * 类目等自由文本 tag 原样展示。
 */

import { useTranslation } from "react-i18next";

const LABEL_KEYS: Record<string, string> = {
  all: "filters.all",
  recommended: "filters.recommended",
  enterprise: "filters.enterprise",
  third_party: "filters.thirdParty",
  mcp: "filters.mcp",
  tool: "filters.tool",
};

export function FilterChips({
  tags,
  active,
  onSelect,
  labels,
  ariaLabel,
}: {
  tags: readonly string[];
  active: string;
  onSelect: (tag: string) => void;
  /** 覆盖展示名（如连接器页「推荐 / 官方 / 企业」）；优先于内置语义 tag。 */
  labels?: Readonly<Record<string, string>>;
  ariaLabel?: string;
}) {
  const { t } = useTranslation("marketplace");
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={ariaLabel}>
      {tags.map((tag) => {
        const key = LABEL_KEYS[tag];
        const label = labels?.[tag] ?? (key ? t(key) : tag);
        const isActive = tag === active;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={isActive}
            data-filter-chip={tag}
            className={`agx-filter-chip rounded-full border px-3 py-1 text-xs transition-colors ${
              isActive
                ? "agx-filter-chip-active font-medium"
                : "border-border bg-surface-cardSolid text-text-muted hover:bg-surface-hover hover:text-text-strong"
            }`}
            onClick={() => onSelect(tag)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
