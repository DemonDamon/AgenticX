---
name: enterprise-chat-history-persistence
overview: Enterprise 前台用户端聊天历史服务端持久化。为 web-portal 增加 PostgreSQL-backed chat_sessions/chat_messages 数据层、Route Handlers、前端 store 异步同步与侧栏恢复能力，解决重新登录/刷新后历史记录为空的问题。
todos:
  - id: T01
    content: 现状基线与失败测试：确认 useChatStore 纯内存、db-schema 无会话/消息表、重新登录后历史为空的复现路径
    status: completed
  - id: T02
    content: db-schema 新增 chat_sessions / chat_messages 表与 drizzle migration，包含 tenant/user/session 索引与软删除字段
    status: completed
  - id: T03
    content: web-portal 新增服务端 chat history repository，所有查询强制从登录 session 注入 tenantId/userId
    status: completed
  - id: T04
    content: web-portal 新增 /api/chat/sessions REST 路由，覆盖列表/创建/重命名/删除/消息读取/消息追加
    status: completed
  - id: T05
    content: feature-chat store 改造为异步 hydration + server sync，避免 bootstrap 每次 mount 覆盖已有历史
    status: completed
  - id: T06
    content: WorkspaceShell/MachiChatView 接线 loading/error/empty states，侧栏历史从服务端恢复
    status: completed
  - id: T07
    content: 补齐单元/API/端到端冒烟测试，验证刷新、重新登录、跨浏览器同账号恢复历史
    status: completed
  - id: T08
    content: 文档与提交：更新本地开发说明，按 schema/API/frontend 三段提交并带 Plan-Id
    status: completed
isProject: false
---

# Enterprise Chat History Persistence Implementation Plan

> **For Cursor:** REQUIRED SUB-SKILL when implementing: use `test-driven-development`, then `executing-plans`, and request code review after each major layer.

**Goal:** 让 Enterprise 前台用户端的聊天会话与消息真正写入 PostgreSQL，刷新页面、重新登录、换浏览器后仍能恢复历史记录。

**Architecture:** 以 `enterprise/packages/db-schema` 作为单一 schema 来源，新增 `chat_sessions` 与 `chat_messages` 两张多租户表；`apps/web-portal` 提供只读当前登录态的 Route Handlers；`features/chat` 的 Zustand store 从纯内存改为“服务端 hydrate + 乐观 UI + 写后同步”的模式。所有 tenant/user 边界只从 `getSessionFromCookies()` 注入，前端不得自行传入 tenant_id/user_id 作为信任来源。

**Tech Stack:** Next.js Route Handlers, Drizzle ORM, PostgreSQL, React/Zustand, `@agenticx/core-api` chat types, existing `@agenticx/sdk-ts` chat client.

---

## Current Diagnosis

当前历史为空不是 Postgres/Redis 没起，而是功能没有接线：

- `enterprise/features/chat/src/store.ts` 的 `sessions/messages` 全在 Zustand 内存里。
- `MachiChatView` 在 `sessions.length === 0` 时调用 `bootstrap()`，每次新进页面都会造一个新的「欢迎使用 AgenticX」本地 session。
- `WorkspaceShell` 侧栏历史只是读取 `useChatStore((s) => s.sessions)`，没有服务端数据源。
- `enterprise/packages/db-schema/src/schema/` 目前没有 `chat_sessions` / `chat_messages`。
- `apps/web-portal/src/app/api/chat/completions/route.ts` 只转发单次模型请求到 gateway，不负责保存 request/response。

因此“中间件已启动”只让 `usage_records` 这类已接线的表能持久化，聊天历史仍然会在页面 reload 或重新登录后丢失。

## Requirements

### Functional Requirements

