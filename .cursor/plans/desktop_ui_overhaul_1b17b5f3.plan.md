---
name: Desktop UI Overhaul
overview: 将 AgenticX Desktop 的 UI/UX 从当前粗糙状态提升到 CodexMonitor 级别的视觉品质，通过引入语义化 CSS 变量主题系统、CSS Grid 布局、设计系统原语、对话渲染管线增强，以及 Electron 窗口效果等手段，实现全面的视觉升级。
todos:
  - id: phase1-tokens
    content: "Phase 1.1-1.3: 创建 styles/ 目录 + tokens.css + themes/dark.css + themes/light.css，修改 tailwind.config.ts 引用 CSS 变量，修改 index.css 导入新样式"
    status: completed
  - id: phase1-theme-switch
    content: "Phase 1.4: 实现主题切换（data-theme 属性 + store.theme + SettingsPanel 主题选择）"
    status: completed
  - id: phase2-grid
    content: "Phase 2.1: 重写 App.tsx 布局为 CSS Grid（grid-template-columns: var(--sidebar-width) 1fr）"
    status: completed
  - id: phase2-resizer
    content: "Phase 2.2: 新增 SidebarResizer 组件（拖拽更新 --sidebar-width + 持久化）"
    status: completed
  - id: phase2-topbar
    content: "Phase 2.3: 新增 Topbar 组件（blur topbar + sidebar toggle + 会话名 + ModelPicker + 右面板 toggle）"
    status: completed
  - id: phase2-main-grid
    content: "Phase 2.4-2.5: 主内容区 Grid 布局 + SubAgentPanel 可折叠右面板"
    status: completed
  - id: phase3-ds
    content: "Phase 3: 创建 ds/ 设计系统原语（Button/Spinner/Shimmer/Modal/Toast/Panel），替换现有内联组件"
    status: completed
  - id: phase4-messages
    content: "Phase 4: 创建 messages/ 目录，实现 MessageRenderer 类型分发 + UserBubble/AssistantBubble/ToolCallCard/ReasoningBlock/WorkingIndicator"
    status: completed
  - id: phase5-composer
    content: "Phase 5: Composer 输入框增强（ComposerMetaBar + 半透明样式 + 优化间距）"
    status: completed
  - id: phase6-electron
    content: "Phase 6: Electron 窗口效果（vibrancy + transparent + Mica + reduced-transparency 降级）"
    status: completed
  - id: phase7-polish
    content: "Phase 7: 视觉 Polish（lucide-react 图标统一 + 动画令牌 + prefers-reduced-motion + 字体/滚动条优化）"
    status: completed
isProject: false
---

# AgenticX Desktop UI 全面升级 — 参考 CodexMonitor 设计语言

## 现状差距分析

对比图 1（AgenticX 当前）和图 2（CodexMonitor），核心差距：

- **主题系统**：AgenticX 仅 3 个硬编码 Tailwind 颜色（`#0b1020`, `#121a2d`, `#27304a`），无语义变量；CodexMonitor 有 80+ 语义 CSS 变量 + 4 主题 + `rgba()` 半透明层叠
- **布局**：AgenticX 用 `flex h-screen` 简单排列；CodexMonitor 用 CSS Grid + 可拖拽 Resizer + 折叠动画
- **消息渲染**：AgenticX 用简单文本 + Markdown；CodexMonitor 有 10+ 专用渲染器（ToolRow、DiffRow、ReasoningRow 等）
- **设计原语**：AgenticX 无统一 UI 组件库；CodexMonitor 有 Modal/Panel/Popover/Toast/Tooltip 全套原语
- **Topbar**：AgenticX 无顶栏；CodexMonitor 有 `backdrop-filter: blur(18px)` 的毛玻璃 Topbar
- **窗口效果**：AgenticX 无透明/模糊；CodexMonitor 用 Tauri vibrancy + 半透明 surface 实现 Liquid Glass

## 技术策略

保持 **Electron + React + Zustand + Tailwind** 技术栈不变，引入 CSS 变量主题层与 Tailwind 混合使用：

```
CSS 变量（语义） → Tailwind config extend → 组件中写 Tailwind 类 → 主题切换仅改变量值
```

## Phase 1: 主题基础设施（PoC）

**目标**：建立语义 CSS 变量系统，消除所有硬编码颜色

### 1.1 创建样式目录结构

```
desktop/src/styles/
  tokens.css          # 设计令牌（动画时长、缓动、z-index、缩放）
  themes/
    dark.css          # 暗色主题 — 直接参考 CodexMonitor themes.dark.css 的变量结构和色值
    light.css         # 亮色主题 — 参考 CodexMonitor themes.light.css
    dim.css           # 暗灰主题
  base.css            # 全局重置 + Grid 布局骨架
  animations.css      # 统一动画定义（shimmer、spinner、pulse）
```

