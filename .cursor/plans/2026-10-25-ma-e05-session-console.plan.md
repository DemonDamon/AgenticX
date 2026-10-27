# MA-E05 会话观测台：「运行观测」下的「托管会话」

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W2 · MA-E05）
Depends-on:
- MA-E01 `.cursor/plans/2026-10-25-ma-e01-schema.plan.md`（已落地：`enterprise/packages/iam-core/src/repos/ma-sessions-read.ts` 只读 repo、`ma_*` 表）
- MA-E03 `.cursor/plans/pending/2026-10-25-ma-e03-agent-runtime-service.plan.md`（会话面数据的唯一写入方；`environment_id` 可能为隐式值 `"local"`；`ma_work_items` 追加 `inbox_after_seq` / `consumed_through_seq`）
- MA-00 `.cursor/plans/2026-10-25-ma-00-protocol-freeze.plan.md`（事件类型、`stop_reason` 枚举、wire 字段）

> 风险等级：低（只读）。**上游未实现声明**：E03 未合入时库里没有托管会话数据，本子规划全部用 mock 单测验证；页面空态可正常展示。引用的 E01 函数已在仓库中存在（2026-10-25 核对 `ma-sessions-read.ts:238-324`），其余以实际实现为准。

---

## 0. 一句话目标

在 admin-console「运行观测」（`/ops/logs`）新增「托管会话」标签页：按智能体 / 发起人 / 状态 / 来源 / 时间筛选托管会话列表；点进详情页按 `seq` 回放全部事件（工具调用默认折叠、带耗时、模型请求用量、错误与停止原因）。数据只读 PG（经 iam-core `ma-sessions-read`），权限 `audit:read:all`。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §9 MA-E05 行 | `/ops/logs` 下新增「托管会话」tab：按 Agent / 用户 / 状态 / 来源筛选，详情按 seq 回放、工具调用与耗时、用量；只读 PG | 本文件全部 |
| §2.3 | 会话面四表唯一写入方是 agent-runtime；admin-console 观测台只读查询 PG | 只调用 iam-core 只读函数，不新增任何写函数 |
| §7 W2 门 | 「`/ops/sessions` 能按 Agent 打开该会话并按 seq 回放全部事件」 | 实际路径为 `/ops/logs?tab=managed` 与 `/ops/logs/managed/<sessionId>`（见 §10 Q1） |

### 1.2 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 |
|---|---|---|
| `enterprise/apps/admin-console/src/app/ops/logs/page.tsx` | 1–24 | 客户端组件；`TABS` 常量：`overview 总览 / traces 调用链 / sessions 会话 / audit 审计 / portal Portal / errors 错误聚类 / perf 性能分析`（中文直接写在常量里）；其余页面用 `dynamic(() => import(...), { ssr: false })` 懒加载 |
| 同上 | 26–37 | `normalizeTab`、`isObserveTab` |
| 同上 | 39–61 | `open(next)`：切 tab、记 `visited`、`history.replaceState` 写 `?tab=` |
| 同上 | 63–90 | 顶部 tab 条 + 「刷新」按钮（`reloadToken`） |
| 同上 | 96–116 | `visited.has("audit") ? <div className={tab === "audit" ? undefined : "hidden"}>…</div> : null` 懒挂载模式 |
| `enterprise/apps/admin-console/src/components/AppShell.tsx` | 102、348 | 导航项 `/ops/logs`（运行观测）；高亮规则 `pathname === href || pathname.startsWith(href + "/")` → 详情页放在 `/ops/logs/managed/...` 下导航自动高亮 |
| `enterprise/apps/admin-console/src/lib/admin-auth.ts` | 32–49 | `requireAdminScope(required)` 返回 `{ok:true, session:{email,userId,tenantId}, scopes}` 或 `{ok:false, response}`（401 `40101` / 403 `40300`） |
| `enterprise/apps/admin-console/src/app/api/audit/chain-verify/route.ts` | 6 | 审计全量读用 `requireAdminScope(["audit:read:all"])` 先例 |
| `enterprise/apps/admin-console/src/app/api/audit/query/__tests__/route.test.ts` | 1–60 | 路由测试样板：`vi.mock("server-only")`、`vi.mock("../../../../../lib/admin-auth")`、`vi.mock` 业务模块，`await import("../route")` 后直接调 handler |
| `enterprise/apps/admin-console/src/app/api/admin/agents/shared.ts` | 14–24 | 缺表提示先例：`/relation .* does not exist/i` → 提示先迁移 |
| `enterprise/apps/admin-console/src/lib/admin-client-auth.ts` | 35 | 客户端请求用 `adminFetch` |
| `enterprise/apps/admin-console/src/app/metering/agent-traces/page.tsx` | 43、297 | 页面文案经 `useTranslations("pages.ops.agentTraces")`；`messages/zh.json` 与 `messages/en.json` 都有 `pages.ops` |
| `enterprise/apps/admin-console/src/components/quota/LimitEditor.test.tsx` | 1–30 | 组件测试先例：`renderToStaticMarkup` + `NextIntlClientProvider`（vitest node 环境，无 jsdom） |
| `enterprise/apps/admin-console/vitest.config.ts` | 1–9 | `testTimeout: 20000` |
| `enterprise/packages/iam-core/src/repos/ma-sessions-read.ts` | 13–41 | `MaSessionSummary` / `MaSessionDetail`（`usage` 五键、`stopReason`、`lastSeq` 等） |
| 同上 | 43–53 | `MaSessionEventView { id, sessionId, seq, threadId, type, createdAt, processedAt, event }`（`event` 是还原后的 wire 事件） |
| 同上 | 55–70 | `MaWorkItemView` |
| 同上 | 72–79 | `ListMaSessionsFilter = { agentId?, userId?, status?, source?, beforeId?, limit? }`——**没有时间范围** |
| 同上 | 238–270 | `listMaSessions`：按 id 倒序、`limit` 默认 50 夹到 1..200、返回 `nextBeforeId` |
| 同上 | 272–283、286–313、315–324 | `getMaSession`、`listMaSessionEvents(afterSeq, limit≤500, types)` 返回 `nextAfterSeq`、`listMaWorkItems` |
| `enterprise/packages/iam-core/src/repos/mysql/ma-sessions-read.ts` | 6–23 | `mysqlListMaSessions(tenantId, filter)`，filter 类型内联 |
| `enterprise/packages/iam-core/src/repos/__tests__/ma-sessions-read.test.ts` | 6–90 | 现有纯函数用例 + `module exports no write function` |
| `enterprise/packages/iam-core/src/repos/agents.ts` | 460 | `listAgents(tenantId, opts?)` |
| `enterprise/packages/iam-core/src/repos/users.ts` | 96、266 | `loadAuthUserByEmail(tenantId, email)`、`getAdminUser(tenantId, id): AdminUserDto | null`（含 `email`、`displayName`） |
| `enterprise/packages/iam-core/src/scope-registry.ts` | 9 | `audit: ["read","read:all","read:dept","export","manage"]` |

