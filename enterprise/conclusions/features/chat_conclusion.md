# @agenticx/feature-chat 模块总结

> 结论生成时间：2026-06-08（首次创建，覆盖当前代码 v0.1.0）

> 说明：本文档描述**对话工作区 feature 包**（`@agenticx/feature-chat`），是 `apps/web-portal` 的核心 chat 能力来源。从 AgenticX-Website 剥离而来。

## 模块概述

`@agenticx/feature-chat` 是 AgenticX Enterprise 员工前台（web-portal）的**对话工作区核心 feature 包**。它把"对话工作区"封装成一个可复用的 React 包：包含 Zustand 状态机（多会话、流式增量、版本/重试历史、token 累计、服务端历史同步、草稿会话懒提交）+ 主壳组件 `ChatWorkspace` + 一组原子/分子级 UI（MessageList、InputArea、ModelSelector、ReasoningBlock、ToolCallCard）+ 一个对接 portal `/api/chat/sessions` 的 HTTP 历史客户端。**对外只通过 `@agenticx/sdk-ts` 的 `ChatClient` 接口与底层 LLM 通道解耦**（mock / HTTP 均可注入），portal 的 `MachiChatView` 把这个包装成"Machi" 品牌化界面再上路由。

## 目录结构

```
features/chat/
├── package.json                              # @agenticx/feature-chat
├── tsconfig.json
└── src/
    ├── index.ts                              # barrel：types / history-client / store / ChatWorkspace / 全部 UI
    ├── types.ts                              # ChatWorkspaceProps, ChatWorkspaceSlots, RulePackMeta
    ├── store.ts                              # ⭐ 核心 Zustand store（1300+ 行，全包最大）
    ├── store.history.test.ts                 # store 与历史同步的测试
    ├── ChatWorkspace.tsx                     # 主壳：三栏（sidebar / main / tools-rules）
    ├── history-client.ts                     # createPortalChatHistoryClient → /api/chat/sessions
    ├── assistant-content.ts                  # parseAssistantContent：把 assistant 文本拆成 text/reasoning/tool-call 段
    ├── assistant-content.test.ts
    ├── components/
    │   ├── atoms/
    │   │   ├── ReasoningBlock.tsx            # 思维链折叠块
    │   │   └── ToolCallCard.tsx              # 工具调用卡片
    │   └── molecules/
    │       ├── MessageList.tsx               # 消息列表（react-markdown + remark-gfm + 复制/链接/重试按钮）
    │       ├── InputArea.tsx                 # 输入框（含 send/cancel 按钮 + 左右工具栏插槽）
    │       └── ModelSelector.tsx             # 模型下拉
    └── markdown/                             # Markdown 渲染辅助
        ├── assistant-markdown-components.tsx # 自定义 react-markdown 组件覆盖
        ├── chat-prism-setup.ts               # PrismJS 高亮初始化
        ├── chat-prism-themes.css             # 高亮主题样式
        ├── FencedCodeBlock.tsx               # 围栏代码块（含语言徽章 + 复制）
        ├── highlight-chat-code.ts            # 代码高亮封装
        └── highlight-chat-code.test.ts
```

## 核心组件

### `store.ts` —— Zustand chat store（包内灵魂）

**StoreState 关键字段**：
- `sessions: ChatSession[]`、`activeSessionId`、`messages: ChatMessage[]`
- `status: "idle" | "sending" | "streaming" | "error"`、`activeRequestId`
- `activeModel`、`errorMessage`
- `sessionTokens` + `sessionTokensBySessionId` —— 全局 + per-session token 累计（输入/输出/合计 + 最近一次值）
- `responseVersionsByUserMessageId` —— **多版本/重试视图状态**：每个 user message 下可有多个 assistant 版本（编辑重发=新 queryVersion，重新生成=同 queryVersion 内 retryAttempt+1）
- `hydrated`、`historyLoading`、`historyError`、`sessionMessagesLoading`
- `draftSessionId` —— **草稿会话懒提交**：用户发送首条消息前不落盘（对齐 Machi Desktop lazy create）

**StoreActions 关键方法**：