**关键文件参考**：

- `[upstream/src/styles/ds-tokens.css](research/codedeepresearch/CodexMonitor/upstream/src/styles/ds-tokens.css)` — 58 行设计令牌
- `[upstream/src/styles/themes.dark.css](research/codedeepresearch/CodexMonitor/upstream/src/styles/themes.dark.css)` — 80+ 语义变量

### 1.2 修改 Tailwind 配置

在 `[desktop/tailwind.config.ts](desktop/tailwind.config.ts)` 中将硬编码颜色替换为 CSS 变量引用：

```typescript
colors: {
  text: { primary: 'var(--text-primary)', strong: 'var(--text-strong)', muted: 'var(--text-muted)', ... },
  surface: { sidebar: 'var(--surface-sidebar)', messages: 'var(--surface-messages)', card: 'var(--surface-card)', ... },
  border: { subtle: 'var(--border-subtle)', muted: 'var(--border-muted)', strong: 'var(--border-strong)', ... },
  status: { success: 'var(--status-success)', warning: 'var(--status-warning)', error: 'var(--status-error)' },
}
```

### 1.3 修改 index.css

在 `[desktop/src/index.css](desktop/src/index.css)` 中导入新样式文件，替换硬编码颜色（如 `bg-slate-900` → `bg-surface-card`）。

### 1.4 主题切换

- 在 `<html>` 上设置 `data-theme` 属性
- 在 Zustand store 中添加 `theme` 状态
- 在 SettingsPanel 中添加主题选择

---

## Phase 2: 布局重构

**目标**：从 flex 排列升级为 CSS Grid + Resizer 布局

### 2.1 App.tsx 布局改为 CSS Grid

当前 `[desktop/src/App.tsx](desktop/src/App.tsx)` L835：

```tsx
<div className="flex h-screen overflow-hidden bg-base">
```

改为：

```tsx
<div className="agx-app" data-theme={theme}>
```

对应 CSS（参考 CodexMonitor `base.css` L48-61）：

```css
.agx-app {
  display: grid;
  grid-template-columns: var(--sidebar-width, 260px) 1fr;
  height: 100vh;
  overflow: hidden;
  transition: grid-template-columns var(--ds-dur-slow) var(--ds-ease-out);
}
.agx-app.sidebar-collapsed {
  grid-template-columns: 0px 1fr;
}
```

### 2.2 SidebarResizer 组件

新增 `desktop/src/components/SidebarResizer.tsx`：

- 拖拽更新 CSS 变量 `--sidebar-width`
- 拖拽中添加 `is-resizing` 类禁用 transition
- 持久化到 localStorage

### 2.3 Topbar 组件

新增 `desktop/src/components/Topbar.tsx`：

- macOS 标题栏拖拽区 + `backdrop-filter: blur(18px)`
- 左侧：sidebar toggle + 当前会话名
- 右侧：ModelPicker（已有）+ 右面板 toggle
- 参考 CodexMonitor `main.css` L345-401 的 `.main-topbar` 样式

### 2.4 主内容区 Grid

主内容区改为 Grid（参考 `main.css` L1-13）：

```css
.agx-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--right-panel-width, 0px);
  grid-template-rows: var(--topbar-height, 44px) 1fr auto;
  min-height: 0;
}
```

### 2.5 右面板（SubAgentPanel）可折叠

- 默认收起（`--right-panel-width: 0`）
- 展开时带 `translateX` + `opacity` 动画（参考 `main.css` L1101-1106）

---

## Phase 3: 设计系统原语

**目标**：建立无业务逻辑的基础 UI 组件库

### 3.1 组件清单

新增 `desktop/src/components/ds/` 目录：


| 组件            | 参考                                         | 优先级 |
| ------------- | ------------------------------------------ | --- |
| `Button.tsx`  | CodexMonitor `buttons.css`                 | P0  |
| `Spinner.tsx` | `.working-spinner`                         | P0  |
| `Shimmer.tsx` | `.working-text` shimmer 效果                 | P0  |
| `Modal.tsx`   | `ds-modal.css` + `ModalShell.tsx`          | P1  |
| `Toast.tsx`   | `ds-toast.css` + `ToastPrimitives.tsx`     | P1  |
| `Panel.tsx`   | `ds-panel.css` + `PanelPrimitives.tsx`     | P1  |
| `Popover.tsx` | `ds-popover.css` + `PopoverPrimitives.tsx` | P2  |
| `Tooltip.tsx` | `ds-tooltip.css`                           | P2  |
| `Badge.tsx`   | 状态徽标                                       | P2  |


