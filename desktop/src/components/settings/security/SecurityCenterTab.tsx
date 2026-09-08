import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsDropdown } from "../../ds/SettingsDropdown";
import {
  RUN_MODE_OPTIONS,
  type RunMode,
} from "../../../constants/confirm-strategy-options";
import type { SettingsFocus } from "../../../settings-tab";
import {
  PermissionsAdvancedPanel,
  type PermissionsAdvancedPanelHandle,
} from "./PermissionsAdvancedPanel";
import { WorkspaceIsolationPanel } from "./WorkspaceIsolationPanel";
import { ComputerUsePanel } from "./ComputerUsePanel";
import { SkillGuardPanel } from "./SkillGuardPanel";
import { HooksSection } from "./HooksSection";

const RUN_MODE_LABEL_KEY: Record<RunMode, string> = {
  ask: "security.runModeAskLabel",
  allowlist: "security.runModeAllowlistLabel",
  auto: "security.runModeAutoLabel",
};

const RUN_MODE_DESC_KEY: Record<RunMode, string> = {
  ask: "security.runModeAskDesc",
  allowlist: "security.runModeAllowlistDesc",
  auto: "security.runModeAutoDesc",
};

function RunModeDropdown({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (mode: RunMode) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsDropdown
      value={value}
      displayLabel={t(RUN_MODE_LABEL_KEY[value])}
      options={RUN_MODE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(RUN_MODE_LABEL_KEY[option.value]),
      }))}
      onChange={(next) => onChange(next as RunMode)}
      className="w-44 shrink-0"
      size="compact"
      menuPortal
    />
  );
}

export type SecurityCenterTabHandle = {
  /** 转发内部 PermissionsAdvancedPanel 的 flushPermissions，供窗口底部「保存」统一触发。 */
  flushPermissions: () => Promise<{ ok: boolean; error?: string }>;
};

type Props = {
  runMode: RunMode;
  onRunModeChange: (mode: RunMode) => Promise<void> | void;
  /** 从运行模式「自定义」进入时，滚到路径/命令/工具规则并展示用法说明。 */
  focus?: SettingsFocus;
  focusSeq?: number;
};

export const SecurityCenterTab = forwardRef<SecurityCenterTabHandle, Props>(function SecurityCenterTab(
  { runMode, onRunModeChange, focus, focusSeq = 0 },
  ref,
) {
  const { t } = useTranslation("settings");
  const permissionsRef = useRef<PermissionsAdvancedPanelHandle>(null);
  const current = RUN_MODE_OPTIONS.find((option) => option.value === runMode) ?? RUN_MODE_OPTIONS[0]!;

  useImperativeHandle(
    ref,
    () => ({
      flushPermissions: async () => {
        return (
          (await permissionsRef.current?.flushPermissions?.()) ?? { ok: true }
        );
      },
    }),
    [],
  );

  return (
    <>
      {/* 确认框不是安全边界，OS 隔离才是；所以隔离在最上面，确认在其后。 */}
      <WorkspaceIsolationPanel />
      <Panel title={t("security.permissionsTitle")}>
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <div className={SETTINGS_LABEL_CLASS}>{t("security.runMode")}</div>
            <p className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>
              {t(RUN_MODE_DESC_KEY[current.value])}
            </p>
          </div>
          <RunModeDropdown
            value={runMode}
            onChange={(next) => void onRunModeChange(next)}
          />
        </div>
        {runMode === "auto" ? (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-text-subtle">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" />
            <span>{t("security.autoWarn")}</span>
          </div>
        ) : null}
        <div className="mt-4 border-t border-[var(--border-muted)] pt-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className={SETTINGS_LABEL_CLASS}>{t("security.credTitle")}</div>
              <p className={`mt-1 ${SETTINGS_HINT_CLASS}`}>
                {t("security.credHint")}
              </p>
            </div>
          </div>
        </div>
      </Panel>
      <PermissionsAdvancedPanel
        ref={permissionsRef}
        showRulesGuide={focus === "security-rules"}
        highlightKey={focusSeq}
      />
      <ComputerUsePanel />
      <SkillGuardPanel />
      <Panel title={t("security.hooksGuardTitle")} collapsible defaultCollapsed>
        <HooksSection />
      </Panel>
    </>
  );
});