---

## 2. 关键设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 权限：列表、详情、事件、智能体选项四个接口一律 `requireAdminScope(["audit:read:all"])` | 事件里含用户原文、模型输出、工具输入输出，敏感度与审计内容相同；不做部门级可见域（需要按发起人部门过滤，留给后续） |
| D2 | 租户取 `guard.session.tenantId`（同审计接口），不读 `DEFAULT_TENANT_ID` | 与审计一致；agent-runtime 写入的 tenant 来自 PAT 租户 |
| D3 | 时间筛选下推到 iam-core：`ListMaSessionsFilter` 追加可选 `createdFrom` / `createdTo`（ISO 字符串），PG 与 MySQL 两个实现同步加条件 | 客户端过滤会让分页（`beforeId`）失真 |
| D4 | 发起人筛选输入邮箱：服务端 `loadAuthUserByEmail` 解析成 userId；查无此人直接返回空列表，不查会话 | 运营人员记得邮箱，不记得 ULID |
| D5 | 回放模型是纯函数 `buildReplayTimeline(events)`：把 `span.model_request_start/end` 合成一条「模型请求」、把 `agent.tool_use`/`agent.mcp_tool_use`/`agent.custom_tool_use` 与其结果和用户确认合成一条「工具调用」，其余事件一条一项 | 可单测；UI 只负责渲染 |
| D6 | 详情页一次最多加载 2000 条事件（4 页 × 500），超过显示「事件较多，仅展示前 2000 条」并提供「继续加载」 | 防止超长会话卡死页面 |
| D7 | 工具调用卡片默认折叠（`<details>` 不带 `open`），展开看输入 / 结果；结果文本超过 4000 字符先截断，提供「展开全部」 | 与仓库「工具调用默认折叠」的既有偏好一致 |
| D8 | 文案经 next-intl，命名空间 `pages.ops.managedSessions`，zh / en 两份；tab 标签「托管会话」与相邻 tab 一样直接写在 `TABS` 常量里 | 与现有页面一致 |
| D9 | 环境 id 为 `"local"` 时显示「默认云端环境」 | E03 D9 的隐式环境 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

iam-core（只读 repo 追加时间条件）：
- 修改 `enterprise/packages/iam-core/src/repos/ma-sessions-read.ts`
- 修改 `enterprise/packages/iam-core/src/repos/mysql/ma-sessions-read.ts`
- 修改 `enterprise/packages/iam-core/src/repos/__tests__/ma-sessions-read.test.ts`（只追加用例）

admin-console（路径相对 `enterprise/apps/admin-console/`）：
- 修改 `src/app/ops/logs/page.tsx`
- 新建 `src/app/ops/logs/managed/[sessionId]/page.tsx`
- 新建 `src/components/managed-sessions/ManagedSessionsPanel.tsx`
- 新建 `src/components/managed-sessions/ManagedSessionDetail.tsx`
- 新建 `src/components/managed-sessions/SessionReplayTimeline.tsx`
- 新建 `src/components/managed-sessions/SessionReplayTimeline.test.tsx`
- 新建 `src/lib/ma-session-console.ts`
- 新建 `src/lib/__tests__/ma-session-console.test.ts`
- 新建 `src/app/api/admin/ma-sessions/shared.ts`
- 新建 `src/app/api/admin/ma-sessions/route.ts`
- 新建 `src/app/api/admin/ma-sessions/agents/route.ts`
- 新建 `src/app/api/admin/ma-sessions/[sessionId]/route.ts`
- 新建 `src/app/api/admin/ma-sessions/[sessionId]/events/route.ts`
- 新建 `src/app/api/admin/ma-sessions/__tests__/routes.test.ts`
- 修改 `messages/zh.json`、`messages/en.json`（`pages.ops` 下追加 `managedSessions` 对象）