- FR-1: 用户登录前台后，侧栏展示当前 `tenantId + userId` 下的历史会话，按 `updated_at desc` 排序。
- FR-2: 新建会话后立即在 UI 出现，并写入 `chat_sessions`。
- FR-3: 发送消息时，用户消息与助手最终消息都写入 `chat_messages`，并更新 `chat_sessions.message_count/last_message_at/updated_at/title`。
- FR-4: 第一条用户消息自动生成标题，沿用现有 `buildAutoTitleFromFirstUserMessage()` 规则。
- FR-5: 切换历史会话时，从服务端读取该 session 的 messages 并渲染。
- FR-6: 重命名会话、删除会话须同步到 DB；删除为软删除，避免审计链断裂。
- FR-7: 刷新页面、退出再登录、换浏览器后，同一账号能恢复历史。
- FR-8: 历史只按当前登录 session 的 tenant/user 过滤；不得允许用户通过前端传参读到其他用户历史。

### Non-Functional Requirements

- NFR-1: 保持现有聊天发送体验为乐观 UI，不因 DB 写入等待阻塞输入框。
- NFR-2: API 返回结构化 JSON 错误，前端不再出现裸 `Unexpected end of JSON input`。
- NFR-3: 避免一次性大改 `ChatClient` 协议；持久化先在 `web-portal` + `feature-chat` 层完成。
- NFR-4: 所有新增表必须有 tenant/user/session 维度索引，避免历史列表和消息读取全表扫。
- NFR-5: 不依赖 Redis 存历史；Redis 后续可用于缓存/限流，但历史主存储为 PostgreSQL。

### Acceptance Criteria

- AC-1: 登录 owner 用户，发送一轮 MiniMax/DeepSeek 对话，刷新 `/workspace` 后侧栏仍显示该会话，消息内容仍在。
- AC-2: 退出登录再登录，同一账号仍能看到历史。
- AC-3: 使用另一个用户登录，看不到 owner 的历史。
- AC-4: 删除会话后侧栏不再显示，DB 行保留 `deleted_at`。
- AC-5: `pnpm --filter @agenticx/db-schema typecheck` 与 `pnpm --filter @agenticx/app-web-portal typecheck` 通过。
- AC-6: 新增 API 单元/集成测试覆盖 unauthorized、tenant/user isolation、create/list/read/update/delete。

---

## Task 1: Baseline Failing Tests

**Files:**

- Create: `enterprise/apps/web-portal/src/lib/chat-history.test.ts`
- Create or modify depending existing test setup: `enterprise/apps/web-portal/src/app/api/chat/sessions/route.test.ts`
- Reference: `enterprise/features/chat/src/store.ts`
- Reference: `enterprise/apps/web-portal/src/components/MachiChatView.tsx`

**Steps:**

1. Write failing tests documenting the current expected behavior:
   - `listSessions()` returns only current tenant/user sessions.
   - `appendMessages()` persists user + assistant messages in order.
   - `softDeleteSession()` hides deleted sessions.
2. If the repo has no test harness for Next Route Handlers yet, add narrow tests around the repository functions first and defer full Route Handler tests to Task 4.
3. Run:

```bash
cd enterprise
pnpm --filter @agenticx/app-web-portal typecheck
```

Expected before implementation: repository imports/functions do not exist.

---

## Task 2: Database Schema And Migration

**Files:**

- Create: `enterprise/packages/db-schema/src/schema/chat-sessions.ts`
- Create: `enterprise/packages/db-schema/src/schema/chat-messages.ts`
- Modify: `enterprise/packages/db-schema/src/schema/index.ts`
- Generate: `enterprise/packages/db-schema/drizzle/<next>_*.sql`
- Modify: `enterprise/packages/db-schema/drizzle/meta/_journal.json`
- Generate: `enterprise/packages/db-schema/drizzle/meta/<next>_snapshot.json`

**Schema Design:**

`chat_sessions`:

- `id ulid primary key`
- `tenant_id ulid not null references tenants(id)`
- `user_id ulid not null references users(id)`
- `title varchar(160) not null`
- `active_model varchar(160)`
- `message_count integer not null default 0`
- `last_message_at timestamp with time zone`
- `deleted_at timestamp with time zone`
- `created_at / updated_at`

