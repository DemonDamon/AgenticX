---
name: kb-global-chat-retrieval-default
overview: 将知识库对话检索模式提升为知识库设置页全局配置，修复新建会话时工具栏模式闪动，默认智能检索。
todos:
  - id: global-settings-ui
    content: 知识库 Tab 顶部增加全局「对话检索」分段选择，从单知识脑配置中移除触发模式
    status: completed
  - id: sync-display
    content: 聊天工具栏 useLayoutEffect + localStorage 缓存，新建会话即时显示正确模式
    status: completed
  - id: tests
    content: kb-retrieval-mode 单测覆盖缓存与 resolveDisplay
    status: completed
---

# KB 全局对话检索默认模式

## What & Why

- 检索触发模式不应藏在某个文档库知识脑内，应为全局设置。
- 仅保留一个「检索模式」（智能 / 始终），避免双字段困惑。
- 新建 session 时工具栏不得先显示上一会话模式再异步切换。

## Requirements

- FR-1: 设置 → 知识库顶部展示全局「对话检索」配置，读写 `/api/kb/config` 的 `retrieval.mode`。
- FR-2: 单知识脑「配置 → 检索」仅保留 Top-K、检索通道等技术项。
- FR-3: 新建对话 / 切换 session 时工具栏同步解析 per-session 或全局默认，无 2–3s 闪动。
- AC-1: 全局默认「智能检索」时，从「始终检索」会话点全新对话，输入框旁立即显示智能检索图标。
- AC-2: 单会话在输入框旁切换后，仅影响该 session，不影响其他会话。

## Key paths

- `desktop/src/components/settings/knowledge/KbGlobalChatRetrievalPanel.tsx`
- `desktop/src/components/settings/brains/BrainsSettings.tsx`
- `desktop/src/utils/kb-retrieval-mode.ts`
- `desktop/src/components/ChatPane.tsx`（已在前序 commit）
