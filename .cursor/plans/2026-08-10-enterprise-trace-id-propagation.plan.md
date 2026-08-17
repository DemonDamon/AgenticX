# 子规划 A：Enterprise Web 链路 trace_id 贯通

Planned-with: Claude Opus 5 (thinking)
Suggested-Impl-Model: GPT-5.6（强推理档；跨 TS/Go/SQL 三栈、17 处审计构造点、双数据库方言迁移，一致性敏感）
Parent-Plan: `.cursor/plans/pending/2026-08-10-enterprise-trace-observability.plan.md`

## 一句话目标

让浏览器发起的每一次 Enterprise 聊天请求都携带一个 ULID `trace_id`，经 web-portal BFF 透传到 Go 网关，最终写进 `gateway_audit_events.trace_id` 与 `agent_token_traces.trace_id`，使两张表可以用同一个 ID 互相 JOIN。

## 根因与证据链（实施者据此判断改动是否对症，不依赖任何对话上下文）

1. **浏览器端已有一个 requestId，但它是死的。** `enterprise/packages/sdk-ts/src/chat/http.ts` L15-20 的 `makeRequestId()` 生成 UUID，仅用作 `this.pending` Map 的 key（L96-101），从不出现在任何 HTTP 头、日志或错误文案里。
2. **网关早就准备好接收 trace 头，但没人发。** `enterprise/apps/gateway/internal/server/trace_context.go` L9-21 定义了 `X-AgenticX-Trace-Id` / `X-AgenticX-Trace-Step` 并写入 `requestIdentity.TraceID/TraceStep`。全仓唯一发送方是 `enterprise/apps/edge-agent/internal/gateway/client.go`；web-portal 的 `gatewayHeaders`（`apps/web-portal/src/app/api/chat/completions/route.ts` L141-150）里没有这两个头。
3. **审计事件结构里没有 trace_id。** `apps/gateway/internal/audit/writer.go` 的 `Event` 结构（L23-76）有 `SessionID` 无 `TraceID`；`packages/db-schema/src/schema/gateway-audit-events.ts` 也没有该列。因此即便 `agent_token_traces` 有 trace 数据，也无法从审计事件跳过去。

## In scope

- `enterprise/packages/sdk-ts/`：新增 trace_id 生成工具 + 发送请求头
- `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts`：接收并透传
- `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`、`src/lib/web-search/tool-loop.ts`：为多步调用递增 `X-AgenticX-Trace-Step`
- `enterprise/apps/gateway/internal/audit/`：`Event.TraceID` 字段 + PG/MySQL 写入
- `enterprise/apps/gateway/internal/server/*.go`：17 处审计构造点补 `TraceID`
- `enterprise/packages/db-schema/`：schema + PG/MySQL 迁移各一份

## Out of scope（严禁改动）

- `desktop/`、`agenticx/`、`apps/edge-agent/` 任何文件
- 深度调研的检索/规划/写作业务逻辑，只允许在 fetch 调用处合并 header
- checksum 计算算法、`features/audit/src/services/checksum.ts`
- Admin UI（属于子规划 C）
- portal 日志（属于子规划 B）

---

## FR-1：新增 ULID 生成工具（sdk-ts）

**落点：** 新建 `enterprise/packages/sdk-ts/src/trace/trace-id.ts`，并在 `enterprise/packages/sdk-ts/src/index.ts` 导出。

**要求：** 实现 Crockford Base32 ULID（48bit 毫秒时间戳 + 80bit 随机），返回 26 字符大写字符串。禁止引入 `ulid` npm 包（保持零新依赖）。

```ts
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32, 无 I L O U

export function newTraceId(now: number = Date.now()): string {
  // 前 10 位：时间戳（48bit），后 16 位：随机（80bit）
  let ts = "";
  let t = now;
  for (let i = 9; i >= 0; i--) {
    ts = ENCODING[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += ENCODING[bytes[i] % 32];
  return ts + rand;
}

/** 宽松校验：26 位 Crockford Base32。用于服务端拒绝伪造/超长输入。 */
export function isTraceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
```

