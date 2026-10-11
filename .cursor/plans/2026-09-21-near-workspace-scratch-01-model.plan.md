# 工作区临时对话 01：数据模型与历史隔离

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5
Plan-Id: 2026-09-21-near-workspace-scratch-01-model
Parent-Plan: `.cursor/plans/pending/2026-09-21-near-workspace-scratch-chat-master.plan.md`
Design: `docs/plans/2026-09-21-workspace-scratch-chat-design.md`

> **For implementer:** 本计划无 UI。不要改 `WorkPanel.tsx` 渲染、不要改 `ImBubble` 菜单、不要接发送链路。

---

## Goal

给每个 `ChatPane` 挂上 `scratchChats`，提供可测的 upsert / 浮出互斥 / 关闭 / 历史过滤 / 持久化归一化，并接到 store、workspace 快照和侧栏历史。重启能恢复 tab 元数据；scratch 的 `sessionId` 不出现在侧栏历史。

## Architecture

纯函数放 `desktop/src/utils/scratch-chat.ts`。`store.ts` 只做 pane 映射。`App.tsx` 的 `agx-workspace-state-v1` 读写走同一套 normalize。`SidebarSessionHistory` 在 `sessionsWithHints` 之前剔除 scratch session id。

## In scope

- `ScratchChat` 类型与 pane 字段
- store：`upsertScratchChat` / `setScratchChatFloating` / `closeScratchChat` / `patchScratchChat`
- workspace persist / hydrate
- 侧栏历史过滤
- 单元测试

## Out of scope

- WorkPanel tab、浮窗组件、消息入口、SSE
- 全局搜索过滤（06 或后续；本刀只保证侧栏）
- 「提到主窗格」
- 改 `clearPaneMessages` / `setPaneSessionId` 去清 scratch（必须保留）

## FR / AC

- **FR-1** 同一 `sourceKey` upsert 复用，不新建。
  - **AC-1** `desktop/src/utils/scratch-chat.test.ts`：两次 upsert 同一 key，列表长度 1，`reused === true`。
- **FR-2** `floating=true` 时其它卡 `floating=false`。
  - **AC-2** 同测试文件：两张卡，浮第二张后只有第二张 `floating`。
- **FR-3** 有 `sessionId` 或 `messages.length > 0` 时 `shouldConfirmCloseScratch` 为 true；空卡为 false。
- **FR-4** `excludeScratchSessionsFromHistory` 去掉 scratch session，保留主 session。
- **FR-5** `normalizePersistedScratchChats` 丢掉非法项，恢复时 `floating` 一律 false。
- **FR-6** `makeDefaultPane` / `addPane` 带 `scratchChats: []`；`clearPaneMessages` 不删 scratch。
  - **AC-6** `desktop/src/store.scratch-chat.test.ts`。
- **FR-7** `SidebarSessionHistory` 用 `collectScratchSessionIds(panes)` 过滤。
  - **AC-7** 该文件 `sessionsWithHints` 的输入已排除 scratch id（读代码锚点 + 纯函数测试）。

---

### Task 1: 纯函数 + 测试

**Files:**
- Create: `desktop/src/utils/scratch-chat.ts`
- Create: `desktop/src/utils/scratch-chat.test.ts`

`ScratchChat` 与设计一致。导出：

```ts
export type ScratchChatSourceKind =
  | "message" | "selection" | "tool_result" | "artifact"
  | "change" | "reference" | "todo" | "file" | "terminal" | "browser";

export type ScratchChatContextFile = { path: string; sourcePath?: string };

export type ScratchChat = {
  id: string;
  title: string;
  sourceKind: ScratchChatSourceKind;
  sourceKey: string;
  quotedContent?: string;
  contextFiles?: ScratchChatContextFile[];
  sessionId: string;
  messages: Message[]; // import type from store 会循环则用最小 Message 形状或从 store 类型 import
  floating: boolean;
};

export function scratchSourceKey(kind: ScratchChatSourceKind, raw: string, extra?: string): string;
export function upsertScratchChatList(existing: ScratchChat[], draft: ScratchChatDraft, newId: string): { chats: ScratchChat[]; chat: ScratchChat; reused: boolean };
export function setScratchFloating(chats: ScratchChat[], chatId: string, floating: boolean): ScratchChat[];
export function closeScratchChatList(chats: ScratchChat[], chatId: string): ScratchChat[];
export function patchScratchChatList(chats: ScratchChat[], chatId: string, patch: Partial<ScratchChat>): ScratchChat[];
export function shouldConfirmCloseScratch(chat: Pick<ScratchChat, "sessionId" | "messages">): boolean;
export function collectScratchSessionIds(panes: Array<{ scratchChats?: ScratchChat[] }>): Set<string>;
export function excludeScratchSessionsFromHistory<T extends { session_id: string }>(rows: T[], scratchIds: Iterable<string>): T[];
export function normalizePersistedScratchChats(raw: unknown): ScratchChat[];
```

