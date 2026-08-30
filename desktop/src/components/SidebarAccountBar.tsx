import { Gauge, Settings } from "lucide-react";
import { useAppStore } from "../store";
import { AccountIdentityControl } from "./AccountIdentityControl";

export function SidebarAccountBar() {
  const openSettings = useAppStore((s) => s.openSettings);
  const openTokenDashboard = useAppStore((s) => s.openTokenDashboard);

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-[var(--border-muted)] px-2 py-2">
      <AccountIdentityControl variant="pill" menuPlacement="up" className="min-w-0 flex-1" />
      <button
        type="button"
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={() => openTokenDashboard()}
        title="Token 消耗看板"
        aria-label="Token 消耗看板"
      >
        <Gauge className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={() => openSettings()}
        title="设置"
        aria-label="设置"
      >
        <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
    </div>
  );
}
