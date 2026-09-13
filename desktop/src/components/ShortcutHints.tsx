import { useTranslation } from "react-i18next";

export function ShortcutHints() {
  const { t } = useTranslation("sidebar");
  return (
    <div className="mt-2 text-[11px] text-text-faint">
      <span className="mr-3">{t("shortcuts.search")}</span>
      <span className="mr-3">{t("shortcuts.settings")}</span>
      <span className="mr-3">{t("shortcuts.clear")}</span>
      <span className="mr-3">{t("shortcuts.switchMode")}</span>
      <span className="mr-3">{t("shortcuts.planMode")}</span>
      <span>{t("shortcuts.history")}</span>
    </div>
  );
}