### 3.2 Out of scope

- 任何写操作（终止 / 归档 / 重放 / 导出）、SSE 实时跟随、部门级可见域、事件全文检索。
- `ma-sessions-read.ts` 的既有导出签名与行为（只追加可选字段）。
- `AppShell.tsx` 导航（详情页在 `/ops/logs/` 下，已自动高亮）。
- 其他 `/ops/logs` tab 的任何代码；`metering/agent-traces` 的「会话」tab（那是 Agent Trace 会话，与托管会话无关，不合并）。
- web-portal、agent-runtime、gateway。

---

## 4. 数据与接口

### 4.1 iam-core 追加（`ma-sessions-read.ts`）

Before：

```ts
export type ListMaSessionsFilter = {
  agentId?: string; userId?: string; status?: string; source?: string; beforeId?: string; limit?: number;
};
```

After（只追加两个可选字段与一个纯函数）：

```ts
export type ListMaSessionsFilter = {
  agentId?: string; userId?: string; status?: string; source?: string; beforeId?: string; limit?: number;
  /** ISO-8601；created_at >= createdFrom。非法值忽略。 */
  createdFrom?: string;
  /** ISO-8601；created_at < createdTo。非法值忽略。 */
  createdTo?: string;
};

/** 纯函数：把 ISO 字符串解析为 Date；空串、非法时间返回 null。导出供测试。 */
export function resolveCreatedRange(filter: Pick<ListMaSessionsFilter, "createdFrom" | "createdTo"> | undefined): { from: Date | null; to: Date | null };
```

`listMaSessions` 内：`const range = resolveCreatedRange(filter);`，`query` 对象追加 `createdFrom: range.from, createdTo: range.to`；PG 分支在既有 `filters.push` 之后追加 `if (query.createdFrom) filters.push(gte(pgSessions.createdAt, query.createdFrom)); if (query.createdTo) filters.push(lt(pgSessions.createdAt, query.createdTo));`（`gte` 加入 `drizzle-orm` import）。MySQL：`mysqlListMaSessions` 的 filter 类型追加 `createdFrom?: Date | null; createdTo?: Date | null`，同样两行条件（`gte` 加入 import）。其他代码不动。

### 4.2 admin-console 接口（cookie 会话，信封 `{ code, message, data }`）

全部：`export const dynamic = "force-dynamic";`；第一行 `const guard = await requireAdminScope(["audit:read:all"]); if (!guard.ok) return guard.response;`；`tenantId = guard.session.tenantId`；异常交给 `maSessionErrorResponse(error)`。

**`shared.ts`：**

```ts
export const SESSION_STATUSES = ["idle", "running", "rescheduling", "terminated", "archived"] as const;
export const SESSION_SOURCES = ["portal", "desktop", "api", "schedule", "channel", "eval"] as const;
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export class MaConsoleRequestError extends Error { name = "MaConsoleRequestError"; }

/** 400 {code:"40000", message} | 503 {code:"50301", message:"托管会话数据表不存在，请先执行数据库迁移"}（message 命中 /ma_sessions|ma_session_events|relation .* does not exist|doesn't exist/i）| 500 {code:"50001", message:"internal error"}（console.error 记录原错误，响应不回显） */
export function maSessionErrorResponse(error: unknown): NextResponse;

export type UserBrief = { id: string; email: string; displayName: string };
/** 去重后并发 getAdminUser；单个失败记为缺失，不抛错。 */
export async function loadUserBriefs(tenantId: string, userIds: readonly string[]): Promise<Map<string, UserBrief>>;
/** listAgents(tenantId) → Map<id, {displayName, slug}>；失败返回空 Map。 */
export async function loadAgentNames(tenantId: string): Promise<Map<string, { displayName: string; slug: string }>>;
```

**`GET /api/admin/ma-sessions`**

Query：`agent_id`（ULID，可选）、`user_email`（可选）、`status`（∈ `SESSION_STATUSES`）、`source`（∈ `SESSION_SOURCES`）、`range`（`1d` / `7d` / `30d` / `all`，缺省 `7d`）、`before_id`（ULID）、`limit`（1–200，缺省 50）。由 `parseListQuery(url.searchParams, now)`（`src/lib/ma-session-console.ts`，§5.1）解析，非法 → 400，message 逐字：`智能体参数不合法` / `状态参数不合法` / `来源参数不合法` / `时间范围参数不合法` / `分页参数不合法`。

处理：
1. `user_email` 非空 → `loadAuthUserByEmail(tenantId, email.trim().toLowerCase())`；为 null → 直接返回 `{ items: [], nextBeforeId: null }`（**不**调用 `listMaSessions`）。
2. `listMaSessions(tenantId, { agentId, userId, status, source, beforeId, limit, createdFrom })`。
3. `agents = await loadAgentNames(tenantId)`；`users = await loadUserBriefs(tenantId, items.map(i => i.createdByUserId).filter(Boolean))`。

响应 `data`：

```json
{
  "items": [
    {
      "id": "01J…", "title": "协作房间 01R…", "agentId": "01J…", "agentName": "报告助手", "agentVersion": 2,
      "environmentId": "local", "source": "portal", "status": "idle",
      "stopReason": { "type": "end_turn", "event_ids": [] },
      "user": { "id": "01H…", "email": "alice@example.com", "displayName": "Alice" },
      "usage": { "input_tokens": 1200, "output_tokens": 300, "cache_read_input_tokens": 0, "tool_calls": 2, "runtime_ms": 8400 },
      "lastSeq": 17, "createdAt": "2026-10-26T08:00:00.000Z", "updatedAt": "2026-10-26T08:00:09.000Z"
    }
  ],
  "nextBeforeId": null
}
```

