# 临时对话挂靠正式 session 工作区

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5

> 仅凭本 plan 可独立实施。根因已在正文写清，不依赖对话记忆。

## Goal

临时对话只出现在**当前正式 session 的工作区**。不进左侧标准历史，除非用户显式「放到正式历史」。工作区支持删除单条、批量清除。

## Root cause（必须写进 plan）

临时对话首次发送会 `createSession`，得到一条与正式聊天同款的 studio session（例：`11da05da-…` 上开卡 → 物化出 `6c8f4a46-…`）。后端 `session_kind` 为空，`listSessions` 会返回它。

同时 scratch 状态挂在 **窗格** 上、不按正式 `pane.sessionId` 过滤。空主窗格 / 重启领养「最近一条」时，会把 scratch session 写成 `pane.sessionId`。用户看到：工作区没了这张卡，左侧标准历史多了一条。

已有缓解：`hiddenScratchSessionIds` + `pickPreferredSessionId` 跳过 blocklist + 主窗格拆掉 scratch 绑定。本 plan 把归属改成 **host 正式 session**，并补齐删除 / 批量清除 / 升到历史。

## In scope

- `ScratchChat.hostSessionId`：开卡时盖上当前正式 `pane.sessionId`
- WorkPanel 只展示 `hostSessionId === 当前正式 session` 的卡（空正式 session 只展示 host 为空的卡）
- 关 tab = 停在该正式 session 的工作区摘要（park，跨重启保留）
- 摘要行：打开 / 删除（确认） / 已物化则可「放到正式历史」
- 摘要区「清除全部」（确认后删该 host 下全部 scratch，并 `deleteSession`）
- 升到历史：移出工作区列表，并从 `hiddenScratchSessionIds` 去掉该 id，侧栏可见
- 落盘 `parkedScratchChats` + `hostSessionId`
- 主窗格绑定非 scratch session 时，把 host 为空的卡挂到该 session
- 保持：scratch `createSession` 立刻进 hidden；空窗格不得领养 scratch session

## Out of scope

- 改 `agenticx/studio/server.py` 的 `session_kind` / create_session
- 改「引用至新对话」
- Electron 独立窗口
- 全局搜索命中未提升的 scratch（继续走现有 blocklist）
- 不为已经漏到侧栏、且不在 hidden/open/parked 里的旧行做启发式回收

## Suggested-Impl-Model

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| helper + store + persist | Composer 2.5 | 纯数据/过滤 |
| WorkPanel 摘要动作 | Composer 2.5 | 复用现有 Modal / Section |

## FR / AC

- **FR-1** 临时对话归属当前正式 session 工作区  
  **AC-1** `tests`：`scratchBelongsToHost` / `filterScratchChatsForHost`；host=A 的卡在 session B 的 WorkPanel 不可见。
- **FR-2** 不进侧栏，除非提升  
  **AC-2** 物化后 `hiddenScratchSessionIds` 含该 id；`promoteScratchChat` 后该 id 不在 hidden，且不在 open/parked。
- **FR-3** 删除单条  
  **AC-3** `deleteScratchChat` 从 open 或 parked 移除并返回 `sessionId`；WorkPanel 确认后调用 `deleteSession`。
- **FR-4** 批量清除当前正式 session 下全部临时对话  
  **AC-4** `clearScratchChatsForHost` 只清匹配 host 的卡；其它 host 保留。
- **FR-5** 放到正式历史  
  **AC-5** 无 `sessionId` 的卡不展示提升按钮；有则提升后侧栏 `excludeScratchSessionsFromHistory` 不再过滤它。
- **FR-6** 重启后仍在该正式 session 工作区  
  **AC-6** persist 写 `parkedScratchChats` + `hostSessionId`；hydrate 不再把 parked 置 `[]`。

---

### Task 1: host / delete / promote helpers

