# Near Share SP1：官网分享服务核心

Planned-with: GPT-5.6 Sol  
Suggested-Impl-Model: Cursor Grok 4.5 High Fast  
Plan-Id: `2026-07-21-near-share-cloud-core`  
Parent-Plan: `.cursor/plans/2026-07-21-near-public-conversation-sharing.plan.md`

## 目标

在 `AgenticX-Website` 落地版本化快照契约、Supabase bearer 鉴权、Drizzle 数据表以及创建、列表、匿名读取、撤销和 token refresh API，为后续公开页面与 Near Desktop 提供冻结接口。

## 前置与完成条件

- 前置：无；这是 DAG 根节点。
- 完成后才允许启动 SP2、SP3。
- 本计划完成不包含分享页面和 Desktop UI。

## 现状证据

- `AgenticX-Website/src/db/schema.ts` 当前只有 `deviceAuthRequests`。
- `AgenticX-Website/src/app/api/auth/device/confirm/route.ts::POST` 已通过 `createSupabaseAdmin().auth.getUser(token)` 验证 Supabase bearer，可提取为复用 helper。
- `AgenticX-Website/src/app/api/auth/device/poll/route.ts::GET` 已下发 refresh token，但仓库没有 refresh endpoint。
- `AgenticX-Website/package.json` 没有 test script，仓内也没有 Website 单测。

## In scope files

新增：

- `AgenticX-Website/tests/fixtures/conversation_share_v1.json`
- `AgenticX-Website/vitest.config.ts`
- `AgenticX-Website/src/lib/shares/contract.ts`
- `AgenticX-Website/src/lib/shares/errors.ts`
- `AgenticX-Website/src/lib/shares/auth.ts`
- `AgenticX-Website/src/lib/shares/body.ts`
- `AgenticX-Website/src/lib/shares/repository.ts`
- `AgenticX-Website/src/lib/shares/service.ts`
- `AgenticX-Website/src/lib/shares/runtime.ts`
- `AgenticX-Website/src/lib/shares/__tests__/contract.test.ts`
- `AgenticX-Website/src/lib/shares/__tests__/service.test.ts`
- `AgenticX-Website/src/lib/shares/__tests__/repository.integration.test.ts`
- `AgenticX-Website/tests/helpers/share-test-db-guard.ts`
- `AgenticX-Website/tests/setup-share-test-db.ts`
- `AgenticX-Website/src/app/api/shares/route.ts`
- `AgenticX-Website/src/app/api/shares/[slug]/route.ts`
- `AgenticX-Website/src/app/api/auth/device/refresh/route.ts`
- 对应 route tests，放在各 route 相邻 `__tests__/route.test.ts`
- Drizzle 生成的 `AgenticX-Website/drizzle/0001_*.sql` 与 meta 更新
- `AgenticX-Website/scripts/provision-share-runtime-role.sql`

修改：

- `AgenticX-Website/package.json`
- `AgenticX-Website/pnpm-lock.yaml`
- `AgenticX-Website/.env.example`
- `AgenticX-Website/drizzle.config.ts`
- `AgenticX-Website/src/db/schema.ts`
- `AgenticX-Website/src/lib/supabase/server-admin.ts`（仅在复用 refresh/client helper 确有需要时精确扩展）
- `AgenticX-Website/src/app/api/auth/device/confirm/route.ts`（仅允许用新 auth helper 做等价替换；否则不改）
- AgenticX 主仓 `.cursor/plans/2026-07-21-near-public-conversation-sharing.plan.md` 的执行证据段（由独立主仓 evidence commit 填写，不进入 Website commit）

## Out of scope files

- `desktop/**`
- `agenticx/studio/server.py`
- `enterprise/**`
- `AgenticX-Website/src/app/[locale]/s/**`（SP2）
- 根 `vercel.json`

## 实现设计

### 1. 测试基础与 golden fixture

先使用包管理器添加测试依赖，不手写版本：

```bash
pnpm -C AgenticX-Website add -D vitest tsx
```

在 `package.json` 增加：

```json
{
  "scripts": {
    "test:shares": "vitest run src/lib/shares src/app/api/shares src/app/api/auth/device/refresh --exclude '**/*.integration.test.ts'",
    "test:shares:integration": "tsx tests/setup-share-test-db.ts && vitest run src/lib/shares/__tests__/repository.integration.test.ts"
  }
}
```

使用包管理器同时添加 `tsx` 作为 dev dependency；默认 `test:shares` 永远不连接真实数据库。