`agentName` 查不到时为 `null`；`user` 查不到时为 `{ id, email: "", displayName: "" }`；`createdByUserId` 为 null 时 `user: null`。

**`GET /api/admin/ma-sessions/agents`** → `data: { agents: [{ id, displayName, slug }] }`（按 `displayName` 升序，供筛选下拉）。

**`GET /api/admin/ma-sessions/[sessionId]`**：`sessionId` 非 ULID → 404 `{code:"40400", message:"会话不存在"}`；`getMaSession` 为 null → 同样 404；否则 `workItems = await listMaWorkItems(tenantId, id)`，`data: { session: <列表项同形状 + vaultIds/resources>, workItems }`。

**`GET /api/admin/ma-sessions/[sessionId]/events`**：Query `after_seq`（整数 ≥0，缺省 0）、`limit`（1–500，缺省 500）；非法 → 400 `分页参数不合法`；会话不存在 → 404（先 `getMaSession`）；`listMaSessionEvents(tenantId, id, { afterSeq, limit })` → `data: { items: MaSessionEventView[], nextAfterSeq }`。

---

## 5. 精确落点

### 5.1 `src/lib/ma-session-console.ts`（纯函数，无 IO，客户端与服务端共用）

不得 import `@agenticx/iam-core`、`next/server` 或任何 Node 模块（会被客户端组件引用）。

```ts
export const MA_RANGE_VALUES = ["1d", "7d", "30d", "all"] as const;
export type MaRange = (typeof MA_RANGE_VALUES)[number];
export const MA_SESSION_STATUSES = ["idle", "running", "rescheduling", "terminated", "archived"] as const;
export const MA_SESSION_SOURCES = ["portal", "desktop", "api", "schedule", "channel", "eval"] as const;
export const MA_STOP_REASONS = ["end_turn", "requires_action", "retries_exhausted", "refusal",
  "max_tool_rounds", "budget_exceeded", "policy_blocked"] as const;
export const IMPLICIT_LOCAL_ENVIRONMENT_ID = "local";
export const MAX_REPLAY_EVENTS = 2000;
export const TOOL_TEXT_PREVIEW_CHARS = 4000;

export type ParsedListQuery = {
  agentId?: string; userEmail?: string; status?: string; source?: string;
  beforeId?: string; limit: number; createdFrom?: string; range: MaRange;
};
/** 非法参数抛 Error(<§4.2 的中文 message>)；range → createdFrom = now - 1/7/30 天（ISO），all 不设。 */
export function parseListQuery(params: URLSearchParams, now: Date): ParsedListQuery;

/** 列表 / 详情头部的状态展示键：status=idle 且 stopReason.type=requires_action → "requiresAction"；否则 status 本身。 */
export function displayStatusKey(status: string, stopReason: { type?: unknown } | null): string;

export type DurationUnits = { ms: string; s: string; m: string };
/** <1000 → "320 毫秒"；<60000 → "1.5 秒"（一位小数，".0" 去掉）；否则 "2 分 5 秒"。负数 / NaN → "—"。 */
export function formatDuration(ms: number | null | undefined, units: DurationUnits): string;

export type ReplayUsage = { input: number; output: number; cacheRead: number };
export type ReplayItem =
  | { kind: "status"; seq: number; at: string; status: "running" | "idle" | "terminated"; stopReason: string | null }
  | { kind: "user_message"; seq: number; at: string; text: string; attachments: number }
  | { kind: "agent_message"; seq: number; at: string; text: string }
  | { kind: "thinking"; seq: number; at: string; text: string }
  | { kind: "tool"; seq: number; at: string; toolType: "builtin" | "mcp" | "custom"; name: string;
      server: string | null; policy: string | null; input: unknown;
      result: { seq: number; at: string; text: string; isError: boolean; durationMs: number | null } | null;
      resolution: { seq: number; at: string; result: "allow" | "deny"; message: string | null } | null }
  | { kind: "model_request"; seq: number; at: string; model: string; durationMs: number | null;
      usage: ReplayUsage | null; isError: boolean }
  | { kind: "usage"; seq: number; at: string; usage: Record<string, number> }
  | { kind: "error"; seq: number; at: string; errorType: string; message: string; retry: string }
  | { kind: "interrupt"; seq: number; at: string }
  | { kind: "other"; seq: number; at: string; type: string };

export function buildReplayTimeline(events: ReadonlyArray<Record<string, unknown>>): ReplayItem[];
```

`buildReplayTimeline` 规则（输入为 `MaSessionEventView.event` 数组；先按 `seq` 升序排序；`at = String(event.created_at ?? "")`）：

