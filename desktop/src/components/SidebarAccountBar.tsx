import { Gauge, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { AccountIdentityControl } from "./AccountIdentityControl";
import { ThemeToggleButton } from "./TopbarLeftControls";

export function SidebarAccountBar() {
  const { t } = useTranslation("sidebar");
  const { t: tCommon } = useTranslation("common");
  const openSettings = useAppStore((s) => s.openSettings);
  const openTokenDashboard = useAppStore((s) => s.openTokenDashboard);

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--border-muted)] px-2 py-2">
      <AccountIdentityControl variant="pill" menuPlacement="up" className="min-w-0 flex-1" />
      <ThemeToggleButton />
      <button
        type="button"
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={() => openTokenDashboard()}
        title={t("account.tokenDashboard")}
        aria-label={t("account.tokenDashboard")}
      >
        <Gauge className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={() => openSettings()}
        title={tCommon("settings")}
        aria-label={tCommon("settings")}
      >
        <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
    </div>
  );
}
