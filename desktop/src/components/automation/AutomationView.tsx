import { MainViewShell } from "../ds/MainViewShell";
import { AutomationTab } from "./AutomationTab";

/** Main-area view for scheduled tasks — reuses the settings AutomationTab. */
export function AutomationView() {
  return (
    <MainViewShell>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-text-strong">定时任务</h2>
        <p className="mt-1 text-sm text-text-muted">让 Near 按计划自动为你工作。</p>
      </div>
      <AutomationTab />
    </MainViewShell>
  );
}