| 事件 `type` | 处理 |
|---|---|
| `session.status_running` / `session.status_idle` / `session.status_terminated` | `status` 项；`stopReason = event.stop_reason?.type ?? null`（仅 idle） |
| `user.message` | `text` = `content` 中 text 块 `text` 用 `\n` 连接；document 块（source.type=text）追加 `\n[文档] <title>`；`attachments` = image 块数 + source.type=file 的 document 块数 |
| `agent.message` | `agent_message`，同样拼 text 块 |
| `agent.thinking` | `thinking` |
| `agent.tool_use` / `agent.mcp_tool_use` / `agent.custom_tool_use` | 新建 `tool` 项（`toolType` 分别 builtin / mcp / custom；`server` 仅 mcp 取 `mcp_server`；`policy` = `evaluated_policy ?? null`；`input` 原样），以事件 `id` 建索引 |
| `agent.tool_result`（`tool_use_id`）/ `agent.mcp_tool_result`（`mcp_tool_use_id`） | 找到对应 `tool` 项填 `result`：`text` = text 块拼接，`isError = is_error === true`，`durationMs = Date.parse(result.at) - Date.parse(tool.at)`（任一无效或结果为负 → `null`）；找不到对应项 → `other` 项 |
| `user.custom_tool_result`（`custom_tool_use_id`） | 同上填进对应 custom `tool` 项的 `result`（`isError = is_error === true`） |
| `user.tool_confirmation`（`tool_use_id`） | 填对应 `tool` 项的 `resolution = { seq, at, result, message: deny_message ?? null }`；找不到 → `other` |
| `span.model_request_start` | 新建 `model_request` 项（`model`，`durationMs: null`，`usage: null`，`isError: false`），压入「未结束 span」栈 |
| `span.model_request_end` | 弹出最近一个同 `model` 的未结束 span 填 `durationMs`（同上算法）、`usage = {input: model_usage.input_tokens ?? 0, output: …output_tokens, cacheRead: …cache_read_input_tokens}`、`isError`；没有可配对的 start → 新建一个 `durationMs: null` 的 `model_request` 项 |
| `session.usage` | `usage` 项（`usage` 原样，数字键） |
| `session.error` | `error` 项：`errorType = error.type`、`message = error.message`、`retry = error.retry_status?.type ?? ""` |
| `user.interrupt` | `interrupt` |
| 其他 | `other` 项（含 `type`） |

被合并的结果 / 确认 / span end 事件本身不再单独成项。输出按各项 `seq` 升序。

### 5.2 `src/app/ops/logs/page.tsx`（3 处）

1. `const PerfPage = dynamic(...)` 之后追加：`const ManagedSessionsPanel = dynamic(() => import("../../../components/managed-sessions/ManagedSessionsPanel"), { ssr: false });`
2. `TABS` 中 `{ id: "sessions", label: "会话" },` 之后插入 `{ id: "managed", label: "托管会话" },`。
3. 在 `{visited.has("audit") ? (` 块**之前**插入：

```tsx
      {visited.has("managed") ? (
        <div className={tab === "managed" ? "px-6 pt-4 pb-6" : "hidden"}>
          <ManagedSessionsPanel reloadToken={reloadToken} />
        </div>
      ) : null}
```

`normalizeTab` / `isObserveTab` / `open` 不改（`managed` 不是 observe tab，`open` 的既有逻辑已能处理）。

### 5.3 `src/components/managed-sessions/ManagedSessionsPanel.tsx`（`"use client"`，默认导出）

Props：`{ reloadToken?: number }`。

- 状态：筛选草稿 `{ agentId, userEmail, status, source, range: "7d" }`、已应用筛选、`items`、`nextBeforeId`、`loading`、`error`、`agents`（选项）。
- 首次挂载：`adminFetch("/api/admin/ma-sessions/agents")` 填下拉；`adminFetch("/api/admin/ma-sessions?range=7d")` 填列表。`reloadToken` 变化时按当前已应用筛选重新拉第一页。
- 筛选条（与现有页面同一套 `@agenticx/ui` 原语：`Select`、`Input`、`Button`）：智能体（含「全部智能体」）、发起人邮箱、状态（全部 + 5 个状态）、来源（全部 + 6 个来源）、时间（最近 1 天 / 7 天 / 30 天 / 全部），按钮「查询」「重置」。
- 表格列：会话（标题，空则「未命名会话」；下方灰色显示 id 前 10 位）、智能体（名称 · v版本；名称缺失显示 agentId 前 10 位）、发起人（displayName，下方 email；缺失「未知用户」）、来源、状态（`displayStatusKey` → 文案；idle 且有 stopReason 时旁边小号显示停止原因文案）、Token（`输入 / 输出`，千分位）、工具调用、运行时长（`formatDuration(usage.runtime_ms)`）、创建时间（本地时间 `YYYY-MM-DD HH:mm:ss`）。
- 行点击：`router.push(\`/ops/logs/managed/${item.id}\`)`（`useRouter` 来自 `next/navigation`）。
- 底部：`nextBeforeId` 非空显示「加载更多」，请求追加 `before_id`。
- 空态「暂无托管会话」；接口 403 显示「无权查看托管会话」；其他错误显示接口返回的 `message`（503 时即迁移提示）。
- 文案全部 `useTranslations("pages.ops.managedSessions")`。

### 5.4 `src/app/ops/logs/managed/[sessionId]/page.tsx` 与 `ManagedSessionDetail.tsx`

`page.tsx`（`"use client"`）：`const { sessionId } = useParams<{ sessionId: string }>();` 渲染 `<ManagedSessionDetail sessionId={sessionId} />`，外层 `<div className="min-h-screen bg-background px-6 pt-5 pb-6">`。