Indexes:

- `chat_sessions_tenant_user_updated_idx` on `(tenant_id, user_id, updated_at)`
- `chat_sessions_tenant_user_deleted_idx` on `(tenant_id, user_id, deleted_at)`

`chat_messages`:

- `id ulid primary key`
- `session_id ulid not null references chat_sessions(id)`
- `tenant_id ulid not null references tenants(id)`
- `user_id ulid not null references users(id)`
- `role varchar(32) not null` (`user | assistant | system | tool`)
- `content text not null`
- `model varchar(160)`
- `status varchar(32) not null default 'complete'`
- `metadata jsonb`
- `created_at / updated_at`

Indexes:

- `chat_messages_session_created_idx` on `(session_id, created_at)`
- `chat_messages_tenant_user_session_idx` on `(tenant_id, user_id, session_id)`

**Steps:**

1. Implement Drizzle schema using local conventions from `usage-records.ts` and `users.ts`.
2. Export both files from `schema/index.ts`.
3. Run:

```bash
cd enterprise/packages/db-schema
pnpm db:generate
pnpm typecheck
```

4. Apply migration locally:

```bash
cd enterprise/packages/db-schema
pnpm db:migrate
```

5. Verify tables:

```bash
docker exec agenticx-postgres-dev psql -U postgres -d agenticx -c '\dt chat_*'
```

Expected: `chat_sessions` and `chat_messages` exist.

---

## Task 3: Web Portal Chat History Repository

**Files:**

- Create: `enterprise/apps/web-portal/src/lib/chat-history.ts`
- Modify if needed: `enterprise/apps/web-portal/package.json` to include `drizzle-orm` / `pg` only if not already available transitively; prefer direct dependency if imported here.

**Repository API:**

```ts
export type ChatHistoryContext = {
  tenantId: string;
  userId: string;
};

export async function listChatSessions(ctx: ChatHistoryContext): Promise<ChatSession[]>;
export async function createChatSession(ctx: ChatHistoryContext, input: { title: string; activeModel?: string }): Promise<ChatSession>;
export async function getChatSessionMessages(ctx: ChatHistoryContext, sessionId: string): Promise<ChatMessage[]>;
export async function appendChatMessages(ctx: ChatHistoryContext, sessionId: string, messages: ChatMessage[]): Promise<void>;
export async function renameChatSession(ctx: ChatHistoryContext, sessionId: string, title: string): Promise<ChatSession>;
export async function softDeleteChatSession(ctx: ChatHistoryContext, sessionId: string): Promise<void>;
```

**Steps:**

1. Create a small Drizzle client helper scoped to `DATABASE_URL`.
2. Every repository query must include both `tenantId` and `userId`.
3. `appendChatMessages()` should:
   - verify session ownership first;
   - insert messages;
   - update session `message_count`, `last_message_at`, `updated_at`;
   - if title is placeholder and first user message exists, set auto title.
4. Return shapes must match `@agenticx/core-api` `ChatSession` / `ChatMessage`.

---

## Task 4: REST API Routes

**Files:**

- Create: `enterprise/apps/web-portal/src/app/api/chat/sessions/route.ts`
- Create: `enterprise/apps/web-portal/src/app/api/chat/sessions/[sessionId]/route.ts`
- Create: `enterprise/apps/web-portal/src/app/api/chat/sessions/[sessionId]/messages/route.ts`
- Modify: `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts`

**Endpoints:**

- `GET /api/chat/sessions`
- `POST /api/chat/sessions`
- `PATCH /api/chat/sessions/:sessionId`
- `DELETE /api/chat/sessions/:sessionId`
- `GET /api/chat/sessions/:sessionId/messages`
- `POST /api/chat/sessions/:sessionId/messages`

**Steps:**

