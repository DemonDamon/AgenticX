# 子规划 D · 定时任务主区视图（AutomationView）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: composer-2.5-fast

> 主规划：`.cursor/plans/2026-07-16-near-nav-redesign.plan.md`
> 依赖：子规划 A（`mainView`、`AutomationView` 空壳、`MainViewShell`）。
> 目标：把 A 的 `AutomationView` 空壳实现为「在右侧主区内联展示设置页『定时任务』内容」，以复用为主、低风险。

---

## In scope
- 实现 `desktop/src/components/automation/AutomationView.tsx`：在主区内联渲染现有 `AutomationTab`（`desktop/src/components/automation/AutomationTab.tsx`），外加标题区，视觉与其它主区视图（分身墙/项目页）对齐。

## Out of scope
- 不改 `AutomationTab` / `TaskList` / `TaskFormPanel` / `TemplateGrid` 的内部逻辑与后端 IPC。
- 不改设置页（`SettingsPanel` 的 automation Tab 保留，主区视图是新增入口）。
- 不改 `DeliveryConfigSection`（该组件在设置页 automation Tab 里与 `AutomationTab` 并列，见 `SettingsPanel.tsx` L9652–9657）——**决策**：主区视图只放 `AutomationTab`（任务模板 + 任务列表 + 抑制睡眠），投递配置仍留设置页，避免主区过载；若用户要求再补。

---

## FR / 精确落点

### FR-D1 · AutomationView 实现
文件：`desktop/src/components/automation/AutomationView.tsx`
```tsx
import { AutomationTab } from "./AutomationTab";
// 复用 A 的 MainViewShell（若 A 未导出通用壳，则本组件自带同款外层容器：可滚动、px-6 py-5、暗色背景）

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
```
- `AutomationTab` 已自包含加载/保存/删除/立即执行/模板/抑制睡眠（见 `AutomationTab.tsx` L90–247），直接挂载即可工作。
- 注意 `AutomationTab` 内部用 `<Panel>`（`desktop/src/components/ds/Panel.tsx`）与 `TaskFormPanel`（弹层）——弹层在主区内也能正常覆盖显示（`fixed inset-0`），无需改动。
- 主区宽度较大，`TemplateGrid` 的 `sm:grid-cols-2 lg:grid-cols-3`（TemplateGrid L38）会自然利用空间，视觉良好。

### FR-D2 · 视觉一致性
- 外层容器与分身墙/项目页统一（同用 A 的 `MainViewShell` 或同款样式），保证三视图切换时留白/滚动一致。
- 标题区风格与 B/C 对齐（标题 + 一句副标题）。

---

## 验收
- **AC-D1** 点侧栏「定时任务」→ 主区内联显示定时任务页（非弹窗），可见「从模板快速创建」「我的自动化任务」「系统/抑制睡眠」。
- **AC-D2** 在主区内可新建/编辑/删除任务、切换启用、立即执行、开关抑制睡眠，行为与设置页 automation Tab 一致。
- **AC-D3** `TaskFormPanel` 弹层在主区视图下正常弹出与保存。
- **AC-D-BUILD** `cd desktop && npm run build` 通过；`ReadLints` 无新增错误。
- **AC-D-SMOKE** `AGX_DEV_PORT=5713 npm run dev`：切到定时任务视图、增删改任务、立即执行、切回其它视图，无控制台报错。

## 备注
- 侧栏「定时任务」按钮走 `setMainView("automation")`（A 已接线），不再走 `openSettings()`；设置页入口保留不删。
