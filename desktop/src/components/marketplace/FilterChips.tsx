/**
 * 筛选 chips:技能/插件 Tab 共用。
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
}: {
  tags: readonly string[];
  active: string;
  onSelect: (tag: string) => void;
}) {
  const { t } = useTranslation("marketplace");
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group">
      {tags.map((tag) => {
        const key = LABEL_KEYS[tag];
        const label = key ? t(key) : tag;
        const isActive = tag === active;
        return (
          <button
            key={tag}
            type="button"
            aria-pressed={isActive}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              isActive
                ? "border-accent/60 bg-accent/10 font-medium text-text-strong"
                : "border-border bg-surface-card text-text-muted hover:bg-surface-hover hover:text-text-strong"
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
