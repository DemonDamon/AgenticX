---
name: session-history-tail-first-paged-loading
overview: 历史会话当前是「全量一次性加载」——切换未命中 LRU 缓存的会话时清空消息并显示全屏「正在加载会话…」骨架，要等整份 messages.json（读盘 + normalize + IPC 传输 + 全量 React 渲染）跑完才出内容；长对话尤其慢且骨架显眼。本 plan 改为「尾部优先 + 上拉分页」：切会话先取最近 N 轮立即渲染，用户向上滚动到顶部时再以小 spinner 增量加载更早消息。改动严格限定在 desktop 端会话切换/滚动路径与一个新增的分页读取通道，不动现有全量加载（poll / merge / reconcile / automation / 飞书微信）的语义。
todos:
  - id: backend-paged-api
    content: GET /api/session/messages 增加可选 tail_rounds / before_index / limit 参数；不传时保持全量返回（向后兼容）；分页时返回 start_index + total_count + has_older
    status: completed
  - id: session-manager-slice
    content: session_manager 新增按轮次/索引切片的读取（先在原始 list 上切片再 normalize 窗口），不改 get_messages 全量语义
    status: completed
  - id: ipc-paged-channel
    content: 新增独立 IPC load-session-messages-page（preload + global.d.ts 类型）；保留现有 loadSessionMessages 全量不变
    status: completed
  - id: store-pane-paging-state
    content: ChatPane state 增加 oldestLoadedIndex / hasOlderMessages / loadingOlderMessages + setter；持久化与旧快照兼容（可选链默认值）
    status: completed
  - id: switch-tail-first
    content: SessionHistoryPanel.switchSession 慢路径改为先 tail_rounds=3 渲染（去掉全屏骨架，仅顶部留位），写入分页 state；LRU 全量命中仍走秒开
    status: completed
  - id: scroll-up-load-older
    content: ChatPane 消息列表监听 scrollTop≈0，调用分页 API 取更早消息并 prepend，顶部显示 spinner，prepend 后用 scrollHeight 差值锚定滚动位置避免跳动
    status: completed
  - id: guard-full-loaders
    content: 当 pane 处于分页态（hasOlderMessages）时，reconcileDisplayedSessionFromDisk 不做全量 full-replace（避免把尾部视图替换成全量、defeats 分页）；mergeTailFromDisk / poll / automation / 飞书微信 全量路径维持原样
    status: completed
  - id: verify
    content: 改动文件无 lint/类型错误；vitest 通过；长对话切换实测尾部优先 + 上拉加载，全量旧路径行为不变
    status: completed
isProject: false
---

# 历史会话「尾部优先 + 上拉分页」加载

## 背景与现状（已 trace）

### 当前是全量加载，无分页

后端 `agenticx/studio/server.py:1612` 的 `GET /api/session/messages` 仅接受 `session_id`，无 `limit/offset/before`，始终返回完整列表：

```819:825:agenticx/studio/session_manager.py
    def get_messages(self, session_id: str) -> list[dict]:
        """Return normalized chat messages for session."""
        managed = self._sessions.get(session_id)
        if managed is not None:
            return self._normalize_messages(getattr(managed.studio_session, "chat_history", []) or [])
        payload = self._load_messages_snapshot(session_id)
        return self._normalize_messages(payload)
```

前端切会话慢路径（LRU 未命中）会先清空消息再显示全屏骨架，等整份历史拉完：

```668:687:desktop/src/components/SessionHistoryPanel.tsx
    // Slow path: clear old messages immediately + show skeleton ...
    setPaneMessages(targetPaneId, []);
    setPaneLoadingMessages(targetPaneId, true);
    try {
      const result = await window.agenticxDesktop.loadSessionMessages(sessionId);
      ...
        setPaneMessages(targetPaneId, mapped);
        cacheSessionMessages(sessionId, mapped);
```

