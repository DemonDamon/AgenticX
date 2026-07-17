import { Search } from "lucide-react";
import { openGlobalSearch } from "./global-search-events";

/** Icon-only Topbar trigger for global search (files & session history). */
export function GlobalSearchTrigger() {
  return (
    <button
      type="button"
      className="agx-topbar-btn agx-topbar-btn--icon-only"
      onClick={() => openGlobalSearch()}
      aria-label="搜索"
      title="搜索文件与历史对话"
    >
      <Search className="h-[17px] w-[17px]" strokeWidth={1.75} />
    </button>
  );
}