`ManagedSessionDetail`：
- 拉 `GET /api/admin/ma-sessions/<id>` 与事件：循环 `GET .../events?after_seq=<cursor>&limit=500`，直到 `nextAfterSeq` 为 null 或累计 ≥ `MAX_REPLAY_EVENTS`；超过时显示 `truncated` 提示与「继续加载」按钮（再拉 2000 条）。
- 顶部：「返回列表」链接 `/ops/logs?tab=managed`；标题（会话标题或「未命名会话」）+ 状态徽标。
- 概览卡（`StatCard` 或 `Card` 网格）：智能体名称与版本、发起人、来源、执行环境（`"local"` → 「默认云端环境」，否则 id）、创建 / 更新时间、输入 / 输出 / 缓存命中 Token、工具调用次数、运行时长。
- 若 `workItems.length > 0`：「桌面执行记录」小表（状态、设备、领取时间、最后心跳、完成时间、错误）。
- 「事件回放」：`<SessionReplayTimeline items={buildReplayTimeline(events.map(e => e.event))} />`。
- 404 → 「会话不存在或无权查看」+ 返回链接。

### 5.5 `src/components/managed-sessions/SessionReplayTimeline.tsx`

`export function SessionReplayTimeline({ items }: { items: ReplayItem[] })`（具名导出，便于测试）。纵向时间线，每项左侧显示 `#seq` 与时间（`HH:mm:ss.SSS`），右侧按 `kind`：

| kind | 渲染 |
|---|---|
| `status` | 一行灰色说明：开始运行 / 进入空闲（+ 停止原因文案）/ 已终止 |
| `user_message` | 「用户消息」卡，`whitespace-pre-wrap` 正文；`attachments > 0` 显示「附件 N 个」 |
| `agent_message` | 「智能体回复」卡 |
| `thinking` | 默认折叠的 `<details>`，summary「思考」 |
| `tool` | `<details>`（**不带 `open`**）：summary = 类型标签（工具调用 / MCP 工具 · server / 自定义工具（调用方执行））+ 工具名 + 结果徽标（成功 / 失败 / 未返回结果）+ 耗时（`formatDuration`）+ 若有 resolution 显示「已批准」/「已拒绝」；展开区：输入（`JSON.stringify(input, null, 2)`，`<pre>`）、结果文本（超过 `TOOL_TEXT_PREVIEW_CHARS` 先截断并给「展开全部」按钮，组件内 state 控制）、拒绝说明 |
| `model_request` | 一行：「模型请求」· 模型名 · 耗时 · `输入 x / 输出 y`；`isError` 标红 |
| `usage` | 一行：「累计用量」· 输入 / 输出 Token · 工具调用 · 运行时长 |
| `error` | 红色提示框：错误类型 + message + 重试状态 |
| `interrupt` | 一行「用户中断」 |
| `other` | 一行灰色 `type` 原文 |

颜色只用主题语义 token（`text-muted-foreground`、`bg-muted`、`text-destructive` 等），不硬编码色值。

`switch (item.kind)` 的 `default` 分支写 `const _exhaustive: never = item; return null;`（仓库规则）。

### 5.6 i18n：`messages/zh.json` / `messages/en.json`

在 `pages.ops` 对象内追加 `managedSessions`（zh 逐字如下；en 为对应英文，键完全相同）：

```json
"managedSessions": {
  "filters": { "agent": "智能体", "allAgents": "全部智能体", "userEmail": "发起人邮箱", "status": "状态", "allStatus": "全部状态", "source": "来源", "allSources": "全部来源", "range": "时间", "range1d": "最近 1 天", "range7d": "最近 7 天", "range30d": "最近 30 天", "rangeAll": "全部", "apply": "查询", "reset": "重置" },
  "columns": { "session": "会话", "agent": "智能体", "user": "发起人", "source": "来源", "status": "状态", "tokens": "Token（输入 / 输出）", "toolCalls": "工具调用", "runtime": "运行时长", "createdAt": "创建时间" },
  "status": { "idle": "空闲", "running": "运行中", "rescheduling": "重试中", "terminated": "已终止", "archived": "已归档", "requiresAction": "等待确认" },
  "stopReason": { "end_turn": "正常结束", "requires_action": "等待确认", "retries_exhausted": "重试耗尽", "refusal": "模型拒答", "max_tool_rounds": "达到工具轮次上限", "budget_exceeded": "超出用量预算", "policy_blocked": "合规拦截" },
  "source": { "portal": "门户", "desktop": "桌面", "api": "API", "schedule": "定时任务", "channel": "渠道", "eval": "评测" },
  "units": { "ms": "毫秒", "s": "秒", "m": "分" },
  "empty": "暂无托管会话", "forbidden": "无权查看托管会话", "loadMore": "加载更多", "loading": "加载中…", "untitled": "未命名会话", "unknownUser": "未知用户", "defaultEnvironment": "默认云端环境",
  "detail": { "back": "返回列表", "summary": "概览", "agentVersion": "版本", "environment": "执行环境", "createdAt": "创建时间", "updatedAt": "更新时间", "inputTokens": "输入 Token", "outputTokens": "输出 Token", "cacheTokens": "缓存命中 Token", "toolCalls": "工具调用次数", "runtime": "运行时长", "workItems": "桌面执行记录", "timeline": "事件回放", "truncated": "事件较多，仅展示前 2000 条", "loadMoreEvents": "继续加载", "notFound": "会话不存在或无权查看" },
  "timeline": { "userMessage": "用户消息", "agentMessage": "智能体回复", "thinking": "思考", "tool": "工具调用", "mcpTool": "MCP 工具", "customTool": "自定义工具（调用方执行）", "input": "输入", "result": "结果", "succeeded": "成功", "failed": "失败", "pending": "未返回结果", "allowed": "已批准", "denied": "已拒绝", "modelRequest": "模型请求", "usage": "累计用量", "error": "错误", "interrupt": "用户中断", "statusRunning": "开始运行", "statusIdle": "进入空闲", "statusTerminated": "已终止", "expand": "展开全部", "attachments": "附件 {count} 个" }
}
```