1. All handlers call `getSessionFromCookies()` and reject missing session with `401`.
2. Never trust `tenantId/userId` from request body.
3. Add structured error responses:

```json
{ "code": "40101", "message": "unauthorized" }
```

4. Update `/api/chat/completions` only if needed to ensure `sessionId` in request maps to a persisted session before gateway call. Keep streaming behavior unchanged.

---

## Task 5: Feature Chat Store Sync

**Files:**

- Modify: `enterprise/features/chat/src/store.ts`
- Potentially create: `enterprise/features/chat/src/history-client.ts`
- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx`
- Modify: `enterprise/apps/web-portal/src/components/WorkspaceShell.tsx`

**Store Changes:**

Add state:

- `hydrated: boolean`
- `historyLoading: boolean`
- `historyError: string | null`

Add actions:

- `hydrateSessions(historyClient)`
- `createSession(historyClient, params)`
- `switchSession(historyClient, sessionId)`
- `persistMessages(historyClient, sessionId, messages)`

**Steps:**

1. `MachiChatView` should call `hydrateSessions()` once after models are loaded.
2. `bootstrap()` should not overwrite an already hydrated non-empty session list.
3. New chat should call server `POST /api/chat/sessions` first or perform optimistic local create then reconcile with server ID. Prefer server create first for ID consistency.
4. On send:
   - keep current optimistic append;
   - after assistant completes, `POST /messages` with the final user + assistant messages.
5. On switch:
   - set active session immediately;
   - fetch messages for that session;
   - show loading state inside message list area if fetch is slow.

---

## Task 6: UI States And Product Behavior

**Files:**

- Modify: `enterprise/apps/web-portal/src/components/WorkspaceShell.tsx`
- Modify: `enterprise/apps/web-portal/src/components/MachiChatView.tsx`
- Modify: `enterprise/features/chat/src/components/molecules/MessageList.tsx` if loading/empty states need a shared component.

**Behavior:**

1. Sidebar while hydrating:
   - show a subtle loading row, not an empty “今天” section.
2. Empty user history:
   - show only the initial welcome session if no persisted sessions exist.
3. Deleted active session:
   - switch to most recent remaining session;
   - if none exists, create a fresh server session.
4. API failures:
   - do not drop in-memory messages immediately;
   - show inline warning/toast and allow refresh.

---

## Task 7: Verification

**Commands:**

```bash
cd enterprise
pnpm --filter @agenticx/db-schema typecheck
pnpm --filter @agenticx/app-web-portal typecheck
pnpm --filter @agenticx/app-web-portal build
```

**Manual E2E:**

1. Start:

```bash
cd enterprise
bash scripts/start-dev-with-infra.sh
```

2. Login to `http://localhost:3000/workspace` as owner.
3. Send a message using any visible model.
4. Confirm DB rows:

```bash
docker exec agenticx-postgres-dev psql -U postgres -d agenticx -c \
  "select title, message_count from chat_sessions order by updated_at desc limit 5;"
docker exec agenticx-postgres-dev psql -U postgres -d agenticx -c \
  "select role, left(content, 40) from chat_messages order by created_at desc limit 10;"
```

5. Refresh browser: session and messages remain.
6. Logout/login: session and messages remain.
7. Login as another seeded user: owner history does not appear.

---

## Commit Plan

Commit 1:

- `feat(db-schema): add chat history tables`
- Includes Task 2 schema + migration only.

Commit 2:

- `feat(web-portal): add chat history API`
- Includes Task 3-4 repository and routes.

Commit 3:

- `feat(chat): persist portal sessions and messages`
- Includes Task 5-6 store/UI integration.

Commit 4:

- `test(chat): cover enterprise chat history persistence`
- Includes Task 7 tests/docs polish if not naturally included earlier.

All commits must include:

```text
Plan-Id: 2026-05-03-enterprise-chat-history-persistence
Plan-File: .cursor/plans/2026-05-03-enterprise-chat-history-persistence.plan.md
Made-with: Damon Li
```