**AC-1：** 新建 `enterprise/packages/sdk-ts/src/trace/trace-id.test.ts`，断言：(a) 返回长度恒为 26；(b) 连续 1000 次调用无重复；(c) `newTraceId(1)` < `newTraceId(2)`（字典序单调）；(d) `isTraceId(newTraceId())` 为 true，`isTraceId("abc")`、`isTraceId("I".repeat(26))` 为 false。`pnpm -C enterprise/packages/sdk-ts test` 通过。

---

## FR-2：HttpChatClient 生成并发送 trace_id

**落点：** `enterprise/packages/sdk-ts/src/chat/http.ts`

**改法（精确）：**

1. 顶部新增 `import { newTraceId } from "../trace/trace-id";`（遵守 no-inline-imports 规则）。
2. `type PendingRequest`（L6-9）新增 `traceId: string;`。
3. `sendMessage`（L95-102）里生成 `const traceId = newTraceId();`，存入 pending。
4. `stream()` 的 fetch headers（L123-128）新增 `"x-agenticx-trace-id": pending.traceId,`。
5. `ChatChunk` 携带 traceId：在 `enterprise/packages/sdk-ts/src/types.ts` 的 `ChatChunk` 类型上新增可选字段 `traceId?: string`，并在 `stream()` 内**所有 `yield` 出错误的分支**（L110-115、L145-149、L157-163、L218-227、L319-328）补 `traceId: pending?.traceId`。成功分支不强制加。
6. `sendMessage` 返回值 `SendMessageResult`（`types.ts`）新增 `traceId: string`，`sendMessage` 返回 `{ requestId, traceId }`。

**不要做：** 不要改 `makeRequestId()`，不要把 requestId 换成 traceId——requestId 是客户端 Map key，语义不同，替换会牵连 `cancel()` 逻辑。

**AC-2：** 新建 `enterprise/packages/sdk-ts/src/chat/http.trace-header.test.ts`，用 stub `globalThis.fetch` 断言：调用 `sendMessage` + 消费一次 `stream()` 后，捕获到的 `RequestInit.headers` 含 `x-agenticx-trace-id` 且值满足 `isTraceId`；且错误分支 yield 出的 chunk 带同一个 `traceId`。

---

## FR-3：portal BFF 接收并透传 trace_id

**落点：** `enterprise/apps/web-portal/src/app/api/chat/completions/route.ts`

**改法：**

1. 在读取 `chatSessionId`（L59）附近新增：

```ts
const incomingTraceId = request.headers.get("x-agenticx-trace-id")?.trim() ?? "";
const traceId = isTraceId(incomingTraceId) ? incomingTraceId : newTraceId();
```

（从 `@agenticx/sdk-ts` 导入这两个函数；若该包未在 web-portal 依赖中，改为从 `@agenticx/sdk-ts` 的公开入口导入并在 `apps/web-portal/package.json` 确认 workspace 依赖已存在——本仓已存在则无需改 package.json。）

2. `gatewayHeaders`（L141-150）新增两行：

```ts
"x-agenticx-trace-id": traceId,
"x-agenticx-trace-step": "1",
```

3. 三个返回分支都要把 trace 透出到浏览器，便于前端在无 SSE body 时也能拿到 ID：
   - 深度调研分支（L152-193）：`runDeepResearchTurn` 返回的 Response 上追加响应头 —— 在 `runDeepResearchTurn` 内部构造 Response 的地方（`orchestrator.ts` L287-291 的 `headers`）接收并加入 `"x-agenticx-trace-id"`；`DeepResearchDeps` 增加 `traceId: string`。
   - 网关不可用 503 分支（L230-241）与 `!upstream.ok` 分支（L243-251）：给 `NextResponse` 加 `headers: { "x-agenticx-trace-id": traceId }`，并在 JSON body 的 `error` 对象里加 `trace_id: traceId`。
   - 正常流式分支（L253-260）：headers 里加 `"x-agenticx-trace-id": traceId`。

