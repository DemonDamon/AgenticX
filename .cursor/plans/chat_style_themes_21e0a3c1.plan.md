---
name: Chat Style Themes
overview: 在通用设置中新增"聊天风格"选项，提供 3 套个性化聊天气泡主题（IM 风格 / 终端风格 / 极简风格），每套主题控制气泡形状、颜色、头像显示和对齐方式，提升用户使用粘性。
todos:
  - id: store-chat-style
    content: store.ts 新增 ChatStyle 类型与 chatStyle/setChatStyle 状态，含 localStorage 持久化
    status: completed
  - id: theme-variables
    content: dark/light/dim CSS 主题文件中增加 3 套风格的气泡色彩变量
    status: completed
  - id: im-bubble
    content: 新建 ImBubble.tsx：左右对齐 + 头像 + 气泡尖角 + 绿色用户泡，替代当前 UserBubble/AssistantBubble
    status: completed
  - id: terminal-line
    content: 新建 TerminalLine.tsx：等宽前缀风格，无气泡无头像，`>` 和 `┃` 前缀
    status: completed
  - id: clean-block
    content: 新建 CleanBlock.tsx：全宽分隔线风格，用户竖线指示器 + 助手微弱背景
    status: completed
  - id: message-renderer
    content: MessageRenderer 按 chatStyle 分发到 3 个变体组件
    status: completed
  - id: chatview-adapt
    content: ChatView（Lite 模式）同步适配 chatStyle
    status: completed
  - id: settings-panel
    content: SettingsPanel 通用 tab 新增聊天风格下拉选择器
    status: completed
  - id: build-verify
    content: 构建验证：npm run build 通过，3 套风格在 dark/light 主题下视觉正确
    status: completed
isProject: false
---

# 聊天风格主题方案

## 现状分析

当前聊天气泡非常单调：

- 用户消息：左对齐 + 蓝色半透明背景，无头像
- 助手消息：右对齐 + 白色微透明背景，无头像
- 工具消息：居中卡片
- 没有 IM 类应用的"对话感"，更像日志流

关键文件：

- [desktop/src/components/messages/UserBubble.tsx](desktop/src/components/messages/UserBubble.tsx) — 用户气泡
- [desktop/src/components/messages/AssistantBubble.tsx](desktop/src/components/messages/AssistantBubble.tsx) — 助手气泡
- [desktop/src/components/messages/MessageRenderer.tsx](desktop/src/components/messages/MessageRenderer.tsx) — 消息分发
- [desktop/src/store.ts](desktop/src/store.ts) — 全局状态
- [desktop/src/components/SettingsPanel.tsx](desktop/src/components/SettingsPanel.tsx) — 设置面板
- [desktop/src/styles/themes/dark.css](desktop/src/styles/themes/dark.css) / light.css / dim.css — 主题变量

## 3 套聊天风格设计

### Style 1: "IM" — 微信/Telegram 风格（默认推荐）

```
        ┌──────────────────────┐
 [A]    │  助手回复内容         │
        │  markdown rendered   │
        └──────────────────────┘
                               ┌──────────────┐    [U]
                               │  用户消息     │
                               └──────────────┘
```

- 用户消息**靠右** + 绿色/青色气泡 + 右侧圆形头像（首字母）
- 助手消息**靠左** + 深色/浅色气泡 + 左侧圆形头像（分身头像或 M 图标）
- 气泡带"尖角"指向头像（CSS `::before` 三角）
- 工具消息居中、紧凑卡片样式不变
- 参考：微信绿色用户泡、Telegram 蓝色用户泡

### Style 2: "Terminal" — 终端/开发者风格

```
  > user: 你好，请帮我看下这个文件
  ┃ assistant (bailian/qwen-plus):
  ┃ 好的，我来看看...
  ┃ [tool] file_read: src/main.ts
  ┃ 文件内容如下...
```

