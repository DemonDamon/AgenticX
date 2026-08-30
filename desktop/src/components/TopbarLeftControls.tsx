import { Moon, PanelLeft, Sun } from "lucide-react";
import { useAppStore } from "../store";
import { GlobalSearchTrigger } from "./global-search/GlobalSearchTrigger";

type Props = {
  onToggleSidebar: () => void;
  toggleTitle: string;
  className?: string;
};

/** Theme + search + sidebar-toggle, shared between Topbar (collapsed) and the expanded sidebar's top row. */
export function TopbarLeftControls({ onToggleSidebar, toggleTitle, className }: Props) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const isDarkLike = theme === "dark" || theme === "dim";

  return (
    <div className={className}>
      <button
        type="button"
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={() => setTheme(isDarkLike ? "light" : "dark")}
        title={isDarkLike ? "切换到亮色" : "切换到暗色"}
        aria-label={isDarkLike ? "切换到亮色" : "切换到暗色"}
      >
        {isDarkLike ? (
          <Sun className="h-[18px] w-[18px]" strokeWidth={1.8} />
        ) : (
          <Moon className="h-[18px] w-[18px]" strokeWidth={1.8} />
        )}
      </button>
      <GlobalSearchTrigger />
      <button
        type="button"
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