`SHARE_TEST_DATABASE_URL` 集成测试只允许 loopback PostgreSQL、数据库名必须等于 `SHARE_TEST_EXPECTED_DATABASE` 且以 `_test` 结尾，并要求 `SHARE_TEST_ALLOW_DB_WRITE=1`。`setup-share-test-db.ts` 在这些检查通过后，使用测试 owner 连接依次创建固定 NOLOGIN test runtime group role、调用 Drizzle migrator 应用 `drizzle/` migrations、创建 `share_e2e_sentinel(environment='test')`；guard 缺任一条件即在 role/migration/写入前退出。SP5 复用同一 helper，不另造第二套 guard。

`vitest.config.ts`：

- `environment: "node"`
- 将 `@` alias 指向 `AgenticX-Website/src`
- 不启用 browser/jsdom

`AgenticX-Website/tests/fixtures/conversation_share_v1.json` 必须覆盖：

- `scope: "turn"`
- user + assistant 两条消息
- user 附件 metadata
- assistant Markdown 链接与代码块
- 不含任何本地 id/path/tool/reasoning 字段

Website 与主仓分别保存 fixture：Website 使用本文件；Desktop 使用 `desktop/tests/fixtures/conversation_share_v1.json`。两份内容与 SHA-256 必须一致；修改协议时同步更新两份副本、Master 中记录的摘要和 `schemaVersion`。

### 2. 版本化 Zod 契约

在 `src/lib/shares/contract.ts`：

- 定义 Parent Plan 中的 TypeScript 类型。
- 使用现有 `zod` 定义 `conversationShareSnapshotV1Schema` 和 `createShareRequestSchema`。
- 导出常量：

```ts
SHARE_SCHEMA_VERSION = 1
SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000
SHARE_MAX_ACTIVE_PER_USER = 100
SHARE_MAX_CREATED_PER_24H = 50
SHARE_MAX_MESSAGES = 200
SHARE_MAX_CONTENT_CHARS = 65_536
SHARE_MAX_ATTACHMENTS_PER_MESSAGE = 20
SHARE_MAX_PAYLOAD_BYTES = 1_048_576
```

- `clientRequestId` 必须是 UUID。
- `source` 只接受 `near-desktop`。
- `scope` 只接受 `turn | selection | session`。
- `messages` 至少一条；只接受 `user | assistant`。
- message 允许正文为空仅当 `attachments.length > 0`。
- 解析后重新构造 plain object；禁止保留 Zod passthrough 未知字段。
- `payloadBytes(snapshot)` 使用 `Buffer.byteLength(JSON.stringify(snapshot), "utf8")`。
- strict object 先拒绝未知键；title/senderLabel/attachment known strings 通过 Zod transform 进行 trim/规范化/截断。message content 超限返回错误，不截断正文。
- 导出 `sanitizePublicFilename()`，按 Parent Plan 同时处理 `/`、`\`、盘符、UNC、`@dir:` 与控制字符；不能只调用 `trim()`。

测试先写并验证失败：

```bash
pnpm -C AgenticX-Website exec vitest run \
  src/lib/shares/__tests__/contract.test.ts
```

断言点：

- golden fixture 通过。
- role=tool、schemaVersion=2、未知 source、空消息失败。
- `reasoning`, `sourcePath`, `dataUrl` 等未知字段在 strict schema 下失败，而非被静默存储。
- 1 MiB 与 200 条边界准确。
- title/senderLabel/attachment 字段的超长规范化与路径伪装 filename 测试通过。
- 普通 schema 错误 → 400 `invalid_share_payload`；201 条 → 400 `share_message_limit_exceeded`；超 1 MiB → 413 `share_payload_too_large`。

### 3. Drizzle schema 与 migration

在 `src/db/schema.ts` 顶部 import 精确增加：

- `integer`, `jsonb`, `index`, `uniqueIndex` 等真实使用项
- 不改变现有 `deviceAuthRequests`

新增：

- `conversationShareScopeEnum`
- `conversationShares`
- `ConversationShare` / `NewConversationShare` infer types

表字段与索引必须逐字遵循 Parent Plan。不要把 access token、refresh token、owner email 或本地 session id 放进表。

生成迁移：

```bash
MIGRATION_DATABASE_URL=<direct-owner-url> pnpm -C AgenticX-Website db:generate
```

先修改 `drizzle.config.ts`：优先使用 `MIGRATION_DATABASE_URL`，仅本地兼容时 fallback `DATABASE_URL`。迁移必须使用 Supabase direct 5432 owner URL，不能使用 transaction-mode pooler。

检查生成的下一条 migration：

- 创建 enum 与表。
- unique `public_slug`
- unique `(owner_user_id, client_request_id)`
- owner + created_at index
- expires_at index
- 手工在同一 migration 末尾补：

```sql
ALTER TABLE "conversation_shares" ENABLE ROW LEVEL SECURITY;
```

不要修改 `0000_device_auth_requests.sql`。

新环境部署顺序固定为：

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/provision-share-runtime-role.sql
MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:migrate
# 最后用 runtime DATABASE_URL 执行最小权限 smoke
```