- 无气泡、无头像
- 所有消息左对齐，等宽字体
- 用户行前缀 `>` + 高亮色，助手行前缀 `┃` + 普通色
- 工具调用行用 `[tool]` 前缀 + 暗色
- 适合开发者 / 极客用户

### Style 3: "Clean" — 极简/Notion 风格

```
  ┌─────────────────────────────────┐
  │ 用户消息（全宽，浅色分隔线）     │
  ├─────────────────────────────────┤
  │ 助手回复（全宽，略深背景）       │
  │ markdown rendered               │
  └─────────────────────────────────┘
```

- 无气泡、无头像
- 消息全宽、用分隔线区分角色
- 用户消息行高亮左边框（竖线指示器）
- 助手消息微弱背景色
- 适合阅读长文本 / 报告类输出

## 数据模型

在 `store.ts` 新增：

```typescript
export type ChatStyle = "im" | "terminal" | "clean";

// AppState 新增
chatStyle: ChatStyle;
setChatStyle: (style: ChatStyle) => void;
```

默认值 `"im"`，持久化到 `localStorage("agx-chat-style")`。

## 主题变量扩展

每套风格在 dark/light/dim 三个 CSS 主题文件中增加对应变量：

```css
/* IM style */
--bubble-user-bg: rgba(34, 197, 94, 0.25);   /* 绿色系 */
--bubble-user-text: var(--text-primary);
--bubble-assistant-bg: rgba(255, 255, 255, 0.08);
--bubble-assistant-text: var(--text-primary);

/* Terminal style */
--terminal-user-prefix: var(--text-strong);
--terminal-assistant-prefix: rgba(34, 211, 238, 0.8);

/* Clean style */
--clean-user-indicator: rgba(34, 197, 94, 0.6);
--clean-assistant-bg: rgba(255, 255, 255, 0.03);
```

## 组件改造

### MessageRenderer

读取 `chatStyle` 并按风格分发到不同的气泡组件：

```typescript
const chatStyle = useAppStore((s) => s.chatStyle);

if (chatStyle === "im") return <ImBubble ... />;
if (chatStyle === "terminal") return <TerminalLine ... />;
if (chatStyle === "clean") return <CleanBlock ... />;
```

### 新增 3 个气泡变体组件

- `desktop/src/components/messages/bubbles/ImBubble.tsx` — IM 风格，含头像 + 左右对齐 + 气泡尖角
- `desktop/src/components/messages/bubbles/TerminalLine.tsx` — 终端风格，前缀 + 等宽
- `desktop/src/components/messages/bubbles/CleanBlock.tsx` — 极简风格，全宽 + 分隔线

现有 `UserBubble.tsx` / `AssistantBubble.tsx` 可保留作为 "im" 风格的基础进行扩展，或独立新建以避免改动风险。

### IM 风格头像来源

- 用户头像：从用户名首字母生成（与 AvatarSidebar 同逻辑），背景色取 `--bubble-user-bg`
- 助手头像：若当前 pane 有 avatar，用 avatar 首字母 + 对应颜色；否则用 "M"（Meta）+ 渐变蓝

### 设置面板

在 `SettingsPanel.tsx` 的"通用"tab 中，DISPLAY 区域（主题下拉框下方）新增：

```
聊天风格
  [IM 风格 ▾]  ← 下拉选择：IM 风格 / 终端风格 / 极简风格
  （预览缩略图 或 一句话描述）
```

每个选项附带简短描述：

- IM 风格：微信/Telegram 风格，头像 + 彩色气泡
- 终端风格：开发者风格，等宽前缀 + 无气泡
- 极简风格：Notion 风格，全宽分隔线 + 干净排版

## 影响范围

- 仅影响消息气泡渲染层（`messages/` 目录），不改变消息数据模型
- ChatView（Lite 模式）也需同步适配 `chatStyle`
- ChatPane（Pro 模式）通过 MessageRenderer 自动适配
- 不影响 SubAgent 卡片、工具卡片、TodoUpdateCard 等非消息组件

