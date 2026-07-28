# Portal 历史会话：侧栏折叠 + 查看全部面板

Planned-with: composer-2.5  
Suggested-Impl-Model: composer-2.5（前端 Sheet/侧栏为主；pin 为小 DDL + PATCH）

## 问题

侧栏历史会话一长就挤占空间；缺少「查看全部」管理面。对标期望：侧栏「对话」可折叠；「查看全部」打开右侧面板，支持搜索、置顶、单删、批量删。

## In scope

1. 侧栏「对话」区块可折叠（localStorage 记忆）+「查看全部」入口
2. 右侧 `Sheet` 历史会话面板：按时间分组、标题搜索、置顶、重命名、单删、多选批量删
3. DB：`chat_sessions.pinned_at`（PG + MySQL 迁移）
4. API：`PATCH` 支持 `pinned`；`POST /api/chat/sessions/batch-delete`
5. list 附带 `preview`（首条 assistant，否则首条 user，截断 160）
6. store / history-client：`pinSession` / `deleteSessions`
7. zh/en i18n

## Out of scope

- 跨会话正文 FTS（本期仅标题 + preview 客户端过滤）
- 替换侧栏原生 `prompt`/`confirm` 为 Dialog（面板内可用 confirm；侧栏可保持现状）
- Desktop Machi 历史面板
- 管理台历史

## 落点

| 层 | 文件 |
|----|------|
| Schema | `enterprise/packages/db-schema/src/schema/chat-sessions.ts`、`mysql-schema/chat-sessions.ts`；`drizzle/0036_*.sql`、`drizzle-mysql/0008_*.sql` + journal |
| DTO | `enterprise/packages/core-api/src/chat.ts` → `ChatSession.pinned_at?` / `preview?` |
| Store | `sql-store.ts` `mapSession` / `listChatSessions` / `patchChatSession` / `softDeleteChatSessions` |
| Facade | `chat-history.ts`、`chat-history/types.ts` |
| API | `sessions/[sessionId]/route.ts`；新建 `sessions/batch-delete/route.ts` |
| Client | `history-client.ts`、`store.ts` |
| UI | 新建 `HistorySessionsPanel.tsx`；改 `WorkspaceShell.tsx` |
| i18n | `messages/zh.json`、`en.json` |

## 排序

`pinned_at IS NOT NULL` 优先 → `pinned_at DESC` → `created_at DESC`（侧栏与面板一致）。

## AC

- AC-1: 折叠「对话」后侧栏不展示列表项，仍可见「查看全部」
- AC-2: 「查看全部」打开右侧面板，展示全部分组会话与 preview
- AC-3: 搜索过滤标题（及 preview）
- AC-4: 置顶后列表置顶区优先，刷新后仍生效
- AC-5: 单删 / 批量删 soft-delete，列表与 active 会话正确回退
- AC-6: `db:migrate` 可加 `pinned_at` 列

## Suggested-Impl-Model 子表

| 子任务 | 推荐模型 |
|--------|----------|
| DDL + sql-store + API | composer-2.5 / kimi-code |
| Sheet 面板 + 侧栏折叠 | composer-2.5 |