**AC-3：** 新建 `enterprise/apps/web-portal/src/app/api/chat/completions/route.trace.test.ts`（vitest，mock `getSessionAuthFromCookies` / `isChatSessionOwned` / `listAvailableModelsForUser` / `fetch`），断言：(a) 请求头带合法 trace id 时，转发给网关的 headers 里 `x-agenticx-trace-id` 与之相同；(b) 请求头缺失或非法（如 `"; DROP"`）时，服务端自行生成合法 ULID；(c) 网关 fetch 抛错时返回的 503 JSON 里 `error.trace_id` 与响应头一致。

---

## FR-4：多步调用递增 trace_step

**落点 1：** `enterprise/apps/web-portal/src/lib/deep-research/orchestrator.ts`

该文件对网关只有**两个真实 fetch 点**：L464（流式）与 L477（非流式）。改法：

- `DeepResearchDeps`（L233-）新增 `traceId: string;`
- 在模块内维护 per-run 步进计数（不要用模块级全局变量，会串台）：把计数器挂在传入 deps 的运行上下文对象上，或在 `runDeepResearchTurn` 入口创建 `let traceStep = 1;` 并把 `nextTraceStep = () => String(++traceStep)` 通过闭包传到这两个 fetch 处。
- 两处 `headers: deps.headers` 改为 `headers: { ...deps.headers, "x-agenticx-trace-step": nextTraceStep() }`。

**落点 2：** `enterprise/apps/web-portal/src/lib/web-search/tool-loop.ts` L365 的 `headers: deps.headers`，同样合并递增 step。

**约束：** step 从 1 开始（portal 直连那一跳算 step 1），每次真实上游调用 +1。step 只影响 `agent_token_traces.step_no` 的分组展示，不参与计费。

**AC-4：** 在 `enterprise/apps/web-portal/src/lib/deep-research/` 下新建或扩展测试，用 stub fetchImpl 记录每次调用的 header，断言同一 run 内 `x-agenticx-trace-id` 恒定、`x-agenticx-trace-step` 严格递增且无重复。

---

## FR-5：审计事件新增 trace_id（Go 侧）

**落点 1：** `enterprise/apps/gateway/internal/audit/writer.go`

在 `Event` 结构 `SessionID`（L31）之后新增一行：

```go
	TraceID            string          `json:"trace_id,omitempty"`
```

> **关键约束：必须带 `,omitempty`。** checksum 是对整个 `Event` 的 JSON 序列化结果做 blake2b（writer.go L120-126）。带 `omitempty` 时，历史上无 trace_id 的事件序列化结果不变，旧链校验不受影响；漏掉 `omitempty` 会导致全表链校验失败。

**落点 2：** 17 处 `audit.Event{...}` 构造点，在每处 `SessionID: identity.SessionID,` 之后紧跟一行 `TraceID: identity.TraceID,`。分布：

| 文件（相对 `enterprise/apps/gateway/`） | 处数 |
|---|---|
| `internal/server/server.go` | 8 |
| `internal/server/channel_handlers.go` | 2 |
| `internal/server/crossborder_integration.go` | 2 |
| `internal/server/budget_integration.go` | 1 |
| `internal/server/channel_relay.go` | 1 |
| `internal/server/mcp_proxy_handlers.go` | 1 |
| `internal/server/protocol_handlers.go` | 1 |
| `internal/server/rbac_integration.go` | 1 |

验证命令（改完两个数字必须相等）：

```bash
cd enterprise/apps/gateway
grep -rn 'SessionID: *identity.SessionID' --include='*.go' . | wc -l   # 期望 17
grep -rn 'TraceID: *identity.TraceID' --include='*.go' . | wc -l       # 期望 17
```

**落点 3：** `enterprise/apps/gateway/internal/audit/pg_writer.go` 的 INSERT 语句（L111 起）：列清单 `user_id, user_email, department_id, session_id,` 后加 `trace_id,`，同步调整 placeholder 序号与参数数组顺序（PG 用 `$n`，MySQL 用 `?`，注意 `p.database.Dialect` 分支）。