| Action | 用途 |
|---|---|
| `hydrateSessions()` | 启动加载：拉服务端会话列表 + 首会话历史消息；in-flight 互斥；401 自动跳 `/auth?returnTo=` |
| `bootstrap()` | 未联网/未鉴权 dev 初始化（不打服务端）|
| `createSession()` | 用 `beginDraftSessionPatch` 起一个**本地草稿** session（不立刻 POST）|
| `switchSession()` | 切换并按需懒加载该会话历史；用 `sessionMessageLoadSeq` 防并发竞争 |
| `renameSession()` / `deleteSession()` | 服务端持久化 + 本地状态同步；删完空会回 draft |
| `switchModel()` | 切模型；非草稿会同步 PATCH 服务端 |
| `sendMessage(client, input)` | **核心**：草稿→正式 session 提升 + 自动标题 + 推送 user/assistant 消息 + 调 `client.sendMessage` + `for await client.stream(requestId)` 增量更新 + 错误 fallback `toComplianceMessage` |
| `editUserMessageAndResend()` | 编辑历史 user message → 截断后续 + 起 `queryVersionIndex+1` 新版本 |
| `regenerateAssistantResponse()` | 同 user 下 `retryAttempt+1` 重生 |
| `showPrevious/NextResponseVersion()` | 在 query 版本间切换（不同 query 间）|
| `showPrevious/NextRetryVersion()` | 在 retry 版本间切换（同 query 内）|
| `cancel(client)` | 调 `client.cancel(activeRequestId)` |
| `deleteMessage(messageId)` | 本地删一条 |

**关键模式**：
- **草稿懒提交**（`isDraftSessionId` / `beginDraftSessionPatch` / `discardDraftSessionPatch`）—— UI 立刻可用，首条消息发送时才 POST 创建 session
- **load 竞争防护** —— `sessionMessageLoadSeq` 序号比对
- **401 自动跳转** —— `historyAuthRedirectScheduled` 标志 + `window.location.assign("/auth?returnTo=...")`
- **错误信封映射** —— `toComplianceMessage(code, message)` from `@agenticx/core-api` 把 gateway 错误码（含 `9xxxx` policy 错）翻译成中文用户态消息
- **token 累计** —— `addChunkToSessionTokens` 流式 chunk 边来边累加（全局 + per-session）
- **首条消息自动标题** —— `sessionTitleNeedsAutoFill` + `buildAutoTitleFromFirstUserMessage`（从 `@agenticx/core-api` 共享，跨语言契约对齐主仓 Python）

### `ChatWorkspace.tsx` —— 主壳组件

**Props**（`ChatWorkspaceProps`）：
- `brand: BrandConfig`（from `@agenticx/config`）—— 注入 brand 文案 / 颜色
- `features: FeatureFlags` —— 含 `chat.web_search`、`gateway.policy_engine` 等开关
- `rulePacks?: RulePackMeta[]` —— 显示在右侧"Tools & Rules"栏
- `client: ChatClient` —— 由消费者注入（MockChatClient / HttpChatClient）
- `slots?: { header, sidebar, footer }` —— 槽位插入

**三栏布局**：
- **左栏 sidebar**：会话列表卡片（点击/Enter 切换；高亮当前；显示标题 + 消息数）
- **主栏 main**：header（品牌 + ModelSelector） + MessageList + InputArea 输入区 + errorMessage
- **右栏 aside**：Tools & Rules（显示 policy_engine 开关 + 加载的 rule pack 列表）

**brand 注入**：`buildBrandThemeVars(brand.brand)` → CSS 变量挂到根容器 `style`，让所有子组件统一品牌色

### `history-client.ts` —— Portal 历史客户端

`createPortalChatHistoryClient()` 返回 `PortalChatHistoryClient`，封装对 portal `/api/chat/sessions` 的 REST 调用：

| 方法 | 端点 |
|---|---|
| `listSessions` | GET `/api/chat/sessions` |
| `createSession` | POST `/api/chat/sessions` |
| `getMessages(sid)` | GET `/api/chat/sessions/{sid}/messages` |
| `appendMessages(sid, msgs)` | POST `/api/chat/sessions/{sid}/messages` |
| `replaceMessages(sid, msgs)` | PUT 全量替换（编辑重发/重生用）|
| `renameSession(sid, title)` | PATCH 改标题 |
| `patchSession(sid, patch)` | PATCH 改 `title` / `activeModel` |
| `deleteSession(sid)` | DELETE |

**错误**：`ChatHistoryHttpError`（带 `.status` 字段，让 store 识别 401 做跳转）

