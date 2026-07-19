# Work Panel Expand（Trae 式展开面板）

Planned-with: cursor-grok-4.5-high-fast  
Suggested-Impl-Model: cursor-grok-4.5-high-fast

## Goal

分身/Meta 顶栏去掉交付 / 工作区 / 记忆图谱入口，搜索置左；在「关闭窗格」左侧加入 Trae 式「展开面板」按钮。点击后打开右侧工作台：任务摘要（待办 / 任务产物 / 子智能体 / 参考信息）+ 可开终端 / 浏览器 / 工作区 Tab。

## In scope

- `ChatPane` 顶栏重排与按钮删除
- 新建 `WorkPanel`，承接原 `WorkspacePanel` 槽位（`taskspacePanelOpen`）
- `+` 菜单：任务摘要 / 浏览器 / 终端 / 工作区（对齐 Trae）
- 任务摘要 Tab 可关闭（pill 左侧圆形 ✕）；关闭后无标签时展示「从这里开始」空态入口
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
3. `+` 可开任务摘要 / 终端 / 浏览器 / 工作区 Tab
4. 任务摘要 pill 左侧圆形 ✕ 可关闭；关闭且无其它 Tab 时主区显示「从这里开始」（任务摘要 / 浏览器 / 终端）
5. 工作台顶栏右上：`Maximize2`「展开面板」在「隐藏工具面板」**左侧**；展开后工作台占满主画布、聊天收为底部浮层输入（Trae Work，非整窗左右互挤）；悬停文案「恢复面板宽度」；隐藏/关闭工作台时重置展开态
6. 派生子智能体后可在「子智能体」区看到卡片；点成员会打开工作台摘要（若摘要已关则自动重开）
7. 「新建交付任务」仍调用 `openDeliveryPanel()`
