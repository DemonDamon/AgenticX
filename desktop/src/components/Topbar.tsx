import { PanelLeftOpen } from "lucide-react";
import { useMemo } from "react";
import { useAppStore } from "../store";

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function Topbar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const activePane = useMemo(() => panes.find((pane) => pane.id === activePaneId), [activePaneId, panes]);
  const title = activePane?.avatarName ?? "Machi";

  return (
    <div className="agx-topbar">
      <div className={`agx-topbar-left ${sidebarCollapsed ? "agx-topbar-left--collapsed" : ""}`}>
        <button className="agx-topbar-btn" onClick={onToggleSidebar} title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}>
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
        <span className="agx-topbar-title">{title}</span>
      </div>
    </div>
  );
}