文案不得出现内部表名、文件路径、环境变量名（503 迁移提示由服务端返回，与 `/admin/agents` 现有提示同级，属管理员可见）。

---

## 6. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 时间范围下推 | `enterprise/packages/iam-core/src/repos/__tests__/ma-sessions-read.test.ts` 追加：`resolveCreatedRange parses ISO bounds`（`{createdFrom:"2026-10-01T00:00:00.000Z"}` → `from.toISOString()` 相等、`to === null`）；`resolveCreatedRange ignores invalid values`（`"yesterday"`、`""` → null）。既有 `module exports no write function` 仍通过 |
| FR-2 | 查询参数解析 | `src/lib/__tests__/ma-session-console.test.ts::parseListQuery`：空参数 + now=`2026-10-25T12:00:00Z` → `{range:"7d", limit:50, createdFrom:"2026-10-18T12:00:00.000Z"}`；`range=all` → 无 `createdFrom`；`range=2d` → 抛 `时间范围参数不合法`；`agent_id=abc` → `智能体参数不合法`；`status=paused` → `状态参数不合法`；`source=im` → `来源参数不合法`；`limit=0` / `limit=500` / `before_id=x` → `分页参数不合法`；`user_email=" Alice@Example.com "` → `userEmail === "alice@example.com"` |
| FR-3 | 回放合并：工具 | `ma-session-console.test.ts::buildReplayTimeline merges tool use and result`：输入 `agent.tool_use`（seq4，`created_at …00.000Z`，id T）+ `agent.tool_result`（seq5，`tool_use_id:T`，`…01.500Z`，`is_error:false`，text `ok`）→ 恰 1 个 `tool` 项，`seq 4`、`result.durationMs === 1500`、`result.text === "ok"`、`result.isError === false`；乱序输入（seq5 在前）结果相同 |
| FR-4 | 回放合并：确认与自定义工具 | `…::attaches confirmations and custom results`：`agent.tool_use`（T1，`evaluated_policy:"always_ask"`）+ `session.status_idle{requires_action,[T1]}` + `user.tool_confirmation{tool_use_id:T1, result:"deny", deny_message:"no"}` + `agent.tool_result{tool_use_id:T1, is_error:true}` → tool 项 `resolution.result === "deny"`、`message === "no"`、`result.isError === true`，且 status 项 `stopReason === "requires_action"`；`agent.custom_tool_use`（C1）+ `user.custom_tool_result{custom_tool_use_id:C1, content:[text "shipped"]}` → `toolType === "custom"`、`result.text === "shipped"` |
| FR-5 | 回放合并：模型请求 | `…::pairs model request spans`：start(seq3, `…00.000Z`, model m) + end(seq6, `…02.000Z`, `model_usage:{input_tokens:10, output_tokens:5, cache_read_input_tokens:2}`) → 1 个 `model_request` 项，`seq 3`、`durationMs 2000`、`usage` `{input:10, output:5, cacheRead:2}`；只有 end → `durationMs null` 的项；未知类型 `session.thread_created` → `other` 项 |
| FR-6 | 其他工具函数 | `…::formatDuration`（`320` → `"320 毫秒"`、`1500` → `"1.5 秒"`、`2000` → `"2 秒"`、`125000` → `"2 分 5 秒"`、`-1` / `NaN` / `null` → `"—"`）；`…::displayStatusKey`（`("idle",{type:"requires_action"})` → `"requiresAction"`；`("idle",{type:"end_turn"})` → `"idle"`；`("running",null)` → `"running"`） |
| FR-7 | 列表接口权限与租户 | `src/app/api/admin/ma-sessions/__tests__/routes.test.ts`（mock `server-only`、`../../../../../lib/admin-auth`、`@agenticx/iam-core`）：`list requires audit:read:all`（`requireAdminScope` 被以 `["audit:read:all"]` 调用；返回 `{ok:false, response: 403}` 时原样返回且 `listMaSessions` 未调用）；`list uses the admin session tenant and range`（`listMaSessions` 第一参 `"t1"`，第二参 `objectContaining({ limit: 50, createdFrom: expect.any(String) })`） |
| FR-8 | 发起人邮箱筛选 | `routes.test.ts::resolves user_email to a user id`（`loadAuthUserByEmail` 返回 `{id:"U1",…}` → `listMaSessions` 收到 `userId:"U1"`）；`returns empty list for unknown email`（返回 null → 响应 `items: []`、`nextBeforeId: null`，`listMaSessions` 未调用） |
| FR-9 | 列表富化 | `routes.test.ts::enriches agent and user names`：`listAgents` 返回 `[{id:"A1", displayName:"报告助手", slug:"r"}]`、`getAdminUser` 对 `U1` 返回 `{email:"a@x.com", displayName:"Alice"}`、对 `U2` 抛错 → 第一项 `agentName === "报告助手"`、`user.displayName === "Alice"`；第二项 `user` 为 `{id:"U2", email:"", displayName:""}`；`getAdminUser` 对同一 userId 只调用一次 |
| FR-10 | 参数错误 | `routes.test.ts::rejects invalid filters with 400`：`status=paused` → 400、`code === "40000"`、`message === "状态参数不合法"` |
| FR-11 | 详情与事件接口 | `routes.test.ts::detail returns 404 for unknown or malformed ids`（`getMaSession` null → 404 `会话不存在`；`sessionId:"x"` → 404 且 `getMaSession` 未调用）；`detail returns session and work items`；`events forwards after_seq and limit`（`listMaSessionEvents` 收到 `{afterSeq: 17, limit: 500}`）；`events rejects negative after_seq`（400） |
| FR-12 | 缺表与内部错误 | `routes.test.ts::maps missing tables to 503`（`listMaSessions` 抛 `new Error('relation "ma_sessions" does not exist')` → 503、`code === "50301"`）；`hides internal error details`（抛 `new Error("boom secret")` → 500、`message === "internal error"`，响应文本不含 `secret`） |
| FR-13 | 时间线渲染 | `src/components/managed-sessions/SessionReplayTimeline.test.tsx`：`renderToStaticMarkup(<NextIntlClientProvider locale="zh" messages={{pages:{ops:{managedSessions: <§5.6 的 zh 对象>}}}}><SessionReplayTimeline items={buildReplayTimeline(<FR-3 + FR-5 输入 + status_idle end_turn>)} /></NextIntlClientProvider>)` → HTML 含 `bash_exec`、`1.5 秒`、`正常结束`、`模型请求`；所有 `<details` 标签都不含 ` open`（正则 `/<details(?![^>]*\sopen)/` 计数等于 `<details` 总数）；结果文本 5000 字符时 HTML 中可见文本长度不超过 4000 + 省略标记且包含 `展开全部` |
| FR-14 | tab 接入 | 人工（§7）：`/ops/logs?tab=managed` 直接打开即选中「托管会话」；从其他 tab 切过去 URL 变为 `?tab=managed`；其他 tab 行为不变 |
| NFR-1 | 只读 | `rg -n "insert|update|delete" enterprise/apps/admin-console/src/app/api/admin/ma-sessions` 无数据库写调用；iam-core 既有「无写函数」测试通过 |
| NFR-2 | 类型与构建 | `pnpm --filter @agenticx/app-admin-console typecheck`、`pnpm --filter @agenticx/iam-core typecheck` 无错；`pnpm --filter @agenticx/app-admin-console build` 成功（确认 `ma-session-console.ts` 未把 Node 模块带进客户端包） |
| NFR-3 | 主题与文案 | 人工：dark / light 两种主题下列表与时间线可读；页面不出现英文硬编码文案（en 语言包除外）、表名、路径 |