`upsert` 命中 `sourceKey` 则复用，刷新 title / quoted / contextFiles，全表 `floating=false`。
`setScratchFloating(true)` 仅该 id 为 true。
`normalizePersistedScratchChats`：缺 id/sourceKey/title 丢弃；`sessionId` 缺省 `""`；`messages` 非数组则 `[]`；**`floating` 恒 false**。

测试至少覆盖 FR-1..FR-5。

Run: `cd desktop && npx vitest run src/utils/scratch-chat.test.ts`

---

### Task 2: store 接线

**Files:**
- Modify: `desktop/src/store.ts`
  - `ChatPane`（约 L179）增加 `scratchChats?: ScratchChat[]`
  - `AppState` 增加四个 action
  - `makeDefaultPane`（约 L970）、`addPane`（约 L1857）设 `scratchChats: []`
  - action 实现只 `map` 目标 pane，调用 Task 1 函数
- Create: `desktop/src/store.scratch-chat.test.ts`

`upsertScratchChat(paneId, draft)` 返回 `{ chatId, reused }`，`newId` 用现有文件内 `uid()`。

`clearPaneMessages`（约 L2271）保持只清 `messages` / tokens，**禁止**写 `scratchChats: []`。

测试：默认 pane 有空数组；upsert 两次同 key 复用；clearPaneMessages 后 scratch 仍在。

Run: `cd desktop && npx vitest run src/store.scratch-chat.test.ts src/utils/scratch-chat.test.ts`

---

### Task 3: persist + 侧栏过滤

**Files:**
- Modify: `desktop/src/App.tsx`
  - `PersistedPaneState`（约 L63）增加 `scratchChats?: ScratchChat[]`
  - `normalizePersistedWorkspaceState`（约 L182 的 return 对象）加 `scratchChats: normalizePersistedScratchChats(row.scratchChats)`
  - 写入快照（约 L1079）加 `scratchChats: normalizePersistedScratchChats(pane.scratchChats)`
  - hydrate `setState`（约 L846）显式 `scratchChats: normalizePersistedScratchChats(pane.scratchChats)`（不要只靠 spread，避免旧快照脏数据）
- Modify: `desktop/src/components/sidebar/SidebarSessionHistory.tsx`
  - import `collectScratchSessionIds`, `excludeScratchSessionsFromHistory`
  - `sessionsWithHints` 之前先 `excludeScratchSessionsFromHistory(sessions, collectScratchSessionIds(panes))`

不要改 hydrate 里 `messages: []`（主窗格仍空载再拉）。scratch 消息以 persist 快照为准，本刀不接 `loadSessionMessages`。

---

### Task 4: 验证

Run:

```
cd desktop && npx vitest run src/utils/scratch-chat.test.ts src/store.scratch-chat.test.ts src/utils/sidebar-session-history.test.ts
```

Expected: 全绿。`sidebar-session-history` 是回归，本刀不改其函数签名。

禁止改 `ChatPane.tsx` 除了若 `FALLBACK_PANE` 缺字段导致类型失败时可补 `scratchChats: []`（约 L669）。`addPane` 预览 pane 同理。

## Go / No-Go

- 纯函数测试绿
- store 测试绿
- 无 WorkPanel / ImBubble / sendChat 改动
- persist 读写都走 `normalizePersistedScratchChats`
