import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { openGlobalSearch } from "./global-search-events";

/** Icon-only Topbar trigger for global search (files & session history). */
export function GlobalSearchTrigger() {
  const { t } = useTranslation("sidebar");
  return (
    <button
      type="button"
      className="agx-topbar-btn agx-topbar-btn--icon-only"
      onClick={() => openGlobalSearch()}
      aria-label={t("search.aria")}
      title={t("search.title")}
    >
      <Search className="h-[17px] w-[17px]" strokeWidth={1.75} />
    </button>
  );
}
