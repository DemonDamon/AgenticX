---
name: session-switch-instant-and-cache
overview: 基于 c7c2d8c1 的 profile 数据（fetch 430ms–1000ms 占绝对大头），用「点击即清空 + skeleton」+「前端按 sessionId LRU 缓存 messages」消除 Near 历史会话切换体感卡顿。
todos:
  - id: instant-clear-skeleton
    content: 点击切换瞬间清空旧 messages，pane 增加 loadingMessages 标记，ChatPane 渲染骨架
    status: completed
  - id: messages-lru-cache
    content: store 新增 sessionMessageCache（LRU 10），命中直接渲染，未命中再走 IPC 后回填缓存
    status: completed
  - id: cleanup-profile-logs
    content: 删除 c7c2d8c1 加入的三处 PROFILE 埋点（前端 + IPC + 后端）
    status: completed
isProject: false
---

# Near 切换会话即时响应 + 前端消息缓存

## 数据依据（来自 c7c2d8c1 profile）

| sid | count | fetch | total |
|-----|-------|-------|-------|
| 9f8e0a02 (1st) | 11 | 2ms | 2ms |
| 9f8e0a02 (2nd) | 11 | 434ms | 434ms |
| 2a072362 | 16 | 537ms | 537ms |
| 8b53d964 | 71 | 573ms | 574ms |
| dd8287ce | 31 | 624ms | 624ms |
| 03a1bb4f | 21 | 1006ms | 1006ms |

`parse`/`map` 始终 ~0–1ms，瓶颈完全在 fetch（后端 load + normalize）。同一 session 第 2 次仍要 434ms，说明后端没有热路径。

## 方案

### A. 点击即清空 + skeleton（消除「点了没反应」体感）
- `switchSession` 内 `setPaneSessionId` 之后**立即** `setPaneMessages([])` 并打开 `loadingMessages=true`
- `pane` 类型 + store 增加 `loadingMessages: boolean`，`setPaneLoadingMessages(paneId, bool)`
- `ChatPane` / `ChatView` 在 `loadingMessages && messages.length===0` 时渲染 3–5 行 skeleton 气泡

### B. 前端 LRU 缓存（消除重复切回的延迟）
- store 新增 `sessionMessageCache: Map<sessionId, Message[]>`（限 10 条，按访问顺序淘汰）
- `switchSession` 优先 `cache.get(sid)`：命中即 `setPaneMessages` + 不开 loading
- IPC 返回后写回 cache；`deleteSession` / 批删时清对应 cache entry

### C. 收尾
- 删 `desktop/src/components/SessionHistoryPanel.tsx`、`desktop/electron/main.ts`、`agenticx/studio/session_manager.py` 三处 `PROFILE:` 注释段与日志

## 不做（明确剥离）

- 不动后端 `get_messages`：profile 只跑了 IPC 侧，后端 load vs normalize 占比未知，留待真有「首次冷打开仍 >300ms」抱怨再加 C
- 不做 hover prefetch（IPC 带宽与体感收益不确定）

## 验收
- 点击任意 session：顶栏切 + 旧气泡立刻消失 + 出现 skeleton（<16ms 视觉变化）
- 同 session 重复切回 0 IPC（DevTools 无新 `[ipc:load-session-messages]` 日志），消息瞬现
- 删除会话后该 sid 不再从 cache 渲染
- `[session-switch]` / `[ipc:...]` / `[get-messages]` 日志全部消失