### UI 原子/分子组件

| 组件 | 职责 |
|---|---|
| `MessageList` | 渲染 `ChatMessage[]`，调 `parseAssistantContent` 把 assistant 文本切成 text / reasoning / tool-call 段；用 `react-markdown` + `remark-gfm` + 自定义 `ASSISTANT_MD_COMPONENTS` + Prism 代码高亮渲染；含复制 / 链接 / 重试按钮 |
| `InputArea` | textarea + Send/Cancel 按钮；`leftToolbar` / `rightToolbar` 插槽；`appearance: "default" \| "portal"` 两套外观 |
| `ModelSelector` | 模型下拉 |
| `ReasoningBlock` | 思维链折叠块（DeepSeek-R1 / o1 风格 reasoning 段）|
| `ToolCallCard` | 工具调用卡片（展示 tool name + arguments + result）|
| `FencedCodeBlock` | 围栏代码块：语言徽章 + 复制按钮 |

### `assistant-content.ts` —— 内容分段解析

把 assistant 单条消息文本按特定标记切成 `{text, reasoning, toolCalls}` 数组段，供 `MessageList` 渲染时区分展示

## 公共导出（`src/index.ts`）

```ts
export * from "./types";                       // ChatWorkspaceProps, ChatWorkspaceSlots, RulePackMeta
export * from "./history-client";              // createPortalChatHistoryClient, ChatHistoryHttpError, PortalChatHistoryClient
export { sessionTitleNeedsAutoFill,
         buildAutoTitleFromFirstUserMessage } from "@agenticx/core-api";  // 透传
export * from "./store";                       // useChatStore, ChatStore, SessionTokenUsage, AssistantResponseVersion, ChatStatus...
export * from "./ChatWorkspace";               // ChatWorkspace
export * from "./components/molecules/MessageList";
export * from "./components/molecules/InputArea";
export * from "./components/molecules/ModelSelector";
export * from "./components/atoms/ReasoningBlock";
export * from "./components/atoms/ToolCallCard";
```

## 测试

| 文件 | 覆盖 |
|---|---|
| `assistant-content.test.ts` | 分段解析（text / reasoning / tool-call） |
| `store.history.test.ts` | store 与服务端历史同步流程 |
| `markdown/highlight-chat-code.test.ts` | Prism 代码高亮 |

运行：`pnpm --filter @agenticx/feature-chat test`（vitest run）

## 依赖

| 依赖 | 用途 |
|---|---|
| `@agenticx/core-api` | 类型（`ChatMessage` / `ChatSession`） + 共享辅助（`toComplianceMessage` / 自动标题） |
| `@agenticx/sdk-ts` | `ChatClient` 接口（注入式，解耦底层通道） |
| `@agenticx/ui` | Card / Button / Tooltip / `buildBrandThemeVars` 等 |
| `@agenticx/config` | `BrandConfig` / `FeatureFlags` 类型 |
| `zustand ^5` | store 状态机 |
| `ulid` | 消息 / session / 草稿 ID |
| `react ^19` | UI |
| `react-markdown ^10` + `remark-gfm ^4` | Markdown 渲染 |
| `prismjs ^1` | 代码高亮 |
| `@tanstack/react-virtual` | （声明依赖但当前 MessageList 未直接使用，可能预留虚拟滚动）|

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `apps/web-portal` | **主消费者** | 在 `WorkspaceClient.tsx` 中实例化 `ChatWorkspace`；`MachiChatView` 直接复用 `MessageList` + `InputArea` + `ModelSelector` + `useChatStore` |
| `apps/web-portal/api/chat/sessions/**` | **HTTP 后端** | `history-client.ts` 调用的全部端点；落 PG 通过 `web-portal/src/lib/chat-history.ts` |
| `apps/gateway` | **间接** | `ChatClient`（注入）实际是 `HttpChatClient` → 调网关 `/v1/chat/completions` |
| `packages/sdk-ts` | **运行时依赖** | `ChatClient` 接口契约 + `MockChatClient` / `HttpChatClient` 实现 |
| `packages/core-api` | **类型契约** | 消息/会话类型 + 错误码翻译 + session-title 启发式 |
| `packages/ui` | **UI 基础** | 全套 shadcn 组件 + brand 主题变量 |
| `packages/config` | **类型契约** | `BrandConfig` / `FeatureFlags` |
