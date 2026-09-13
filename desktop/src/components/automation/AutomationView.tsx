import { MainViewShell } from "../ds/MainViewShell";
import { useTranslation } from "react-i18next";
import { AutomationTab } from "./AutomationTab";

/** Main-area view for scheduled tasks — reuses the settings AutomationTab. */
export function AutomationView() {
  const { t } = useTranslation("workspace");
  return (
    <MainViewShell>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-strong">{t("automation.title")}</h2>
        <p className="mt-1 text-sm text-text-muted">{t("automation.subtitle")}</p>
      </div>
      <AutomationTab />
    </MainViewShell>
  );
}
