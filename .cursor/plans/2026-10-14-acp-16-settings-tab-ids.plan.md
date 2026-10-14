# acp-16 设置页去掉没有面板的页签

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

`SETTINGS_TAB_IDS` 里的每一项都能在设置左侧导航打开。`hooks` 和 `workspace` 没有独立面板：钩子在安全中心，工作目录在账号页。把这两个无效 id 从设置页签里拿掉。

## 落点

- `desktop/src/settings-tab.ts`：删除 `hooks` 与 `workspace`。
- `desktop/src/settings-tab.test.ts`：每个剩余 id 都能在 `SettingsPanel` 的导航定义里找到。

## AC

- `cd desktop && npx vitest run src/settings-tab.test.ts src/settings-email-nav.test.ts` 通过。
- `isSettingsTab("hooks")` 与 `isSettingsTab("workspace")` 为 false。
