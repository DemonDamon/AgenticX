import { PanelLeftOpen } from "lucide-react";

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function Topbar({ sidebarCollapsed, onToggleSidebar }: Props) {
  return (
    <div className="agx-topbar">
      <div className={`agx-topbar-left ${sidebarCollapsed ? "agx-topbar-left--collapsed" : ""}`}>
        <button className="agx-topbar-btn" onClick={onToggleSidebar} title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}>
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