**AC-5：**
- `cd enterprise/apps/gateway && go build ./... && go test ./internal/audit/... ./internal/server/...` 全绿
- 新增 `internal/audit/writer_trace_test.go`：构造两个 Event（一个带 TraceID、一个不带），断言不带 TraceID 的事件 `ChecksumPayload` 中**不含** `"trace_id"` 子串（证明 omitempty 生效、旧链兼容）

---

## FR-6：数据库迁移（PG + MySQL 双方言）

**落点：** `enterprise/packages/db-schema/`

> **本仓双方言约定（必须遵守）：** PG schema 在 `src/schema/`，MySQL schema 在 `src/mysql-schema/`，两者**表名与列名必须一一对应**，由 `src/__tests__/schema-parity.test.ts` 强制校验（`pnpm -C enterprise/packages/db-schema db:check:parity`）。只改一侧会直接测试失败。迁移目录也是两套：`drizzle/`（PG）与 `drizzle-mysql/`。

1. `src/schema/gateway-audit-events.ts`（PG）：在 `sessionId`（L18）后新增

```ts
    traceId: varchar("trace_id", { length: 128 }),
```

并在索引块（L50-74）新增：

```ts
    tenantTraceIdx: index("gateway_audit_events_tenant_trace_idx").on(table.tenantId, table.traceId),
```

1b. `src/mysql-schema/gateway-audit-events.ts`（MySQL）：同样在 `sessionId`（L18）后新增等价列与索引，列名 `trace_id`、长度 128，索引名保持 `gateway_audit_events_tenant_trace_idx`。

2. 新建 PG 迁移 `drizzle/0048_gateway_audit_trace_id.sql`（合并分支当前最大为 `0047_calculator_enabled.sql`）：

```sql
ALTER TABLE "gateway_audit_events" ADD COLUMN IF NOT EXISTS "trace_id" varchar(128);
CREATE INDEX IF NOT EXISTS "gateway_audit_events_tenant_trace_idx"
  ON "gateway_audit_events" ("tenant_id", "trace_id");
```

3. 新建 MySQL 迁移 `drizzle-mysql/0022_gateway_audit_trace_id.sql`（合并分支当前最大为 `0021_calculator_enabled.sql`），语义等价（MySQL 不支持 `ADD COLUMN IF NOT EXISTS`，按该目录既有迁移的写法处理）。

4. 若该仓库的 drizzle meta snapshot 由 `drizzle-kit generate` 维护，则用命令生成而非手写 snapshot；只有 `.sql` 可手写。

**AC-6：**
- `pnpm -C enterprise/packages/db-schema db:check:parity` 通过（证明 PG / MySQL 两侧列已对齐）
- `pnpm -C enterprise db:migrate` 在干净库与已有数据库上都能重复执行不报错（幂等）
- 迁移后 `psql -c "\d gateway_audit_events"` 能看到 `trace_id` 列与新索引
- 已有历史行 `trace_id` 为 NULL，且 `/api/audit/verify-chain` 全表校验仍返回 valid

---

## 端到端验收（AC-E2E）

1. `bash enterprise/scripts/start-dev-with-infra.sh`
2. 浏览器登录 web-portal，发一条普通对话；DevTools → Network → `/api/chat/completions` 请求头存在 `x-agenticx-trace-id`，响应头存在同值
3. 复制该值 `TID`，执行：

```sql
SELECT id, user_id, session_id, trace_id, model, latency_ms
FROM gateway_audit_events WHERE trace_id = '<TID>';
```

返回至少 1 行。

4. 开启深度调研再发一条，`SELECT step_no, step_kind, total_tokens FROM agent_token_traces WHERE trace_id='<TID2>' ORDER BY step_no;` 返回多行且 step_no 连续无重复。
5. `pnpm -C enterprise typecheck && pnpm -C enterprise build` 绿；`cd enterprise/apps/gateway && go build ./... && go vet ./...` 绿。

## 回滚方案

- 代码：单 commit 回退即可，trace 头对网关是可选的（`enrichTraceFromRequest` 空值安全）。
- 数据库：`trace_id` 为可空列，不回滚也不影响旧代码运行；确需回滚执行 `ALTER TABLE gateway_audit_events DROP COLUMN trace_id;`。
