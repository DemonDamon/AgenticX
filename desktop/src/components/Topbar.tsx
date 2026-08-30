import { ArrowLeft, Gauge, Settings } from "lucide-react";
import { useAppStore } from "../store";
import { AccountIdentityControl } from "./AccountIdentityControl";
import { ThemeToggleButton, TopbarLeftControls } from "./TopbarLeftControls";

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function Topbar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const openSettings = useAppStore((s) => s.openSettings);
  const openTokenDashboard = useAppStore((s) => s.openTokenDashboard);
  const mainView = useAppStore((s) => s.mainView);
  const chatReturnSnapshot = useAppStore((s) => s.chatReturnSnapshot);
  const returnToPreviousChat = useAppStore((s) => s.returnToPreviousChat);
  const hideTopbarBorder = mainView !== "chat";

  if (!sidebarCollapsed && !chatReturnSnapshot) {
    return null;
  }

  return (
    <div className={`agx-topbar${hideTopbarBorder ? " agx-topbar--no-border" : ""}`}>
      <div className="agx-topbar-left">
        {sidebarCollapsed ? (
          <TopbarLeftControls
            onToggleSidebar={onToggleSidebar}
            toggleTitle="展开侧栏"
            className="agx-topbar-left-controls agx-topbar-left-controls--collapsed"
          />
        ) : null}
        {chatReturnSnapshot ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-text-faint transition-colors hover:bg-surface-hover hover:text-text-strong"
            onClick={returnToPreviousChat}
            aria-label="返回"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>返回</span>
          </button>
        ) : null}
      </div>
      {sidebarCollapsed ? (
        <div className="agx-topbar-right">
          <ThemeToggleButton />
          <button
            className="agx-topbar-btn agx-topbar-btn--icon-only"
            type="button"
            onClick={() => openTokenDashboard()}
            title="Token 消耗看板"
            aria-label="Token 消耗看板"
          >
            <Gauge className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          <button
            className="agx-topbar-btn agx-topbar-btn--icon-only"
            type="button"
            onClick={() => openSettings()}
            title="设置"
            aria-label="设置"
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          <AccountIdentityControl variant="topbar" menuPlacement="down" />
        </div>
      ) : (
        <div className="agx-topbar-right" />
      )}
    </div>
  );
}
