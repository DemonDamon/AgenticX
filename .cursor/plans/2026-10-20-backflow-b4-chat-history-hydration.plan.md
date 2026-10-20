# 能力回流 B4：会话列表分页、早落库与防重复首发

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: B3（`store.ts` 归属顺序 B3 → B4；B3 的落盘也要用到本计划放宽后的落库条件）

## 目标

1. 历史会话很多时，门户首屏先出会话列表（分页，每页 40），消息按需并行加载，不再等整表加载完。
2. 会话列表一加载出来，新对话就能落库；不必等全部历史和首选会话的消息都加载完（否则刚打开页面就发消息再刷新，这轮会丢）。
3. 同一个草稿会话快速按两次回车、或首发途中切换会话，不会发出两次、也不会把回答写到别的会话里。

## 现状（已核实）

- 后端：`enterprise/apps/web-portal/src/lib/chat-history/sql-store.ts` L163 `listChatSessions(ctx)` 一次查全表；接口 `src/app/api/chat/sessions/route.ts` `GET` 直接返回 `{sessions}`；类型 `lib/chat-history/types.ts` L30。`chat_sessions.pinned_at` 已有（迁移 `0036`），无需新迁移。
- 前端：`enterprise/features/chat/src/history-client.ts` L175 `listSessions()` 无分页；`store.ts` L1324 `hydrateSessions()` 等列表与首选会话消息都到齐才置 `hydrated: true`（L1339 / L1378）；落库处普遍以 `get().hydrated` 为前提（如 L962、L1066、L1838）。没有草稿首发去重。
- 门户：`src/components/MachiChatView.tsx` 发送入口；历史面板 `src/components/HistorySessionsPanel.tsx`；`src/components/WorkspaceShell.tsx`。
- 来源（`$DELIVERY_REPO`）：`8fb70ad7`（分页与并行加载：新 `apps/web-portal/src/lib/chat-history/session-list-cursor.ts`、`sql-store.ts` `listChatSessionsPage`、`history-client.ts` `HISTORY_PAGE_SIZE=40`、store hydrate 改造、sessions 接口与历史面板）、`67443250`（`canPersistHistory`）、`8f26e188`（`draftSubmissionInFlight`、`shouldIgnoreComposerSubmission`、`onAccepted`）。

## 改动

### 1. 分页（后端）

- 新文件 `lib/chat-history/session-list-cursor.ts`（+ test）：游标 = `(pinnedAt | null, createdAt, id)` 的 base64url JSON；`encode` / `decode`（非法游标返回 `null`）。
- `sql-store.ts` 新方法 `listChatSessionsPage(ctx, { limit, cursor })`：排序与现有列表一致（置顶在前、再按时间倒序、`id` 兜底）；按游标做 keyset 分页；返回 `{ sessions, nextCursor }`。PG / MySQL 两种方言都要写（沿用文件内现有方言分支写法）。`listChatSessions` 保留（其他调用方仍在用）。
- `types.ts` 接口加 `listChatSessionsPage`；`chat-history` 门面导出同名函数。
- `api/chat/sessions/route.ts` `GET`：有 `?limit=` 或 `?cursor=` 时走分页并返回 `{ sessions, next_cursor }`；无参数保持原响应（兼容桌面端或其他调用方）。`limit` 范围 1–100，默认 40。

### 2. 分页与并行加载（前端）

- `history-client.ts`：新增 `listSessionsPage({ limit, cursor })`；`HISTORY_PAGE_SIZE = 40`。
- `store.ts` `hydrateSessions`：先拉第一页列表 → 立即写入侧栏并置新状态 `historyListLoaded: true`；首选会话消息与其余加载并行进行；历史面板滚到底时拉下一页（`loadMoreSessions()`，有 `nextCursor` 才拉）。`hydrated` 的置位时机与含义保持（列表 + 首选会话消息都好），供其他逻辑继续使用。
- `HistorySessionsPanel.tsx`：列表底部「加载更多」或滚动到底自动加载；加载中显示行内小提示。