---

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX/enterprise
pnpm --filter @agenticx/iam-core test -- src/repos/__tests__/ma-sessions-read.test.ts
pnpm --filter @agenticx/iam-core typecheck
pnpm --filter @agenticx/app-admin-console test -- src/lib/__tests__/ma-session-console.test.ts src/app/api/admin/ma-sessions src/components/managed-sessions
pnpm --filter @agenticx/app-admin-console typecheck
pnpm --filter @agenticx/app-admin-console build
git status --porcelain -- apps/admin-console packages/iam-core
```

人工验收（E03 / E04 已合入时可看到真实数据；未合入时验证空态）：

```bash
bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream
# 1) 以拥有 audit:read:all 的管理员登录 http://localhost:3001，进入「运行观测」→「托管会话」
# 2) 在门户协作房间 @ 一个云端智能体（MA_RUNTIME_ENABLED=1），回到列表点「查询」，看到新会话（来源=门户，发起人=当前用户）
# 3) 点进详情：概览用量非零；事件回放按 #seq 递增；工具调用默认折叠、展开可见输入与结果、有耗时；末尾「进入空闲 · 正常结束」
# 4) 用无 audit:read:all 的管理员登录：列表显示「无权查看托管会话」
```

---

## 8. 回滚

- 代码：删除 §3.1 新建文件；`git checkout` `page.tsx`、`messages/*.json`、iam-core 两个 repo 文件与测试文件。
- 无数据变更、无开关：tab 只读，删掉即消失；iam-core 新增字段均为可选，旧调用方不受影响。

## 9. 不变量

1. `/ops/logs` 现有 7 个 tab 的顺序、id、行为、URL 参数不变（新 tab 插在「会话」之后）。
2. iam-core `ma-sessions-read` 既有导出签名与返回形状不变；仍不导出任何写函数。
3. 观测台不写任何表、不调用 agent-runtime、不调用网关。
4. 工具调用卡片默认折叠；页面不展示 PAT、内部 token 等凭证（事件本身不含凭证，由 E03 / MA-A06 保证）。

## 10. 待确认问题

- **Q1**：master §7 W2 门写的是 `/ops/sessions`。本子规划按 §9 表格落在 `/ops/logs?tab=managed` 与 `/ops/logs/managed/<id>`（与现有「运行观测」信息架构一致）。是否接受并在 master §12 登记路径？
- **Q2**：权限定为 `audit:read:all`。若希望与相邻「调用链 / 会话」tab 一致用 `metering:read`，或支持 `audit:read:dept` 的部门可见域，请确认（后者需要按发起人部门过滤，另起子规划）。
