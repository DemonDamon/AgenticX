---
name: Workspace Panel Refactor
overview: 将全局 SubAgent 面板拆解为每个 ChatPane 内嵌的"工作区"面板（上下分栏：文件树 + Spawns 列表），同时去掉 Topbar 的 Agents 按钮和全局右侧面板。
todos:
  - id: rename-to-workspace
    content: ChatPane 中 "目录" 文案改为 "工作区"
    status: in_progress
  - id: create-workspace-panel
    content: 新建 WorkspacePanel.tsx：上下分栏（文件树 + Spawns 列表），复用 TaskspacePanel 文件树逻辑 + SubAgentCard
    status: pending
  - id: file-preview-popover
    content: 文件预览改为浮层弹出，不再常驻占位
    status: pending
  - id: remove-global-panel
    content: 删除 App.tsx 中全局 SubAgentPanel、agx-right-panel-slot、Topbar Agents 按钮
    status: pending
  - id: wire-subagent-ops
    content: 在 ChatPane 内直接实现 cancel/retry/confirm subagent 操作，避免多层 props
    status: pending
isProject: false
---

# 工作区面板重构：SubAgent 内嵌到每个窗格

## 当前架构

```mermaid
graph LR
  subgraph AppLayout [App Grid]
    Sidebar["AvatarSidebar"]
    MainShell["Main Shell"]
    RightPanel["SubAgentPanel\n(全局)"]
  end
  MainShell --> Topbar
  MainShell --> Content
  Content --> PaneManager
  Content --> RightPanel
  PaneManager --> ChatPane1
  PaneManager --> ChatPane2
  ChatPane1 --> TaskspacePanel["Taskspace\n(文件树+预览)"]
```

SubAgent 是全局右侧面板，与具体窗格无关 -- 多窗格时看不出哪个 spawn 属于谁。

## 目标架构

```mermaid
graph LR
  subgraph AppLayout [App Grid]
    Sidebar["AvatarSidebar"]
    MainShell["Main Shell"]
  end
  MainShell --> Topbar["Topbar\n(无 Agents 按钮)"]
  MainShell --> PaneManager
  PaneManager --> ChatPane1
  PaneManager --> ChatPane2
  ChatPane1 --> WorkspacePanel1["工作区面板"]
  ChatPane2 --> WorkspacePanel2["工作区面板"]
  subgraph WorkspacePanel1 [WorkspacePanel]
    FileTree["文件树"]
    SpawnsList["Spawns 列表"]
  end
```

每个 ChatPane 打开"工作区"时，右侧面板上半部分是文件树，下半部分是该窗格的 Spawns 列表（可拖拽调节分栏比例）。

## 关键变更

### 1. 重命名 "目录" 为 "工作区"

- [ChatPane.tsx](desktop/src/components/ChatPane.tsx) L1093: 按钮文案 `目录` -> `工作区`
- 仅文案变更，不改变量名

### 2. 将 SubAgent 数据绑定到 Pane

当前 `subAgents` 在 Zustand store 中是全局数组。不重构数据模型，而是在渲染时按 `sessionId` 过滤：

- 每个 `SubAgent` 已有 `sessionId` 字段
- 每个 `ChatPane` 已有 `pane.sessionId`
- 在 WorkspacePanel 中：`subAgents.filter(s => s.sessionId === pane.sessionId)` 即可过滤出该窗格的 spawn

无需改 store 结构。

### 3. 新建 WorkspacePanel 组件

新建 [desktop/src/components/WorkspacePanel.tsx](desktop/src/components/WorkspacePanel.tsx)，替代当前 `TaskspacePanel` 在 ChatPane 中的位置。

布局：上下分栏（可拖拽 divider）

```
+---------------------------+
|  [文件树 Tab] [刷新] [+]  |  <-- 顶部工具栏
|  /src                     |
|    agent.py               |  <-- 文件树区域（flex: 1）
|    chat.py                |
|---------------------------|  <-- 可拖拽分隔条
|  Spawns (2)               |  <-- Spawns 标题 + 计数
|  [SubAgentCard]           |  <-- SubAgent 卡片列表
|  [SubAgentCard]           |
+---------------------------+
```

- 上半部分：复用现有 `TaskspacePanel` 的文件树逻辑（去掉底部的文件预览区域）
- 下半部分：复用现有 `SubAgentCard` 组件渲染 spawns 列表
- 文件预览：点击文件时弹出浮层（popover/modal），而不是常驻占位

### 4. 从 TaskspacePanel 中拆出文件预览

当前 `TaskspacePanel` 底部有常驻的 `文件预览` 区域。改为：

- 默认不显示预览区域
- 点击文件时，在 WorkspacePanel 上方弹出一个浮层覆盖式的预览面板（absolute 定位），带关闭按钮
- 预览面板的代码高亮逻辑（Prism）保持不变

### 5. 删除全局 SubAgentPanel 和右侧面板

- [App.tsx](desktop/src/App.tsx): 删除 `<SubAgentPanel>` 和 `agx-right-panel-slot` 的渲染
- [App.tsx](desktop/src/App.tsx): 删除 `subPanelOpen` state 和 `--right-panel-width` CSS 变量控制
- [Topbar.tsx](desktop/src/components/Topbar.tsx): 删除 Agents 按钮及相关 props（`rightPanelOpen`, `onToggleRightPanel`）
- [base.css](desktop/src/styles/base.css): 删除 `.agx-right-panel-slot` 和 `.agx-subagent-panel` 样式
- **不删除** `SubAgentPanel.tsx` 文件本身（保留备用），但不再在 App 中渲染

### 6. ChatPane 中接入 WorkspacePanel

在 [ChatPane.tsx](desktop/src/components/ChatPane.tsx) 中：

- 将当前的 `{pane.taskspacePanelOpen ? <TaskspacePanel .../> : null}` 替换为 `{pane.taskspacePanelOpen ? <WorkspacePanel .../> : null}`
- 传入 props: `sessionId`, `activeTaskspaceId`, `subAgents`（已按 sessionId 过滤）, `onCancel`, `onRetry`, `onChat`, `onSelect`, `onConfirmResolve`
- 按钮文案 `目录` -> `工作区`

### 7. SubAgent 操作回调传递

当前 `cancelSubAgent` / `retrySubAgent` / `resolveSubAgentConfirm` 等函数定义在 App.tsx。需要：

- 通过 `onOpenConfirm` 类似的 props 链传到 ChatPane
- 或者直接在 ChatPane 中读 store + 调 API（ChatPane 已有 `apiBase` / `apiToken`）

推荐后者：ChatPane 已有直接调 API 的模式（SSE streaming），SubAgent 操作逻辑可以直接内联，避免多层 props 传递。

## 不做的事情

- 不改 Zustand store 的 `subAgents` 数据结构（保持全局数组，渲染时 filter）
- 不改后端 SubAgent 生命周期逻辑
- 不改 SubAgentCard 组件本身
- 不重构 TaskspacePanel 内部的文件树/刷新/添加逻辑（只拆出预览部分）
