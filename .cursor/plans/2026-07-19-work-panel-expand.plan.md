# Work Panel Expand（Trae 式展开面板）

Planned-with: cursor-grok-4.5-high-fast  
Suggested-Impl-Model: cursor-grok-4.5-high-fast

## Goal

分身/Meta 顶栏去掉交付 / 工作区 / 记忆图谱入口，搜索置左；在「关闭窗格」左侧加入 Trae 式「展开面板」按钮。点击后打开右侧工作台：任务摘要（待办 / 任务产物 / 子智能体 / 参考信息）+ 可开终端 / 浏览器 / 工作区 Tab。

## In scope

- `ChatPane` 顶栏重排与按钮删除
- 新建 `WorkPanel`，承接原 `WorkspacePanel` 槽位（`taskspacePanelOpen`）
- `+` 菜单：浏览器 / 终端 / 工作区
- 子智能体展示迁入任务摘要（不再渲染独立 `SpawnsColumn`）
- 交付入口迁入「任务产物」区
- 快捷键 `⌘⌃B`

## Out of scope

- 记忆图谱能力删除（仅去掉顶栏入口）
- 待办 / 参考信息真实数据源（v1 空态占位）
- 浏览器完整浏览器 chrome（仅地址栏 + iframe）

## Key files

- `desktop/src/components/work-panel/WorkPanel.tsx`（新建）
- `desktop/src/components/ChatPane.tsx`（顶栏 + 侧栏接线）
- `desktop/src/components/WorkspacePanel.tsx`（`hidePanelClose`）

## AC

1. 顶栏无 Boxes / FolderOpen / Share2 / Bot；搜索在动作区最左；`PanelRight` 紧邻关闭窗格左侧
2. 点击展开或 `⌘⌃B` 开合右侧工作台
3. `+` 可开终端 / 浏览器 / 工作区 Tab
4. 派生子智能体后可在「子智能体」区看到卡片；点成员会打开工作台摘要
5. 「新建交付任务」仍调用 `openDeliveryPanel()`