骨架屏 UI 在 `desktop/src/components/ChatPane.tsx:7656`（`pane.loadingMessages && pane.sessionId`），即用户截图所见。

### 为什么长对话慢

读盘整份 `json.load` → 每条 `_normalize_messages`（含大附件 data URL）→ 整包经 IPC 回渲染进程 → 全量 `mapLoadedSessionMessage` + React 渲染。消息越多、单条越大，每一步都被放大。

### 内存 LRU 缓存

`desktop/src/store.ts:632` `SESSION_MESSAGE_CACHE_MAX = 10`，按 sid 缓存**全量** `Message[]`；命中即秒开、无骨架。长对话体积大、更易被挤出缓存，于是更频繁走慢路径。

## 目标

1. 切到未缓存会话时，**先渲染最近约 3 轮**（user+assistant 对话轮）即可见，不再全屏等整段历史。
2. 用户**向上滚动到顶部**时，顶部显示 spinner，增量加载更早消息并 prepend，滚动位置保持稳定。
3. **不破坏**现有全量加载语义：poll（委派/IM/飞书/微信）、`mergeTailFromDisk`、`reconcileDisplayedSessionFromDisk`、App.tsx automation 刷新、splash 预加载等继续按原逻辑工作。

## 方案

### FR-1 后端分页 API（向后兼容）

`GET /api/session/messages` 增加可选 query 参数（`agenticx/studio/server.py:1612` + `session_manager`）：

- `tail_rounds: int | None`：返回最近 N 个「对话轮」。轮 = 从尾部向前数到第 N 个 `role == "user"` 的消息，取它到末尾的全部消息（保留中间 assistant / tool 分组完整）。
- `before_index: int | None` + `limit: int`：向上翻页。返回完整列表中 `[max(0, before_index - limit), before_index)` 窗口。
- 三者都不传 → **保持现状全量返回**（poll/merge/reconcile 等老调用零改动）。

响应在分页时附加：
```json
{ "ok": true, "messages": [...], "start_index": 120, "total_count": 138, "has_older": true }
```
- `start_index`：本窗口首条在完整列表中的绝对下标；`has_older = start_index > 0`。
- 全量返回时这些字段可省略或填 `start_index=0`，前端据此识别全量。

`session_manager` 新增切片读取（不改 `get_messages`）：在**原始 list**（`chat_history` 或 `_load_messages_snapshot` 结果）上先按轮次/索引切片，再仅对窗口 `_normalize_messages`，降低 normalize 成本。索引基于「完整原始列表」的顺序下标。

> 游标选用 `before_index`（快照内有序、稳定）。删除/截断会改变快照，前端在下次翻页时按新 `total_count` 重新对齐即可；不引入服务端持久游标。

### FR-2 独立分页 IPC（不动全量通道）

新增 `load-session-messages-page`（`desktop/electron/main.ts` ipcMain.handle + `preload.ts` + `global.d.ts`）：

- 签名：`loadSessionMessagesPage(sessionId, { tailRounds?, beforeIndex?, limit? })`
- 复用 `getStudioUrl()/api/session/messages`，拼接对应 query；复用 `SESSION_MESSAGES_FETCH_TIMEOUT_MS` 与 token。
- 现有 `loadSessionMessages(sid)`（main.ts:4335 / preload.ts:330）**保持不变**，所有现存调用方不动。

### FR-3 ChatPane 分页 state（`desktop/src/store.ts`）

`ChatPane` 增加：
- `oldestLoadedIndex?: number`（当前已加载窗口首条的绝对下标；全量/未分页为 `0`）
- `hasOlderMessages?: boolean`
- `loadingOlderMessages?: boolean`

新增 setter；`App.tsx` 持久化恢复与 `makeDefaultPane()` 给默认值，旧 localStorage 快照用可选链/默认值兼容（参考 `sessionTokens` 既有兼容写法）。

### FR-4 切换会话尾部优先（`desktop/src/components/SessionHistoryPanel.tsx switchSession`）