### 3.2 替换现有组件

- `ConfirmDialog.tsx` → 使用 `Modal` 原语
- `SettingsPanel.tsx` → 使用 `Panel` 原语
- 各处内联 spinner → 使用 `Spinner` 组件

---

## Phase 4: 对话渲染增强

**目标**：从纯文本渲染升级为类型化消息管线

### 4.1 消息渲染器架构

新增 `desktop/src/components/messages/` 目录：

```
messages/
  MessageRenderer.tsx     # 类型分发入口
  UserBubble.tsx          # 用户消息气泡（蓝色半透明）
  AssistantBubble.tsx     # 助手消息（透明 + Markdown）
  ToolCallCard.tsx        # 工具调用卡片（可折叠 header + 输入/输出）
  ReasoningBlock.tsx      # 推理过程（可折叠、淡色）
  SystemNotice.tsx        # 系统通知（居中、小字）
  SubAgentUpdate.tsx      # 子智能体状态更新
  InlineConfirmCard.tsx   # 内联确认（替代弹窗）
  WorkingIndicator.tsx    # shimmer 文本 + spinner + 计时器
```

参考 CodexMonitor 的渲染管线：

- `[upstream/src/features/messages/components/MessageRows.tsx](research/codedeepresearch/CodexMonitor/upstream/src/features/messages/components/MessageRows.tsx)`
- `[upstream/src/styles/messages.css](research/codedeepresearch/CodexMonitor/upstream/src/styles/messages.css)`

### 4.2 关键视觉效果

- **用户气泡**：`background: var(--surface-bubble-user)` — 蓝色半透明
- **工具调用卡片**：`border: 1px solid var(--border-subtle)` + 图标 + 状态指示器 + 可折叠
- **Working 指示器**：shimmer 文本动画 + spinner + 计时器（参考 `messages.css` L44-86）
- **消息间距**：与 CodexMonitor 对齐（`padding: 12px 24px`）

### 4.3 需要的后端协调

当前 SSE 事件类型 `token | tool_call | tool_result` 基本足够，`MessageRenderer` 在前端做类型映射，无需后端改动。

---

## Phase 5: Composer 输入框增强

**目标**：从简单输入框升级为 CodexMonitor 级 Composer

- 添加 `ComposerMetaBar`：显示上下文文件、token 用量、模型信息
- 改善输入框样式：`backdrop-filter` + 半透明背景 + 柔和边框
- 参考 `[upstream/src/styles/composer.css](research/codedeepresearch/CodexMonitor/upstream/src/styles/composer.css)`

---

## Phase 6: Electron 窗口效果

**目标**：实现 macOS vibrancy / Windows Mica 效果

修改 `[desktop/electron/main.ts](desktop/electron/main.ts)`：

```typescript
const mainWindow = new BrowserWindow({
  titleBarStyle: 'hiddenInset',     // 已有
  vibrancy: 'under-window',         // macOS 模糊
  visualEffectState: 'followWindow',
  backgroundMaterial: 'mica',       // Windows 11
  backgroundColor: '#00000000',     // 透明
  transparent: true,
});
```

配合前端 `background: transparent` + `rgba()` 半透明 surface 变量。

---

## Phase 7: 视觉 Polish

- 统一图标库为 `lucide-react`（CodexMonitor 已验证）
- 全局动画使用 `--ds-dur-*` / `--ds-ease-*` 令牌
- 支持 `prefers-reduced-motion`
- 字体优化（`system-ui` + `PingFang SC`）
- 自定义滚动条样式升级

---

## 不做的事情（严格边界）

- 不迁移到 Tauri（保持 Electron）
- 不重写状态管理（保持 Zustand）
- 不照搬 CodexMonitor "工作区" 概念（保持 AgenticX "分身" 概念）
- 不实现 Git 集成（P2 后续）
- 不实现终端面板（P2 后续）
- 不重构后端逻辑

---

## 风险与缓解

- **Tailwind + CSS 变量冲突**：先在独立分支 Phase 1 验证 PoC
- **Electron vibrancy 平台差异**：提供 `reduced-transparency` 降级模式（参考 CodexMonitor `base.css` L3-27）
- **大组件迁移**：ChatPane（1372 行）和 ChatView（1318 行）逐步拆分，每个 Phase 独立提交
- **回滚策略**：每个 Phase 独立分支，Phase 1-2 完成后做 checkpoint

