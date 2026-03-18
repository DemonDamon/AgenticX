import { PanelLeftOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore } from "../store";
import { ModelPicker } from "./ModelPicker";

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function Topbar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const activeModel = useAppStore((s) => s.activeModel);
  const setActiveModel = useAppStore((s) => s.setActiveModel);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const activePane = useMemo(() => panes.find((pane) => pane.id === activePaneId), [activePaneId, panes]);
  const title = activePane?.avatarName ?? "Meta-Agent";

  return (
    <div className="agx-topbar">
      <div className={`agx-topbar-left ${sidebarCollapsed ? "agx-topbar-left--collapsed" : ""}`}>
        <button className="agx-topbar-btn" onClick={onToggleSidebar} title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}>
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </button>
        <span className="agx-topbar-title">{title}</span>
      </div>
      <div className="agx-topbar-right">
        <div className="relative">
          <button className="agx-topbar-btn" onClick={() => setModelPickerOpen((v) => !v)}>
            {activeModel || "未选模型"}
          </button>
          <ModelPicker
            open={modelPickerOpen}
            onClose={() => setModelPickerOpen(false)}
            onSelect={(provider, model) => {
              setActiveModel(provider, model);
              void window.agenticxDesktop.saveConfig({ activeProvider: provider, activeModel: model });
            }}
          />
        </div>
      </div>
    </div>
  );
}
