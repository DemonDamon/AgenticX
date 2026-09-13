# reliability.posture Desktop GUI

**Plan-Id**: `2026-09-12-reliability-posture-desktop-gui`
**Plan-File**: `.cursor/plans/pending/2026-09-12-reliability-posture-desktop-gui.plan.md`
**Planned-with**: Grok 4.6
**Suggested-Impl-Model**: Composer 2.5
**Made-with**: Damon Li

第一阶段只引入了 `reliability.posture`（`strict` / `legacy`）的 env / YAML 开关。工作区规则要求用户可改配置必须有 Desktop 设置面板，本 plan 只登记落点，不在本阶段实现。

## 落点

- `desktop/src/components/SettingsPanel.tsx` 的 Automation / Runtime 分区（已有 `max_tool_rounds` / `max_taskspaces`，走 `saveRuntimeConfig` / `loadRuntimeConfig`）。在参数包里加一个 `reliability_posture` 键。
- 同步四处：
  - `desktop/electron/main.ts` 的 IPC handler（读/写 `~/.agenticx/config.yaml` 的 `reliability.posture`）
  - `desktop/electron/preload.ts`
  - `desktop/src/global.d.ts`
  - `SettingsPanel.tsx` 表单字段
- 控件：两态选择（严格 / 兼容），不要做成 `SettingsSwitch`。姿态不是布尔开关，后续可能加第三态。

## 提醒

改 `desktop/electron/main.ts` 后必须完整重启 `npm run dev`。`tsc --watch` 会重编 `dist-electron/`，主进程不热重载，只刷渲染进程看不到新 IPC。
