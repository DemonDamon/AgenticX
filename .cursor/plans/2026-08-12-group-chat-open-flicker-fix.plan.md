# 群聊打开初期「频闪加载对话」修复

Planned-with: kimi-k3
Suggested-Impl-Model: Composer 2.5 档即可（单文件、两处 effect 的精准修复；涉及 React key 稳定性与异步 effect 语义，需严格按本文 before/after 落地，不要自由发挥）

## 背景与现象

群聊窗格刚打开后，对话区有时反复闪烁「正在加载会话…」骨架屏 / 消息列表整体闪动，持续数秒后自行恢复（"到后面就没事了"）。

## 根因与证据链

### 根因 1（主因）：委派轮询用不稳定的 key 前缀整表替换消息列表

落点：`desktop/src/components/ChatPane.tsx` 的轮询 effect（约 L3335-3454），核心问题在 `poll()` 的写入分支（约 L3391-3414）：

- 群聊打开后若存在 running/pending 委派（`hasDelegation`，L3315-3330），`setup()` 会**立即执行一次 `void poll()`**（L3435）并启动 3s 间隔轮询（L3437）。
- `poll()` 全量 `loadSessionMessages` 后用 `` `dlgpoll-${currentSid}` `` 作为 id 前缀重新映射全部消息（L3411），再 `setPaneMessages(pane.id, deduped)` 整表替换（L3413）。
- 而首次加载（bootstrap effect，L5764-5790）与 `mergeTailFromDisk`（L6310-6351）使用的 id 前缀均为 `sid` 本身。消息列表按 `message.id` 作为 React key 渲染（L7378 `key={message.id}`）。
- 前缀不一致 → 所有已有气泡的 key 全变 → **React 卸载并重挂载整个消息列表**（头像/图片/Markdown/工具卡全部重新 mount）→ 视觉上的整屏闪烁。
- `lastPollCountRef` 在会话切换时清零（L3338-3341），因此打开后的第一次轮询即使没有任何新消息也必然触发一次整表替换（首次必闪）；委派进行中磁盘消息数持续增长，每 3 秒重复一次全量重挂载（持续闪）；委派结束后数量不再增长，提前 return（L3392）→ 闪烁停止。与「一开始频闪、后面没事」完全吻合。
- 正确姿势已存在于同文件：`mergeTailFromDisk` 使用的 `mergeSessionMessagesTail`（`desktop/src/utils/session-message-merge.ts:86`）以 `sessionId` 为前缀映射磁盘行（L92），并通过 `overlayMemoryEnrichment` 保留内存行 id（L64），已有行 key 稳定、仅增量追加；且 `mapLoadedSessionMessage` 的 id 含绝对索引 `${prefix}-i${idx}`（`desktop/src/utils/session-message-map.ts:245`），bootstrap 尾页映射使用 `startIndex + index`（`desktop/src/utils/session-tail-cache.ts:59-61`），与全量合并的绝对索引对齐，id 可正确匹配复用。

### 根因 2：bootstrap 失败重试会反复点亮骨架屏

落点：`desktop/src/components/ChatPane.tsx` 的首次加载 effect（L5728-5834）：

- 加载完成后若会话仍无可见消息（`hydrated === false`），会以 800/1600/2400/3200ms 退避重试最多 4 次（L5804-5813）。
- 每次重试重新执行 effect，`setPaneLoadingMessages(pane.id, true)`（L5762）→ 加载 → `false`（L5816）：骨架屏（L11773-11787）与空态（L11788+）来回切换约 5 次、持续约 8 秒 → 「频闪加载对话」。新群聊（本就无消息）或首次读取恰遇磁盘写入竞争时必现。

### 非根因（已排除）

- `mergeTailFromDisk` / reattach 路径：增量合并、key 稳定，无此问题。
- 飞书/微信绑定轮询（L3510）只读绑定文件，不写消息。
- `openGroupPane`（`desktop/src/hooks/usePaneNavigation.ts:175-219`）的三段式加载（初始化 → 骨架 → 消息）属正常冷启动，不在本次修复范围。

## 需求

### FR-1：轮询写入改为增量合并（稳定 key）

`desktop/src/components/ChatPane.tsx` `poll()`（约 L3391-3414）：

- 删除 `seen`/`deduped` 去重循环与 `` `dlgpoll-${currentSid}` `` 前缀映射。
- 改为：读取当前内存消息 → `mergeSessionMessagesTail(current, result.messages as LoadedSessionMessage[], currentSid)` → 仅当 `merged.length !== current.length` 或末条 content 变化时 `setPaneMessages(pane.id, merged)`（与 `mergeTailFromDisk` L6336-6343 的 changed 判定一致）。
- 合并生效后，若 `livePane.hasOlderMessages` 为 true 或 `oldestLoadedIndex > 0`，调用 `setPaneMessagePaging(pane.id, { oldestLoadedIndex: 0, hasOlderMessages: false, loadingOlderMessages: false })` 复位分页游标（全量合并后内存已覆盖完整磁盘历史；否则顶部「加载更早消息」会按旧游标拉取与内存同 id 的行造成重复 key）。注意：本计划范围内**只**在轮询路径复位；`mergeTailFromDisk` 路径的同类分页陈旧属既有问题，列入 Out of scope。
- 保留 `lastPollCountRef` 提前 return（L3392）作为廉价短路；`changed` 判定兜住「首次轮询无新消息」场景（原根因 1 的"首次必闪"）。
- 行为变化说明（有意为之）：原去重逻辑按 `role::content[:300]::附件签名` 丢弃重复行，会误删合法重复消息（如连发两条"好的"）；其他所有加载路径（bootstrap / mergeTailFromDisk / 历史面板）均不去重。改为合并后与全仓各路径行为一致。
- effect 依赖数组（L3445-3454）补充 `setPaneMessagePaging`。