**Files:**
- Modify: `desktop/src/utils/scratch-chat.ts`
- Test: `desktop/src/utils/scratch-chat.test.ts`

`ScratchChat` 增加 `hostSessionId: string`（默认 `""`）。

`upsertScratchChatList(..., hostSessionId = "")`：新建卡写入 host；复用保留原 host。

新增（纯函数，见下方意图）：

- `scratchBelongsToHost` / `filterScratchChatsForHost`
- `attachUnhostedScratchChats`（只填空 host）
- `forgetScratchSessionIds`
- `deleteScratchChatFromLists`
- `clearScratchChatsForHost`

`normalizePersistedScratchChats` 读 `hostSessionId`。

**before:** scratch 只挂在 pane 上，切 session 仍显示。  
**after:** 展示与清除都按 host 过滤。

---

### Task 2: store + persist

**Files:**
- Modify: `desktop/src/store.ts`（`AppState` 约 L883；`setPaneSessionId` 约 L2356；scratch actions 约 L2585）
- Modify: `desktop/src/store.scratch-chat.test.ts`
- Modify: `desktop/src/App.tsx`（`PersistedPaneState` 约 L107；hydrate parked 约 L910；persist snapshot 约 L1141）

Store 新增：

- `forgetHiddenScratchSessionIds(sessionIds)`
- `deleteScratchChat(paneId, chatId) => sessionId`
- `promoteScratchChat(paneId, chatId) => sessionId`
- `clearHostScratchChats(paneId, hostSessionId) => sessionId[]`

`upsertScratchChat` 用 `pane.sessionId` 作 host。

`setPaneSessionId`：若 `nextSid` 非空且不在 `scratchHistoryBlocklist`，对 open+parked 跑 `attachUnhostedScratchChats`。

Persist：`parkedScratchChats: normalizePersistedScratchChats(pane.parkedScratchChats)`；hydrate 用同一函数，禁止 `parkedScratchChats: []`。

---

### Task 3: WorkPanel 摘要动作

**Files:**
- Modify: `desktop/src/components/work-panel/WorkPanel.tsx`（scratch 选择约 L841；摘要约 L2818；Modal 约 L3239）
- Modify: `desktop/locales/zh/workspace.json`、`desktop/locales/en/workspace.json`
- Test: `desktop/src/utils/scratch-chat.test.ts` source-contract（`scratchPromote` / `scratchClearAll` / `parkedScratchChats` persist）

选择器增加 `hostSessionId = pane.sessionId`。  
`scratchChats` / `parkedScratchChats` 先 `filterScratchChatsForHost` 再给 tab / 摘要 / plus。

- Tab ✕：仍 `closeScratchChat`（park，留在该 host 摘要）
- 摘要 ✕：确认后 `deleteScratchChat` + `deleteSession`
- 摘要「放到正式历史」：有 `sessionId` 才显示；`promoteScratchChat` + `bumpSessionCatalogRevision`
- 摘要区「清除全部」：确认后 `clearHostScratchChats` + 逐个 `deleteSession`

文案：

- zh：`scratchPromote`「放到正式历史」、`scratchClearAll`「清除全部」、`scratchClearAllConfirmTitle`「清除这个会话里的全部临时对话？」、`scratchClearAllConfirm`「会从工作区删除，且不会进入侧栏历史。」
- en：对应英文

`Section` 增加可选 `actions?: ReactNode`（`stopPropagation`），仅 scratch 传入清除按钮。

---

### Task 4: 验证

Run:

```bash
cd desktop && npx vitest run src/utils/scratch-chat.test.ts src/store.scratch-chat.test.ts src/utils/group-pane-open.test.ts
```

Expected: 全绿。

手动：在正式 session 开临时对话并发送 → 工作区摘要可见、侧栏没有；切到另一 session 工作区没有这张卡；切回仍在；删除 / 清除全部后盘上 session 消失；提升后侧栏出现且工作区不再列出。