role bootstrap 必须早于引用该 role 的 grant/RLS migration。

在 `.env.example` 区分：

```dotenv
# Website runtime（pooler + 独立 non-owner/NOBYPASSRLS login role）
DATABASE_URL=
# Drizzle migration（direct 5432 owner connection）
MIGRATION_DATABASE_URL=
# 固定 staging HTTPS origin；production 不使用
AGX_SHARE_STAGING_ORIGIN=
```

RLS 验收不能只检查 `relrowsecurity=true`，还必须：

- migration owner 必须在 schema migration 前执行 `psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/provision-share-runtime-role.sql`。脚本只创建固定 `NOLOGIN NOBYPASSRLS` group role，不处理密码。
- 实际 pooler login role 由平台 secret/数据库管理面创建，必须是 non-owner/NOBYPASSRLS，并被授予上述 group role；密码不进入 SQL、plan 或仓库。
- 随后的 migration 对 group role 只授予 schema usage、`device_auth_requests` 与 `conversation_shares` 所需 SELECT/INSERT/UPDATE/DELETE，并为 `conversation_shares` 创建仅该 group role/成员可用的 RLS policy；不授予 DDL 或其他表权限。
- 使用实际 runtime `DATABASE_URL` 角色执行 device flow 与 share create/list/revoke/purge 成功，但 CREATE/ALTER/DROP 和其他表访问失败。
- 使用 Supabase anon/auth 直连角色查询 `conversation_shares` 被拒绝。
- 查询 `current_user`、table owner/`rolbypassrls=false` 并保存脱敏验收结果。
- `MIGRATION_DATABASE_URL` 只进入受保护 migration job，本地 Website runtime/Vercel Web Function 环境不得配置它。

### 4. Auth、错误与 repository

`src/lib/shares/errors.ts`：

- `ShareServiceError` 持有稳定 `code`、HTTP status 与可选 `retryAfterSeconds`（合法整数且 clamp 到 1..86400）。
- 只允许 Parent Plan 的错误码。
- `toShareErrorResponse(error)` 不返回原始 SQL/Supabase 错误；有 `retryAfterSeconds` 时同时设置秒数形式 `Retry-After` header。
- 固定 status/code：schema 400、message limit 400、payload 413、active limit 429、24h limit 429 + `Retry-After`。

`src/lib/shares/auth.ts`：

```ts
export async function requireSupabaseUser(request: Request): Promise<User>
```

- 解析严格的 `Bearer ` header。
- 调 `createSupabaseAdmin().auth.getUser(token)`。
- 缺失 token → 401 `missing_bearer_token`
- token 无效 → 401 `invalid_session`
- 不记录 token。

可将 device confirm 改为调用该 helper，但只允许等价替换第 23–40 行，不改变 device flow 的错误码、DB 写入或响应；若会造成现有行为变化，则保持 confirm 不动。

`src/lib/shares/repository.ts` 定义窄接口 `ConversationShareRepository` 与生产实现：

```ts
createShareAtomically(input)
listActiveByOwner(ownerUserId, now)
findBySlug(slug)
revokeByOwnerAndSlug(ownerUserId, slug, now)
purgeExpired(now, batchSize)
```

所有 owner 管理查询必须带 `owner_user_id` 条件。匿名读只能按高熵 slug 查询。

`createShareAtomically()` 必须在同一 PostgreSQL transaction 中：

1. `SELECT pg_advisory_xact_lock(hashtextextended(ownerUserId, 0))` 串行化同一 owner 创建。
2. 重新检查 `(owner, clientRequestId)`；命中直接返回既有记录。
3. 统计 active 与过去 24 小时所有创建（包括 revoked）。
4. 分别执行 active<100、24h<50 门禁；active 已为 100 时拒绝第 101 条。24h 已达 50 时取窗口内最早 `created_at`，计算 `ceil(oldest + 24h - now)` 作为 Retry-After 秒数。
5. 插入新记录。
6. 若复合 idempotency unique conflict，回读既有记录并返回；若 slug unique conflict，返回 typed `slug_conflict` outcome。

