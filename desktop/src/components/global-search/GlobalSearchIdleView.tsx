import type { LucideIcon } from "lucide-react";
import { FileText, FolderOpen, History, LayoutGrid } from "lucide-react";
import type { GlobalSearchCategory } from "../../hooks/useGlobalSearch";

export type SearchSuggestion = {
  label: string;
  query: string;
  category?: GlobalSearchCategory;
};

type SuggestionCard = {
  id: string;
  title: string;
  icon: LucideIcon;
  items: SearchSuggestion[];
};

/** 推荐卡片：不用粗 border，仅用极淡内描边区分层级。 */
const SUGGESTION_CARD =
  "flex min-w-0 flex-col rounded-xl bg-surface-card/45 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--border-muted)]";

/** 图标容器：背景与描边均走 Near 主题色变量，随用户主题切换。 */
const THEME_ICON_BOX =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(var(--theme-color-rgb),0.14)] shadow-[inset_0_0_0_1px_rgba(var(--theme-color-rgb),0.18)]";
const THEME_ICON_GLYPH = "h-[18px] w-[18px] text-[rgb(var(--theme-color-rgb))]";
const THEME_ICON_GLYPH_SM = "h-3.5 w-3.5 text-[rgb(var(--theme-color-rgb))]";

const SUGGESTION_CARDS: SuggestionCard[] = [
  {
    id: "documents",
    title: "搜文档",
    icon: FileText,
    items: [
      { label: "README", query: "readme", category: "documents" },
      { label: ".plan", query: "plan", category: "documents" },
      { label: "AGENTS.md", query: "AGENTS", category: "documents" },
    ],
  },
  {
    id: "folders",
    title: "搜文件夹",
    icon: FolderOpen,
    items: [
      { label: "Desktop", query: "Desktop", category: "folders" },
      { label: "Documents", query: "Documents", category: "folders" },
      { label: "Downloads", query: "Downloads", category: "folders" },
    ],
  },
  {
    id: "applications",
    title: "搜应用软件",
    icon: LayoutGrid,
    items: [
      { label: "微信", query: "微信", category: "applications" },
      { label: "腾讯会议", query: "腾讯会议", category: "applications" },
      { label: "Cursor", query: "Cursor", category: "applications" },
    ],
  },
];

type Props = {
  history: string[];
  onPickHistory: (value: string) => void;
  onClearHistory: () => void;
  onPickSuggestion: (suggestion: SearchSuggestion) => void;
};

export function GlobalSearchIdleView({
  history,
  onPickHistory,
  onClearHistory,
  onPickSuggestion,
}: Props) {
  return (
    <div>
      {history.length > 0 ? (
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-subtle">
              <span className={THEME_ICON_BOX}>
                <History className={THEME_ICON_GLYPH_SM} strokeWidth={2} />
              </span>
              最近搜索
            </div>
            <button
              type="button"
              className="text-[11px] text-text-faint transition hover:text-text-subtle"
              onClick={onClearHistory}
            >
              清空
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {history.map((item) => (
              <button
                key={item}
                type="button"
                className="rounded-lg bg-surface-card/50 px-2.5 py-1 text-[12px] text-text-subtle shadow-[inset_0_0_0_1px_var(--border-muted)] transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => onPickHistory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-3 text-[13px] font-semibold text-text-strong">尝试搜索以下内容</div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SUGGESTION_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.id} className={SUGGESTION_CARD}>
              <div className="mb-3 flex items-center gap-2.5">
                <span className={THEME_ICON_BOX}>
                  <Icon className={THEME_ICON_GLYPH} strokeWidth={2} />
                </span>
                <span className="text-[13px] font-semibold text-text-strong">{card.title}</span>
              </div>
              <ul className="flex flex-col gap-0.5">
                {card.items.map((item) => (
                  <li key={item.query}>
                    <button
                      type="button"
                      className="w-full rounded-md px-1 py-1.5 text-left text-[13px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                      onClick={() => onPickSuggestion(item)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-center text-[11px] text-text-faint">
        支持文件名与路径匹配 · 右键结果可添加工作区或引用到对话
      </p>
    </div>
  );
}