### 3. 早落库

- `store.ts` 新增 `canPersistHistory(state) = state.hydrated || state.historyListLoaded || state.historyPrincipal !== null`（`historyPrincipal` 为已知登录身份，照搬交付仓定义；若主仓 store 没有等价字段，以「已拿到当前登录用户 id」为准，从现有会话信息里取）。
- 草稿晋升为真实会话（`createSession`）、流开始前落库、普通回答落盘（B3）、深度研究落盘（L1838 / L1843）的前提从 `get().hydrated` 改为 `canPersistHistory(get())`。其余以 `hydrated` 为前提的逻辑不改。

### 4. 防重复首发与切换竞态

- `store.ts`：模块级 `draftSubmissionInFlight: Set<string>`；同一草稿 id 首发进行中再次发送直接返回；首发结束（成功或失败）移除。
- `MachiChatView.tsx`：照搬 `shouldIgnoreComposerSubmission`（输入框 revision 未变时忽略重复回车）；`sendMessage` 增加 `onAccepted(realSessionId)` 回调，草稿晋升后把后续写入绑定到真实会话 id，期间用户切到别的会话也不会写错地方。

## 剥离

`8f26e188` 里与附件会话围栏、水印助手相关的分支不搬；只搬与草稿首发和会话切换相关的部分。

## In scope / Out of scope

- In：会话列表分页（后端 + 前端 + 历史面板）、早落库条件、草稿首发去重与会话绑定。
- Out：消息分页、搜索历史、桌面端历史接口、置顶逻辑改动。

## 验收

- AC-1：`apps/web-portal`：`lib/chat-history/session-list-cursor.test.ts`；`sql-store` 分页用例（置顶在前；跨页不重不漏；非法游标从头开始）放在现有 sql-store 测试文件或新 `sql-store-page.test.ts`；`app/api/chat/sessions/route.test.ts`（有参数返回 `next_cursor`，无参数保持原形状）。
- AC-2：`features/chat`：`store.history.test.ts` 扩充：列表加载完、消息未到时发送 → 会话已落库；`loadMoreSessions` 追加不重复；`store.deep-research.test.ts` 或新文件：同一草稿连续两次 `sendMessage` 只发一次；首发途中切换会话，回答仍写入原会话。
- AC-3：`pnpm -C enterprise/features/chat test`；`pnpm -C enterprise/apps/web-portal typecheck && test`（除基线 10 条外无新增失败）。
- AC-4（验收方手工）：本机造 150 个会话（脚本或接口批量建），刷新门户：侧栏立即出现前 40 个，滚动加载其余；打开页面立刻发消息并在 2 秒内刷新，这轮对话还在；快速双击回车只出现一轮。

## 验收记录

- 2026-10-20 Opus 5.5 复核（自动部分）：`features/chat` 270 项仅基线 `store.multi-session` 一条失败；门户 995 项仅基线 orchestrator 续期一条失败；门户类型错误仍 26 条（`store.ts` 原有错误行号下移到 L1356）。
- 手工（浏览器 + 本地 MySQL）：批量造 45 个有消息的会话后，`GET /api/chat/sessions?limit=40` 第一页 40 条、带游标第二页 17 条，合计与不分页的全量 57 条一致、无重叠、末页游标为空；刷新后侧栏与历史面板先显示 40 条，「加载更多」后补齐到 45 条测试会话且按钮消失。测试会话已删除。
- 与计划的差异（实施方说明，验收认可）：保留原 `listSessions()`，另加 `listSessionsPage`；补了按 id 读取单个会话，避免上次打开的会话或进行中的研究会话不在第一页时刷新后被切走；`sessions-isolation.test.ts` 调用处补 `Request` 参数以保持路由类型；早落库只放宽计划点名的几处，其余仍看 `hydrated`。