repository 不负责 HTTP、Supabase auth 或生成 URL。

`src/lib/shares/body.ts` 导出 `readLimitedJsonBody(request, maxBytes)`：

- 先检查 `Content-Length`，但不能把它作为唯一防线。
- 逐 chunk 读取 `request.body`，累计超过 1.1 MiB 立即 cancel 并返回 413。
- 限制后才 JSON.parse。
- 空 body/非法 JSON → 400 `invalid_share_payload`。

### 5. Service 层

`src/lib/shares/service.ts` 的 wrappers 保持可注入：

```ts
type ShareServiceDeps = {
  repository: ConversationShareRepository;
  now: () => Date;
  generateSlug: () => string;
  publicBaseUrl: string;
};
```

导出：

- `createConversationShare(deps, ownerUserId, request)`
- `listConversationShares(deps, ownerUserId)`
- `getPublicConversationShare(deps, slug)`
- `revokeConversationShare(deps, ownerUserId, slug)`
- `purgeExpiredConversationShares(deps, batchSize)`

同时导出并冻结 bound interface：

```ts
export interface ConversationShareService {
  create(ownerUserId: string, request: CreateShareRequest): Promise<{
    created: boolean;
    share: ConversationShareSummary;
  }>;
  list(ownerUserId: string): Promise<ConversationShareSummary[]>;
  getPublic(slug: string): Promise<{
    share: ConversationShareSummary & { snapshot: ConversationShareSnapshotV1 };
  }>;
  revoke(ownerUserId: string, slug: string): Promise<{ revoked: true }>;
  purgeExpired(batchSize: number): Promise<{ deleted: number; hasMore: boolean }>;
}
```

`getProductionConversationShareService()` 只把 deps-based functions 绑定为该接口；SP2/SP5 不直接调用自由函数。

`src/lib/shares/runtime.ts` 提供唯一生产组装：

```ts
export function getProductionConversationShareService(
  request?: Request,
): ConversationShareService;
```

- route/page/purge 一律通过该 helper 获取 production service。
- unit tests 直接注入 fake deps。
- `VERCEL_ENV=production`：`NEXT_PUBLIC_SITE_URL` 必须等于官方 HTTPS origin。
- `VERCEL_ENV=preview` / staging：`NEXT_PUBLIC_SITE_URL` 必须严格等于显式 `AGX_SHARE_STAGING_ORIGIN`，且 staging 使用独立 Supabase/DB。
- local development：只允许 loopback Request origin fallback。
- 任何环境缺失/不匹配均 503，不信任 Host/forwarded host。

创建顺序：

1. Zod strict parse。
2. 检查 UTF-8 payload size。
3. 调用一次 `deps.now()` 固定 `createdAt` 与 `expiresAt = createdAt + SHARE_TTL_MS`；所有 slug retry 复用同一时间值。
4. service 最多循环三次：每次调用 `generateSlug()` 生成新的 24-byte base64url slug，再调用一次 atomic repository transaction。
5. transaction 完成幂等、active<100 与 24h<50 检查；`slug_conflict` 才进入下一次 service 循环。
6. 三次 slug 均冲突才返回服务错误；返回不含 snapshot/owner 的管理摘要。

公开读取顺序：

- slug 不符合 `/^[A-Za-z0-9_-]{32}$/` 直接 404。
- unknown/revoked → `share_not_found` 404。
- expired row 尚未 purge → `share_expired` 410；purge 后按 unknown 404。
- active → 返回 snapshot。

撤销：

- owner 条件更新。
- 已撤销且尚未到期/purge的同 owner 记录视为幂等成功。
- 非 owner/unknown 统一 404。

`publicBaseUrl` 由 `runtime.ts` 按上述 production/loopback 规则生成；禁止生产 Host/`X-Forwarded-Host` fallback。

### 6. API routes

`src/app/api/shares/route.ts`：

- `runtime = "nodejs"`
- POST：require user → parse body → service create → 201/200
- GET：require user → list active → 200
- handler 只做 HTTP 适配，不写业务 SQL。
- 使用 `readLimitedJsonBody()`，禁止直接 `request.json()` 读取无界 body。
- HTTP envelope 固定：POST `{ ok:true, share }`，list `{ ok:true, shares }`。
- 返回 `Cache-Control: private, no-store, max-age=0, must-revalidate`。

`src/app/api/shares/[slug]/route.ts`：

