import { Moon, PanelLeft, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../store";
import { GlobalSearchTrigger } from "./global-search/GlobalSearchTrigger";

type Props = {
  onToggleSidebar: () => void;
  toggleTitle: string;
  className?: string;
};

export function ThemeToggleButton() {
  const { t } = useTranslation("sidebar");
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const isDarkLike = theme === "dark" || theme === "dim";
  const themeLabel = isDarkLike ? t("topbar.switchToLight") : t("topbar.switchToDark");

  return (
    <button
      type="button"
      className="agx-topbar-btn agx-topbar-btn--icon-only"
      onClick={() => setTheme(isDarkLike ? "light" : "dark")}
      title={themeLabel}
      aria-label={themeLabel}
    >
      {isDarkLike ? (
        <Sun className="h-[18px] w-[18px]" strokeWidth={1.8} />
      ) : (
        <Moon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      )}
    </button>
  );
}

/** Search + sidebar-toggle, shared between Topbar (collapsed) and the expanded sidebar's top row. */
export function TopbarLeftControls({ onToggleSidebar, toggleTitle, className }: Props) {
  return (
    <div className={className}>
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
