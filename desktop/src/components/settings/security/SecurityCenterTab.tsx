import { forwardRef, useImperativeHandle, useRef } from "react";
import { TriangleAlert } from "lucide-react";
import { Panel } from "../../ds/Panel";
import { SETTINGS_HINT_CLASS, SETTINGS_LABEL_CLASS } from "../../ds/settings-typography";
import { SettingsDropdown } from "../../ds/SettingsDropdown";
import {
  RUN_MODE_OPTIONS,
  runModeLabel,
  type RunMode,
} from "../../../constants/confirm-strategy-options";
import {
  PermissionsAdvancedPanel,
  type PermissionsAdvancedPanelHandle,
} from "./PermissionsAdvancedPanel";
import { WorkspaceIsolationPanel } from "./WorkspaceIsolationPanel";
import { ComputerUsePanel } from "./ComputerUsePanel";
import { SkillGuardPanel } from "./SkillGuardPanel";
import { HooksSection } from "./HooksSection";

function RunModeDropdown({
  value,
  onChange,
}: {
  value: RunMode;
  onChange: (mode: RunMode) => void;
}) {
  return (
    <SettingsDropdown
      value={value}
      displayLabel={runModeLabel(value)}
      options={RUN_MODE_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
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
};

export const SecurityCenterTab = forwardRef<SecurityCenterTabHandle, Props>(function SecurityCenterTab(
  { runMode, onRunModeChange },
  ref,
) {
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
      <Panel title="权限">
        <div className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <div className={SETTINGS_LABEL_CLASS}>运行模式</div>
            <p className={`mt-0.5 ${SETTINGS_HINT_CLASS}`}>
              {current.description}
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
            <span>此模式仅自动执行明确标记为低风险的操作。高风险、破坏性、桌面操控和未知风险操作仍会逐次询问。</span>
          </div>
        ) : null}
        <div className="mt-4 border-t border-[var(--border-muted)] pt-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className={SETTINGS_LABEL_CLASS}>凭据安全</div>
              <p className={`mt-1 ${SETTINGS_HINT_CLASS}`}>
                请勿在对话中发送 API Key、Token 或密码；请前往对应服务设置中配置。
              </p>
            </div>
          </div>
        </div>
      </Panel>
      <PermissionsAdvancedPanel ref={permissionsRef} />
      <ComputerUsePanel />
      <SkillGuardPanel />
      <Panel title="钩子守卫" collapsible defaultCollapsed>
        <HooksSection />
      </Panel>
    </>
  );
});