- LRU **全量**命中（`getCachedSessionMessages`）：维持现状秒开、`hasOlderMessages=false`。
- 慢路径改为：`loadSessionMessagesPage(sid, { tailRounds: 3 })`
  - **不再全屏骨架**：不调用 `setPaneLoadingMessages(true)` 走全屏骨架；改为先清空 + 设置一个轻量「尾部加载中」（可复用骨架但仅短暂，或直接等 tail 很快返回后渲染）。
  - 返回后 `setPaneMessages(tail)`、`oldestLoadedIndex = start_index`、`hasOlderMessages`。
  - **不写入全量 LRU 缓存**（缓存仍只存全量语义，避免 poll/reconcile 误把 tail 当全量）。
- 失败兜底：回退到现有 `loadSessionMessages` 全量 + 骨架路径。

### FR-5 上拉加载更早消息（`desktop/src/components/ChatPane.tsx` 消息列表）

- 复用 `listRef`（:7643）。在 scroll 监听里检测 `scrollTop` 接近 0 且 `pane.hasOlderMessages && !pane.loadingOlderMessages`。
- 触发 `loadSessionMessagesPage(sid, { beforeIndex: oldestLoadedIndex, limit: 20 })`：
  - 顶部显示 spinner（`loadingOlderMessages`）。
  - prepend 更早消息到 `pane.messages`，更新 `oldestLoadedIndex = start_index`、`hasOlderMessages = start_index > 0`。
  - **滚动锚定**：prepend 前记录 `scrollHeight`，prepend 后 `scrollTop += (newScrollHeight - oldScrollHeight)`，避免视口跳动（不触发 `autoScrollPinnedRef` 误判）。
- 加载更早时切勿触发 `autoScrollPinnedRef`/自动滚底逻辑（:2736）。

### FR-6 全量加载路径与分页态的互斥守卫

仅一处需要改，其余维持原样：

- `reconcileDisplayedSessionFromDisk(sid)`（:3799）：当当前 pane 处于分页态（`hasOlderMessages === true` 或 `oldestLoadedIndex > 0`）时**跳过全量 full-replace**。否则它会把尾部视图整段替换成全量，等于废掉分页。idle 会话的尾部已在 FR-4 切换时取自磁盘，无需再全量对齐。
- `mergeTailFromDisk`（running 会话尾部并入）、`poll`（委派/IM/飞书/微信）、`App.tsx` automation `refreshSessionMessages`、splash 预加载：**全部维持全量**，不在本 plan 范围内修改。这些路径作用对象（running/特殊会话）与「浏览历史长对话」场景正交。

## 验收

- AC-1：切到未缓存的长对话，几百毫秒内看到最近约 3 轮，**不出现长时间全屏「正在加载会话…」**。
- AC-2：向上滚动到顶部，顶部出现 spinner 并增量加载更早消息；加载后视口位置稳定不跳动；加载到最早一条后 `has_older=false`，spinner 不再出现。
- AC-3：LRU 全量命中的会话仍秒开（行为不变）。
- AC-4：running 会话切回仍能流式续播 / `mergeTailFromDisk` 并入尾部（不受分页影响）；委派/IM/飞书/微信 poll、automation 刷新行为不变。
- AC-5：不传分页参数时 `GET /api/session/messages` 返回完整列表（老调用回归无差异）。

## 范围与排除

- 仅改 desktop 会话切换/滚动路径 + 新增分页 API/IPC + 一处 reconcile 守卫；**不动** Lite 端 `ChatView`（其加载在 :724，本次不改）、不动 SSE reader、不动 `mergeSessionMessagesTail` 算法。
- 不引入服务端持久分页游标；不改 LRU 全量缓存语义。
- 「轮」按 user-role 消息计数，不做更复杂的语义分组。
- 不改后端读盘为「真增量读」（messages.json 仍整份 load，优化点在 normalize 窗口 + 传输 + 渲染；如需真增量读盘另开 plan）。