- GET 匿名，返回 active snapshot。
- DELETE 要 bearer 和 owner。
- `params` 按 Next.js 16 `Promise<{ slug: string }>` 形式处理。
- HTTP envelope 固定：GET `{ ok:true, share:{...summary,snapshot} }`，DELETE `{ ok:true, revoked:true }`。
- 所有响应 `private, no-store, max-age=0, must-revalidate`。

route tests 至少覆盖：

- create 无 bearer 401。
- create invalid body 400。
- 201 messages → 400 `share_message_limit_exceeded`；超 body → 413 `share_payload_too_large`。
- 24 小时第 51 条 → 429 `share_rate_limited` + `Retry-After`。
- active 已为 100 时下一条 → 429 `share_limit_reached`。
- create 新记录 201、幂等重放 200。
- 同 owner 同 requestId 并发重放只生成一条；active=99 的并发创建不会突破 100。
- list 只返回当前 owner active records。
- public GET 无 bearer 200。
- expired 410。
- revoked/unknown 404。
- owner B 删除 owner A slug 得到 404。

### 7. Refresh endpoint

`src/app/api/auth/device/refresh/route.ts`：

- `runtime = "nodejs"`
- body 只接受非空 `refresh_token`，设合理最大长度。
- 调 `createSupabaseAdmin().auth.refreshSession({ refresh_token })`。
- 成功返回：

```json
{
  "ok": true,
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": 1234567890
}
```

- Supabase 拒绝或 session 缺失 → 401 `invalid_refresh_token`
- 配置/网络故障 → 503 `share_service_unavailable`
- 成功与失败响应都设置 `Cache-Control: private, no-store, max-age=0, must-revalidate`。
- 日志只写错误码，不写请求 body/token。

测试 mock Supabase client，断言 token 不出现在 `console.error` 参数中。

## TDD 执行顺序

1. 安装 Vitest，新增 config/script 与 golden fixture。
2. 写 contract tests，运行确认 FAIL。
3. 实现 contract，运行确认 PASS。
4. 写 service tests（fake repository + fake clock + deterministic slug）与 PostgreSQL 并发 integration test，确认 FAIL。
5. 实现 repository interface 与 service，确认 PASS。
6. 增 schema，生成并审查 migration。
7. 写 route tests，确认 FAIL。
8. 实现 auth 与 API routes，确认 PASS。
9. 写 refresh test，确认 FAIL；实现 endpoint；确认 PASS。
10. 跑完整 Website 检查。

## 定向验收

```bash
pnpm -C AgenticX-Website test:shares
SHARE_TEST_DATABASE_URL=<loopback-test-db> \
SHARE_TEST_EXPECTED_DATABASE=<name_ending_test> \
SHARE_TEST_ALLOW_DB_WRITE=1 \
pnpm -C AgenticX-Website test:shares:integration
pnpm -C AgenticX-Website ts-check
pnpm -C AgenticX-Website lint
pnpm -C AgenticX-Website build
```

使用测试数据库额外验证 migration：

```text
运行 db:migrate
检查 conversation_shares 表与全部 unique/owner/created/expires 索引
检查 relrowsecurity = true、runtime non-owner/NOBYPASSRLS、最小 DML、DDL deny 与 anon/auth deny
确认 device_auth_requests 仍可正常 init/confirm/poll
```

## AC

- AC-SP1-1：golden fixture 被 Website strict schema 接受，含敏感/未知字段的 payload 被拒绝。
- AC-SP1-2：新建、并发幂等重放、active=100/24h 上限、七天 TTL 均有测试；并发不能突破门禁。
- AC-SP1-3：匿名 GET 不需 bearer；创建/list/delete 必须 bearer。
- AC-SP1-4：owner 隔离、撤销和过期状态符合 Parent Plan。
- AC-SP1-5：refresh 成功轮换 token，失败不泄露 token。
- AC-SP1-6：migration 新增 share 表且未改写旧 migration。
- AC-SP1-6a：direct migration URL 与 runtime pooler/role 契约经真实测试数据库验证。
- AC-SP1-7：Website 定向测试、typecheck、lint、build 全绿。
- AC-SP1-8：`desktop/**`、`enterprise/**`、`agenticx/studio/server.py` 无 diff。

## 提交边界

本 subplan 在 Website 独立仓提交。Website 的 plan-only bootstrap commit 已先包含镜像 Master、SP1、SP2、SP5；本实现提交只包含 Website 代码、migration、fixture、测试和必要的 SP1 修订，不夹带 SP2/SP5 代码。完成后把 Website commit SHA/API v1 记录回 AgenticX 主仓 Master 的执行证据。

