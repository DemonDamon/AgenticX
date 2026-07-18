import { PanelLeft } from "lucide-react";
import { GlobalSearchTrigger } from "./global-search/GlobalSearchTrigger";

type Props = {
  onToggleSidebar: () => void;
  toggleTitle: string;
  className?: string;
};

/** Sidebar-toggle + search cluster, shared between Topbar (collapsed) and the expanded sidebar's top row. */
export function TopbarLeftControls({ onToggleSidebar, toggleTitle, className }: Props) {
  return (
    <div className={className}>
      <GlobalSearchTrigger />
      <button
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={onToggleSidebar}
        title={toggleTitle}
        aria-label={toggleTitle}
      >
        <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
    </div>
  );
}
