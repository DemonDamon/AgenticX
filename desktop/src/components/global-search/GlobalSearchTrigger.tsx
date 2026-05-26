import { Search } from "lucide-react";
import { openGlobalSearch } from "./global-search-events";

export function GlobalSearchTrigger() {
  return (
    <div className="shrink-0 px-3 pb-2 pt-1">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-left text-sm text-text-faint transition hover:border-border hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => openGlobalSearch()}
        aria-label="搜索电脑文件"
      >
        <Search className="h-4 w-4 shrink-0 text-text-subtle" />
        <span className="flex-1 truncate">搜索</span>
        <kbd className="hidden rounded border border-border-subtle px-1.5 py-0.5 text-[10px] text-text-faint sm:inline">
          ⌘K
        </kbd>
      </button>
    </div>
  );
}
