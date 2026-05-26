import { Search } from "lucide-react";
import { openGlobalSearch } from "./global-search-events";

export function GlobalSearchTrigger() {
  return (
    <div className="shrink-0 px-3 pb-1.5 pt-0.5">
      <button
        type="button"
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-transparent bg-surface-card px-2.5 text-left text-[13px] text-text-faint transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        onClick={() => openGlobalSearch()}
        aria-label="搜索电脑文件"
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
        <span className="flex-1 truncate">搜索</span>
      </button>
    </div>
  );
}