### FR-2：bootstrap 重试静默化（骨架屏只亮一次）

`desktop/src/components/ChatPane.tsx` 首次加载 effect 的 async 块（L5761-5825）：

- 进入 async 块时捕获 `const showSkeleton = sessionBootstrapAttemptRef.current === 0;`（`sessionBootstrapAttemptRef` 在会话切换 effect L5709-5719 中已归零，重试由 `setSessionBootstrapRetryNonce` 触发前已 +1，故重试期间该值 ≥ 1）。
- `setPaneLoadingMessages(pane.id, true)`（L5762）改为仅 `showSkeleton` 时执行。
- `finally` 中 `setPaneLoadingMessages(pane.id, false)`（L5816）改为 `if (!cancelled && showSkeleton)`。
- cleanup（L5819-5825）中 `setPaneLoadingMessages(pane.id, false)` 同样加 `showSkeleton` 条件。
- **重试条件与退避不变**（空会话/读取失败仍最多静默重试 4 次）：保留「会话刚建、消息稍后落盘」的自愈能力；重试不再有点亮骨架屏的视觉效果。

## 验收标准（AC）

- AC-1（FR-1 静态）：`grep -n "dlgpoll" desktop/src/components/ChatPane.tsx` 无任何匹配；`poll()` 内不再出现 `setPaneMessages(pane.id, deduped)`。
- AC-2（FR-1 类型）：`cd desktop && npx tsc --noEmit` 通过（0 error）。
- AC-3（FR-1 回归）：`cd desktop && npx vitest run src/utils/session-message-merge.test.ts src/utils/message-ownership.test.ts src/utils/session-reattach.test.ts` 全绿（合并未改动，仅确认调用方假设仍成立）。
- AC-4（FR-2 静态）：`ChatPane.tsx` 首次加载 effect 中 `setPaneLoadingMessages(pane.id, true)` 仅出现在 `showSkeleton` 分支内；重试调度代码（`setSessionBootstrapRetryNonce`）保持原条件。
- AC-5（人工验证 FR-1）：打开一个有成员正在回复（委派进行中）的群聊 → 消息区不再每 3 秒整屏闪烁，新回复以追加方式出现，已有气泡不重挂载（头像不重新加载、图片不闪）。
- AC-6（人工验证 FR-2）：新建群聊或打开空会话群 → 「正在加载会话…」骨架屏至多出现一次，不再与空态来回切换；稍后成员回复落盘后消息能自动出现（静默重试/轮询自愈）。

## In scope

- `desktop/src/components/ChatPane.tsx`：`poll()` 写入分支（FR-1）、首次加载 effect 的骨架屏开关（FR-2）、轮询 effect 依赖数组。

## Follow-up（2026-08-12）：空群重启骨架屏偏慢

用户反馈：重启后打开尚未对话的群聊，仍长时间停在「正在加载会话…」。

根因补充：
- bootstrap 把「tail 成功且 messages=[]」与「tail 失败」混为一谈，空会话也会再打一轮 `loadSessionMessages` 全量 fallback。
- 全量/tail 都确认空时未写 `sessionBootstrapRef`，finally 仍按 `!hydrated` 调度最多 4 次重试。

修复（同文件 bootstrap effect）：
- `entry && messages.length===0 && !hasOlder` → 标记 bootstrapped，直接出空态，跳过全量二次加载。
- `full.ok`（含空数组）→ 标记 bootstrapped。
- finally 仅在 `sessionBootstrapRef !== sid`（真正加载失败）时重试。

## Out of scope（no-scope-creep 边界）

- 不改 `mergeSessionMessagesTail` / `session-tail-cache.ts` / `usePaneNavigation.ts` 任何逻辑。
- 不改 `mergeTailFromDisk`（reattach）路径的全量合并后分页游标陈旧问题（既有、与本次频闪无直接因果，如需修复另立 plan）。
- 不做群列表预热（`schedulePrefetchSessionTail` 接入 `ProjectsView`）与三段式加载态合并——属体验增强，用户已选择暂不做。
- 不改 SidebarSessionHistory 的 `setPaneLoadingMessages` 使用（历史面板切会话路径，与群聊打开无关）。
- 不重构 `poll()` 的触发条件（`hasDelegation` / `needsExternalPoll` 判定）与 3s 间隔。

## 影响面与风险

- 仅 `ChatPane.tsx` 两处 effect；合并函数为既有已测工具（`session-message-merge.test.ts` 覆盖）。
- 轮询路径去掉内容去重后，若磁盘 `messages.json` 因历史 bug 存在完全重复行，群聊会如实展示（与其他路径一致），不属于本次引入的回归。
- 全量合并后复位分页游标：用户上翻「加载更早消息」按钮在轮询合并生效后消失（内存已是全量），语义正确。
