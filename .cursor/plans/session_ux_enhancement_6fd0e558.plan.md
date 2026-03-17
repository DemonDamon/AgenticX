---
name: Session UX Enhancement
overview: 修复重复 Session 名称问题，实现基于首条消息的会话自动标题生成，并为会话列表添加参考 Cursor 风格的右键上下文菜单（含 Pin、Fork、Delete、Rename、Archive 等功能）。
todos:
  - id: fix-duplicate-title
    content: "Phase 1-A: 修复 session fallback 标题逻辑，避免重复 Session N"
    status: completed
  - id: auto-title
    content: "Phase 1-B: 后端实现基于首条用户消息的自动标题生成，并持久化 session_name"
    status: completed
  - id: backend-new-fields
    content: "Phase 2-A: ManagedSession 新增 pinned/archived/created_at 字段，新增 pin/fork/archive 方法"
    status: completed
  - id: backend-new-routes
    content: "Phase 2-B: server.py 新增 pin/fork/archive API 路由"
    status: completed
  - id: electron-ipc
    content: "Phase 2-C: preload.ts + main.ts 新增 deleteSession/pinSession/forkSession/archiveSessions IPC"
    status: completed
  - id: context-menu-ui
    content: "Phase 2-D: SessionHistoryPanel 实现右键上下文菜单（7个菜单项 + 功能）"
    status: completed
  - id: session-grouping
    content: "Phase 3: 会话列表按时间分组展示（Pinned / Today / Previous 7 days / Older）"
    status: completed
isProject: false
---

# Session 历史会话 UX 增强

## 问题分析

### 问题 1：为什么有两个 "Session 1"

根因在 `[SessionHistoryPanel.tsx](desktop/src/components/SessionHistoryPanel.tsx)` 第 84 行：

```typescript
const label = item.session_name || `Session ${index + 1}`;
```

当两个会话的 `session_name` 都是 `null` 时，如果它们在排序后分别排在 index 0，就会都显示为 "Session 1"。而当前创建会话时（新话题、点击分身），**从不传递 `name` 参数**，后端 `session_name` 始终为 `None`。

### 问题 2：缺少自动标题

当前没有基于首条消息内容的自动标题生成机制。`session_name` 只在创建时手动传入或双击重命名时设置，且**未持久化**到磁盘。

### 问题 3：缺少右键菜单

`SessionHistoryPanel` 没有 `onContextMenu` 处理，也没有对应的 Pin、Fork Chat、Delete、Archive 等后端 API。

---

## 改动方案

### Phase 1：修复重复标题 + 自动标题生成

**后端改动：**

- `[agenticx/studio/session_manager.py](agenticx/studio/session_manager.py)`：
  - 新增 `auto_title_session(session_id, first_user_message)` 方法：截取用户首条消息前 30 字符作为标题（仅在 `session_name` 为 `None` 时生效）
  - `_persist_session_state` 中同步持久化 `session_name` 到 `session_summaries` 表的 metadata 中
  - `_restore_persisted_state` 中恢复 `session_name`
  - `list_sessions` 返回中补充 `created_at` 字段（用于排序和分组展示）
- `[agenticx/studio/server.py](agenticx/studio/server.py)`：
  - 在 `/api/chat` 消息处理中，当检测到首条用户消息时调用 `auto_title_session`

**前端改动：**

- `[SessionHistoryPanel.tsx](desktop/src/components/SessionHistoryPanel.tsx)`：
  - 移除 `Session ${index + 1}` fallback，改为使用 session_id 前 8 位或 "新会话" 作为 fallback
  - 显示自动生成的标题（来自后端的 `session_name`）

### Phase 2：右键上下文菜单（参考 Cursor 风格）

参考 Cursor 的右键菜单项：


| 菜单项                     | 功能                      | 需要新后端 API                               |
| ----------------------- | ----------------------- | --------------------------------------- |
| **Pin**                 | 置顶会话                    | 是：`pinned` 字段                           |
| **Fork Chat**           | 基于当前会话 fork 一个新会话（复制历史） | 是：`POST /api/sessions/fork`             |
| **Open in New Tab**     | 在新 Pane 中打开该会话          | 否（纯前端）                                  |
| **Mark as Unread**      | 标记未读（视觉提示）              | 否（前端状态即可）                               |
| **Delete**              | 删除会话                    | 需暴露到 preload：已有后端 `DELETE /api/session` |
| **Rename**              | 重命名（复用现有双击逻辑）           | 否（已有）                                   |
| **Archive Prior Chats** | 归档当前会话之前的所有会话           | 是：`POST /api/sessions/archive`          |


**后端改动：**

- `[agenticx/studio/session_manager.py](agenticx/studio/session_manager.py)`：
  - `ManagedSession` 新增字段：`pinned: bool = False`，`archived: bool = False`，`created_at: float`
  - 新增方法：`pin_session(session_id, pinned)`、`fork_session(session_id)`、`archive_sessions_before(session_id)`
  - `list_sessions` 过滤已归档会话，`pinned` 会话排在最前
- `[agenticx/studio/server.py](agenticx/studio/server.py)`：
  - `POST /api/sessions/{session_id}/pin` — 切换置顶
  - `POST /api/sessions/{session_id}/fork` — Fork 会话
  - `POST /api/sessions/archive-before` — 归档指定会话之前的所有会话
  - `DELETE /api/session` — 已有，需暴露到 Electron preload

**Electron IPC 改动：**

- `[desktop/electron/preload.ts](desktop/electron/preload.ts)`：新增 `deleteSession`、`pinSession`、`forkSession`、`archiveSessions`
- `[desktop/electron/main.ts](desktop/electron/main.ts)`：新增对应 `ipcMain.handle` 路由

**前端改动：**

- `[SessionHistoryPanel.tsx](desktop/src/components/SessionHistoryPanel.tsx)`：
  - 新增 `ContextMenu` 组件（绝对定位浮层），包含上述 7 个菜单项
  - 在会话项上添加 `onContextMenu` 事件处理
  - 已置顶会话显示置顶图标，排序优先
  - Delete 操作需要二次确认
  - Archive Prior Chats 需要确认弹窗

### Phase 3：会话列表分组展示

- 参考 Cursor 的时间分组（Today / Previous 7 days / Older）
- 已置顶 (Pinned) 会话置于顶部独立分组

---

## 涉及文件


| 文件                                               | 改动类型           |
| ------------------------------------------------ | -------------- |
| `agenticx/studio/session_manager.py`             | 新增字段、方法        |
| `agenticx/studio/server.py`                      | 新增 API 路由      |
| `desktop/electron/preload.ts`                    | 新增 IPC 暴露      |
| `desktop/electron/main.ts`                       | 新增 IPC handler |
| `desktop/src/components/SessionHistoryPanel.tsx` | 右键菜单、自动标题显示、分组 |


