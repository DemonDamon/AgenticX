# MA Webhook 事件目录扩充 · 自动停用 · 新建弹窗重做 · 智能体驱动 e2e

Planned-with: （提交时由用户确认）
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-25-managed-agents-master.plan.md`（W5 · MA-E08 之后的增量）

> 本文写给不看对话上下文的实施者。改动点都给了文件路径、函数名与锚点。与本文冲突时以源码为准，但不得为迁就本文去改动与本需求无关的既有逻辑（`no-scope-creep`）。

## 0. 背景与证据链

现有 Webhook（MA-E08）只支持 3 种事件，且只在会话回合结束时入队：

| 证据 | 位置 |
|---|---|
| 事件白名单只有 `session.idle` / `session.failed` / `credential.expiring` | `enterprise/packages/iam-core/src/repos/ma-webhooks.ts` L28 `MA_WEBHOOK_EVENT_TYPES`；校验 `readEventTypes` L288–297 |
| UI 平铺 3 个复选框 | `enterprise/apps/admin-console/src/app/admin/_sections/agent-webhooks.tsx` L33 `EVENT_TYPES`、L321–332 |
| 运行时只在 `session.status_idle` / `session.status_terminated` 后入队 | `enterprise/apps/agent-runtime/ma_agent_runtime/session_hooks.py` L26 `TERMINAL_EVENT_TYPES`；`webhooks.py` L103 `classify_session_event`、L311 `WebhookOutbox.on_terminal` |
| 管理台资源写库（智能体、环境、凭据库、凭据、记忆库、定时任务）都不发通知 | 见 §3.4 写点表 |
| 多智能体线程事件已经存在但不进 Webhook | `agenticx/managed/host/threads.py`：`session.thread_created` L1085–1094 / L728–736、`session.thread_status_idle` L467–476、`session.thread_status_terminated` L1098 |
| 定时运行的开始 / 成功 / 失败只写 `ma_schedule_runs`，不发通知 | `enterprise/apps/agent-runtime/ma_agent_runtime/scheduler.py` `_fire` L376–431、`on_terminal` L160–190、`_timeouts` L437–451 |
| 端点没有描述字段，连续失败不会停用端点 | `ma_webhooks` 表：`enterprise/packages/db-schema/src/schema/ma-webhooks.ts` L10–32 |

开发环境事实（e2e 与验收依赖）：
- 管理台 / 前台在 MySQL（`agenticx-mysql-dev :3306`）；`agent-runtime` 只接受 PostgreSQL，本地用 `postgres://ma:ma@127.0.0.1:55432/ma`（容器 `ma-pg-test`，不要停）。`ma_webhook_deliveries` 由运行时写在 PG，没有外键，所以「管理台发事件 → 运行时入队投递」跨库也能工作。
- 内部令牌：`enterprise/.local-secrets/ma_internal.token`（管理台读 `MA_INTERNAL_TOKEN_FILE`，运行时读同名变量）。管理台调运行时用 `enterprise/apps/admin-console/src/lib/ma/runtime-internal-client.ts` `runtimeInternal`（默认 `http://127.0.0.1:8092`）。

## 1. 决策

1. **事件目录单一来源在 TS**：`enterprise/packages/core-api/src/managed-agents.ts` 新增 `MA_WEBHOOK_EVENT_GROUPS`（分组 + 类型）。iam-core 的白名单与管理台 UI 都从这里导入。Python 运行时自己维护同名常量，并加一条测试读取 TS 源文件比对字符串集合（§4.6）。
2. **保留旧的 3 种事件**（已有订阅不受影响），新增 26 种，共 29 种，见 §2。不做与我们能力无关的类型（不做 `deployment.*`，我们叫 `schedule.*`；不做 `session.status_rescheduled`、`session.deleted`、`session.updated`，因为没有对应产生点）。
3. **资源事件由管理台产生、运行时投递**：管理台在写库成功后 fire-and-forget 调运行时内部接口 `POST /internal/ma/webhook-events`；运行时按订阅写入 `ma_webhook_deliveries`，沿用现有投递器、签名与重试。运行时不可达只记日志，不影响管理台写操作（通知允许丢失，与业界做法一致）。
4. **自动停用**：连续投递失败达到阈值，或单次收到 `410 Gone`，运行时调管理台内部接口停用端点并写原因。重新启用会清空原因并重置失败计数起点。
5. **名称保持必填**（有租户内唯一索引），新增可选描述，最长 2048。
6. **新建弹窗**：分组勾选 + 分组计数 + 全选 + 总计数，每项显示中文名与等宽英文类型名；智能体过滤、来源过滤、附带回复正文三项收进「高级设置」折叠区。不加长段说明文字。
7. **e2e** 采用开源框架 `e2e`（npm 包名 `e2e`，Apache-2.0，Node ≥24.8）的 Web 引擎：`agent.act` 用自然语言驱动界面，结果用定位器 + `expect` 做确定性断言；配一个本机接收器校验签名。

## 2. 事件目录（实施者必须逐字使用这些字符串）

`event_type` 列是 `varchar(32)`，下表最长 26 字符，无需改列宽。

| 分组 key | 分组中文 | 类型 | 中文名 | 产生方 | 触发点 |
|---|---|---|---|---|---|
| `session` | 会话 | `session.status_run_started` | 智能体开始执行 | 运行时 | 追加 `session.status_running` 事件后 |
| `session` | 会话 | `session.status_idled` | 智能体停下（含等待审批） | 运行时 | 追加 `session.status_idle` 事件后（任意 stop_reason） |
| `session` | 会话 | `session.idle` | 回合正常结束 | 运行时 | 既有，不改 |
| `session` | 会话 | `session.failed` | 回合异常结束 | 运行时 | 既有，不改 |
| `thread` | 多智能体线程 | `session.thread_created` | 子线程已创建 | 运行时 | 追加 `session.thread_created` 后 |
| `thread` | 多智能体线程 | `session.thread_idled` | 子线程停下 | 运行时 | 追加 `session.thread_status_idle` 后 |
| `thread` | 多智能体线程 | `session.thread_terminated` | 子线程已终止 | 运行时 | 追加 `session.thread_status_terminated` 后 |
| `agent` | 智能体 | `agent.created` | 已创建 | 管理台 | `createAgent` / `createAgentWithInitialVersion` 成功后 |
| `agent` | 智能体 | `agent.version_published` | 发布新版本 | 管理台 | `createAgentVersion` 成功且返回 `created === true` 后（manifest 未变、未产生新版本时不发） |
| `agent` | 智能体 | `agent.deleted` | 已删除 | 管理台 | `deleteAgent` 成功后 |
| `environment` | 执行环境 | `environment.created` | 已创建 | 管理台 | `createMaEnvironment` 成功后 |
| `environment` | 执行环境 | `environment.updated` | 已更新 | 管理台 | `updateMaEnvironment` 成功后 |
| `environment` | 执行环境 | `environment.deleted` | 已删除 | 管理台 | `deleteMaEnvironment` 成功后 |
| `vault` | 凭证库 | `vault.created` | 凭证库已创建 | 管理台 | `createMaVault` 成功后 |
| `vault` | 凭证库 | `vault.archived` | 凭证库已归档 | 管理台 | `archiveMaVault` 成功后 |
| `vault` | 凭证库 | `vault.deleted` | 凭证库已删除 | 管理台 | `deleteMaVault` 成功后 |
| `vault` | 凭证库 | `vault_credential.created` | 凭证已创建 | 管理台 | `createMaCredential` 成功后 |
| `vault` | 凭证库 | `vault_credential.archived` | 凭证已归档 | 管理台 | `archiveMaCredential` 成功后（随凭据库归档的级联不单独发，v1 不做） |
| `vault` | 凭证库 | `vault_credential.deleted` | 凭证已删除 | 管理台 | `deleteMaCredential` 成功后 |
| `vault` | 凭证库 | `credential.expiring` | 凭证即将过期 | 运行时 | 既有，不改 |
| `memory_store` | 记忆库 | `memory_store.created` | 已创建 | 管理台 | `createMemoryStore` 成功后 |
| `memory_store` | 记忆库 | `memory_store.archived` | 已归档 | 管理台 | `archiveMemoryStore` 成功后 |
| `memory_store` | 记忆库 | `memory_store.deleted` | 已删除 | 管理台 | `deleteMemoryStore` 成功后 |
| `schedule` | 定时任务 | `schedule.created` | 已创建 | 管理台 | `createMaSchedule` 成功后 |
| `schedule` | 定时任务 | `schedule.updated` | 已更新（含启停） | 管理台 | `updateMaSchedule` 成功后 |
| `schedule` | 定时任务 | `schedule.deleted` | 已删除 | 管理台 | `deleteMaSchedule` 成功后 |
| `schedule_run` | 定时运行 | `schedule_run.started` | 已开始 | 运行时 | `ScheduleTicker._fire` 把 run 置为 `running` 后 |
| `schedule_run` | 定时运行 | `schedule_run.succeeded` | 已成功 | 运行时 | `ScheduleTicker` 把 run 置为 `succeeded` 后 |
| `schedule_run` | 定时运行 | `schedule_run.failed` | 已失败 | 运行时 | `ScheduleTicker` 把 run 置为 `failed` 后（含超时、创建会话失败、需审批） |

英文名（en.json）：用与中文对应的简短英文，如 `Run started`、`Stopped (incl. awaiting approval)`、`Created`、`Version published`。

### 2.1 Payload

所有通知外层不变：`{"type":"event","id":<ULID>,"created_at":<ISO8601 Z>,"data":{...}}`，`webhook-id` 头等于外层 `id`。

- 会话类（新 2 种）：`data` = `{type, tenant_id, session_id, agent_id, agent_version, source}`；`session.status_idled` 额外带 `stop_reason: {"type": <stop type>}`。复用 `WebhookOutbox._session_payload` 的字段取法（不带 `schedule_*`、不带 `result_text`）。
- 线程类：`data` = `{type, tenant_id, session_id, agent_id, thread_id, thread_agent_id?}`，`thread_id` / `thread_agent_id` 取事件 payload 中的同名或等价字段（实施前读 `threads.py` 对应事件 payload 确认键名；找不到 `thread_agent_id` 就不带）。终止类额外带 `reason`（若事件 payload 有）。
- 定时运行类：`data` = `{type, tenant_id, schedule_id, schedule_run_id, agent_id, session_id|null, error|null}`。
- 资源类：`data` = `{type, tenant_id, resource_type, resource_id}`，另按类型附带：`agent.version_published` 带 `version`；`vault_credential.*` 带 `vault_id`；`schedule.*` 带 `agent_id`；`agent.*` 的 `agent_id` = `resource_id`。不带任何密钥、明文配置或凭据值。

### 2.2 订阅过滤语义

- 租户：必须相同。
- `event_types`：必须包含该类型。
- `agent_ids`（非空时）：只对带 `agent_id` 的事件生效，事件的 `agent_id` 须在列表里；不带 `agent_id` 的事件（环境、凭据库、凭据、记忆库）照常投递。
- `sources`（非空时）：只对会话类与线程类生效（按会话 `source`）；其它类型忽略此过滤。
- `include_result_text`：只对 `session.idle` / `session.failed` 生效（既有行为）。

## 3. S1 — 管理台后端、数据表、协议文档（TS）

### 3.1 core-api 目录

文件 `enterprise/packages/core-api/src/managed-agents.ts`，在 `PAT_SCOPES`（L44）附近新增并导出：

```ts
export const MA_WEBHOOK_EVENT_GROUPS = [
  { key: "session", types: ["session.status_run_started", "session.status_idled", "session.idle", "session.failed"] },
  { key: "thread", types: ["session.thread_created", "session.thread_idled", "session.thread_terminated"] },
  { key: "agent", types: ["agent.created", "agent.version_published", "agent.deleted"] },
  { key: "environment", types: ["environment.created", "environment.updated", "environment.deleted"] },
  { key: "vault", types: ["vault.created", "vault.archived", "vault.deleted", "vault_credential.created", "vault_credential.archived", "vault_credential.deleted", "credential.expiring"] },
  { key: "memory_store", types: ["memory_store.created", "memory_store.archived", "memory_store.deleted"] },
  { key: "schedule", types: ["schedule.created", "schedule.updated", "schedule.deleted"] },
  { key: "schedule_run", types: ["schedule_run.started", "schedule_run.succeeded", "schedule_run.failed"] },
] as const;
export type MaWebhookEventGroupKey = (typeof MA_WEBHOOK_EVENT_GROUPS)[number]["key"];
export type MaWebhookEventType = (typeof MA_WEBHOOK_EVENT_GROUPS)[number]["types"][number];
export const MA_WEBHOOK_EVENT_TYPES: readonly MaWebhookEventType[] = MA_WEBHOOK_EVENT_GROUPS.flatMap((g) => g.types);
export const MA_WEBHOOK_RESOURCE_EVENT_TYPES = [/* §2 表中产生方=管理台的 18 个 */] as const;
export type MaWebhookResourceEventType = (typeof MA_WEBHOOK_RESOURCE_EVENT_TYPES)[number];
```

确认 core-api 包导出入口（`src/index.ts`）已经 `export * from "./managed-agents"`；没有就补一行。

### 3.2 iam-core

文件 `enterprise/packages/iam-core/src/repos/ma-webhooks.ts`：
- L28–29 改为从 `@agenticx/core-api` 导入并重新导出 `MA_WEBHOOK_EVENT_TYPES` / `MaWebhookEventType`（保持对外名字不变，`readEventTypes` 无需改逻辑）。
- `MaWebhook` 类型新增 `description: string`、`disabledReason: string | null`、`disabledAt: string | null`、`failureResetAt: string | null`。
- `normalizeWebhookInput`：允许 key 增加 `description`（字符串，trim，≤2048，缺省 `""`）。
- `updateMaWebhook`：当 `enabled` 从 false 变为 true 时，同时写 `disabled_reason = null`、`disabled_at = null`、`failure_reset_at = now`。
- 新增 `autoDisableMaWebhook(tenantId, webhookId, reason: "consecutive_failures" | "gone")`：仅当当前 `enabled = true` 时写 `enabled = false`、`disabled_reason`、`disabled_at = now`，返回是否改动。
- `listEnabledMaWebhooksForRuntime` 返回项增加 `failure_reset_at`（ISO 或 null）。
- PG / MySQL 两条分支都要改（`src/repos/mysql/ma-webhooks.ts` 对应函数）。

### 3.3 db-schema 迁移

- PG：`enterprise/packages/db-schema/drizzle/0070_ma_webhook_catalog.sql`；MySQL：`enterprise/packages/db-schema/drizzle-mysql/0044_ma_webhook_catalog.sql`。内容：`ma_webhooks` 增加 `description`（PG `text NOT NULL DEFAULT ''`；MySQL `varchar(2048) NOT NULL DEFAULT ''`）、`disabled_reason varchar(64) NULL`、`disabled_at`（PG `timestamptz`，MySQL `datetime(3)`，与该表现有时间列同型）、`failure_reset_at`（同上）。MySQL 多语句之间用 `--> statement-breakpoint`。
- 更新两份 `meta/_journal.json`（追加 idx 69 / tag `0070_ma_webhook_catalog`；idx 44 / tag `0044_ma_webhook_catalog`，`when` 取比上一条大的时间戳）。
- 更新 drizzle 表定义：`src/schema/ma-webhooks.ts` 与 `src/mysql-schema/ma-webhooks.ts`。
- 更新测试：`src/__tests__/migration-inventory.test.ts`（PG journal 条数 69→70，磁盘 sql 数 71→72）、`src/__tests__/ma-schema.test.ts`（`ma_webhooks` 列清单 L319–336）、`schema-parity.test.ts` 的 MySQL 迁移清单（加入 `0044_ma_webhook_catalog.sql`）。
- 不要改 `ma_webhook_deliveries`。

### 3.4 管理台：资源事件发出

新文件 `enterprise/apps/admin-console/src/lib/ma/webhook-events.ts`：

```ts
export function emitMaResourceEvent(input: {
  tenantId: string;
  type: MaWebhookResourceEventType;
  resourceId: string;
  extra?: { agent_id?: string; vault_id?: string; version?: number };
}): void
```

- 生成 ULID 作为事件 `id`（用仓库已有的 ULID 工具；admin-console 内搜 `ulid` 找现有实现），`occurred_at = new Date().toISOString()`。
- 调 `runtimeInternal("POST", "/internal/ma/webhook-events", body)`（看 `runtime-internal-client.ts` 的实际签名），超时 2 秒；任何异常只 `console.warn("[ma-webhook-event] ...")`，不 throw、不 await 到响应路径上（用 `void promise.catch(...)`）。
- 环境变量 `MA_WEBHOOK_EVENTS_ENABLED=0` 时直接返回（默认开）。
- body：`{"id","tenant_id","type","resource_type","resource_id","occurred_at", ...extra}`，`resource_type` 由类型前缀推出（`vault_credential.*` → `vault_credential`）。

在下列路由「repo 调用成功之后、返回响应之前」各加一行 `emitMaResourceEvent(...)`。admin 路由与公共 `/api/ma/v1` 路由都要加：

| 类型 | admin 路由 | 公共路由 |
|---|---|---|
| `agent.created` | `src/app/api/admin/agents/route.ts` POST | `src/app/api/ma/v1/agents/route.ts` POST |
| `agent.version_published` | `src/app/api/admin/agents/[agentId]/versions/route.ts` POST | `src/app/api/ma/v1/agents/[agentId]/versions/route.ts` POST |
| `agent.deleted` | `src/app/api/admin/agents/[agentId]/route.ts` DELETE | 无 |
| `environment.*` | `src/app/api/admin/ma-environments/route.ts` POST；`[envId]/route.ts` PATCH / DELETE | `src/app/api/ma/v1/environments/**` 对应方法 |
| `vault.*` | `src/app/api/admin/ma-vaults/route.ts` POST；`[vaultId]/archive/route.ts` POST；`[vaultId]/route.ts` DELETE | `src/app/api/ma/v1/vaults/**` 对应方法 |
| `vault_credential.*` | `.../credentials/route.ts` POST；`.../credentials/[credentialId]/archive/route.ts` POST；`.../credentials/[credentialId]/route.ts` DELETE | 公共同路径 |
| `memory_store.*` | `src/app/api/admin/ma-memory-stores/route.ts` POST；`[storeId]/archive/route.ts` POST；`[storeId]/route.ts` DELETE | `src/app/api/ma/v1/memory_stores/**` 对应方法 |
| `schedule.*` | `src/app/api/admin/ma-schedules/route.ts` POST；`[scheduleId]/route.ts` PATCH / DELETE | `src/app/api/ma/v1/schedules/**` 对应方法 |

`tenantId` 用该路由已解析出的租户；`agent_id` / `vault_id` / `version` 从 repo 返回值或路径参数取。不得改动这些路由的其它逻辑。路由文件里只加 import 与一行调用。

### 3.5 管理台：内部停用接口与字段透出

- 新路由 `src/app/api/internal/ma/webhooks/[webhookId]/auto-disable/route.ts`：POST，鉴权同 `src/app/api/internal/ma/webhooks/route.ts`（`isMaInternalAuthorized`）；body `{"tenant_id","reason"}`，`reason ∈ {"consecutive_failures","gone"}`；调 `autoDisableMaWebhook`；返回 `{"data":{"disabled":bool}}`。
- `src/lib/ma/webhook-records.ts`：`WEBHOOK_KEYS` 与 `toMaWebhookRecord` 增加 `description`、`disabled_reason`、`disabled_at`。
- admin 与公共 webhook 路由的允许 key 集合（admin L9、公共同名常量）增加 `description`。

### 3.6 协议文档

`docs/managed-agents/protocol.md` 的 `## 定时任务与 Webhook（MA-E08）` 一节（L510–532）：替换 L528 事件名说明为 §2 全表（类型 + 一句触发说明）、§2.1 payload、§2.2 过滤语义、自动停用规则（§4.5）。

### 3.7 S1 验收

| AC | 断言 |
|---|---|
| AC-S1-1 | `enterprise/packages/iam-core/src/repos/__tests__/ma-webhooks-validate.test.ts`：29 种类型都通过；`deployment.created` 被拒；`description` 超过 2048 被拒；缺省为 `""` |
| AC-S1-2 | `enterprise/apps/admin-console/src/lib/ma/__tests__/webhook-events.test.ts`（新）：mock `runtimeInternal`，断言 body 字段与 `resource_type` 推导；`MA_WEBHOOK_EVENTS_ENABLED=0` 不调用；`runtimeInternal` 抛错时函数不抛 |
| AC-S1-3 | `src/app/api/internal/ma/__tests__/schedule-webhook-internal-routes.test.ts` 追加：auto-disable 无令牌 401；有令牌时调用 `autoDisableMaWebhook`；内部列表含 `failure_reset_at` |
| AC-S1-4 | `src/app/api/ma/v1/__tests__/webhooks-route.test.ts` 追加：创建带 `description` 回显；记录含 `disabled_reason` |
| AC-S1-5 | 至少两个资源路由测试（环境 POST、凭据库 archive）断言成功后调用了 `emitMaResourceEvent` 且参数正确；repo 抛错时不调用 |
| AC-S1-6 | `pnpm --filter @agenticx/db-schema test` 全绿；`pnpm --filter @agenticx/iam-core test`、`pnpm --filter @agenticx/app-admin-console test` 与改动前相比无新增失败 |

## 4. S2 — 运行时事件、资源事件入队、自动停用（Python）

文件均在 `enterprise/apps/agent-runtime/ma_agent_runtime/`。

### 4.1 事件监听扩展（`session_hooks.py`）

- 新增 `add_event_listener(listener, types: frozenset[str])`，存成 `(types, listener)` 列表；`append_events` 中对每条 stored 事件，除了现有 `TERMINAL_EVENT_TYPES` → terminal listeners 的分发（**不改**），再对类型命中的 event listeners 用同样的 `create_task(self._safe(...))` 分发。
- `add_terminal_listener` 与 `TERMINAL_EVENT_TYPES` 保持原样，`ScheduleTicker.on_terminal` 的调用时机不能变。

### 4.2 会话与线程事件（`webhooks.py`）

- 常量 `SESSION_EVENT_MAP = {"session.status_running": "session.status_run_started", "session.status_idle": "session.status_idled", "session.thread_created": "session.thread_created", "session.thread_status_idle": "session.thread_idled", "session.thread_status_terminated": "session.thread_terminated"}`。
- `WebhookOutbox.on_session_event(tenant_id, session_id, event)`：按映射取 webhook 类型；取会话（`self._store.get_session`）；按 §2.2 过滤；构造 §2.1 payload；`event_key = f"{webhook_type}:{event.id}"`；插入方式与 `on_terminal` 相同（`_insert_ignore`）。
- `app.py` 在 `if settings.webhooks_enabled:` 块（L237–246）里，在 `store.add_terminal_listener(outbox.on_terminal)` 之后加 `store.add_event_listener(outbox.on_session_event, frozenset(SESSION_EVENT_MAP))`。`on_terminal` 行为不变。

### 4.3 定时运行事件（`scheduler.py`）

- `ScheduleTicker.__init__` 增加可选参数 `on_run_event: Callable[[dict[str, Any]], Awaitable[None]] | None = None`。
- 在 run 状态成功写为 `running`（`_fire` L395–406 之后）、`succeeded`（`on_terminal` L182）、`failed`（`on_terminal` L179 与 L184–190、`_fire` 的两个 except、`_timeouts` L451）之后，调用 `await self._emit_run_event(type, row_or_ids, session_id, error)`；`_emit_run_event` 内部 try/except 只记日志。`_mark` 返回值若不能判断是否真的更新了行，就让 `_mark` 返回 rowcount（只加返回值，不改既有调用方行为），只在 rowcount==1 时发事件，避免重复。
- `WebhookOutbox.enqueue_schedule_run_event(data)`：按 §2.2 过滤（`agent_ids` 用 `data["agent_id"]`），`event_key = f"{type}:{schedule_run_id}"`。
- `app.py`：当 scheduler 与 webhooks 同时开启时，先构造 outbox 再构造 ticker 并传 `on_run_event=outbox.enqueue_schedule_run_event`。只开 scheduler 时传 None。调整构造顺序时不得改变 `store.add_terminal_listener(ticker.on_terminal)` 先于 `outbox.on_terminal` 注册的顺序。

### 4.4 资源事件内部接口

- 新文件 `webhook_events_routes.py`：`build_internal_router(settings, outbox) -> APIRouter`，前缀 `/internal/ma`，`POST /webhook-events`。鉴权与 `memory_dreams.py` L944 起的 `build_internal_router` 相同（Bearer 比对 `settings.internal_token`，失败 401）。
- body 校验：`id` 26 位 ULID；`tenant_id` 非空；`type` ∈ 资源类 18 种（§2 产生方=管理台）；`resource_id` 非空；可选 `agent_id` / `vault_id` / `version` / `occurred_at`。不合法返回 400 `{"error":{"code":"invalid_request","message":...}}`。
- `WebhookOutbox.enqueue_resource_event(body) -> int`：按 §2.2 过滤，`event_key = f"{type}:{id}"`，payload 外层 `id` 用 body 的 `id`，`created_at` 用 `occurred_at`（缺省 now）。返回插入数，路由响应 `{"data":{"enqueued":n}}`。
- `app.py`：在 `settings.webhooks_enabled` 块里 `app.include_router(build_internal_router(settings, outbox))`。

### 4.5 自动停用

- `config.py` 新增：`webhook_auto_disable_failures`（`MA_WEBHOOK_AUTO_DISABLE_FAILURES`，默认 20，范围 1–1000）、`webhook_auto_disable_hours`（`MA_WEBHOOK_AUTO_DISABLE_HOURS`，默认 24，范围 0–720，0 表示不看时间跨度）。沿用该文件现有 `_int_ok` / `_float_ok` 写法。
- `control_plane.py` `AdminConsoleClient` 新增 `auto_disable_webhook(tenant_id, webhook_id, reason) -> bool`，POST `/api/internal/ma/webhooks/{id}/auto-disable`。
- `WebhookDeliverer`：
  - 收到 `410` → 本次投递按既有逻辑记 `failed`，并立即 `auto_disable_webhook(..., "gone")`。
  - 任一投递最终落为 `failed`（不含 `last_error == "webhook_disabled"`、不含 `abandoned`）后，统计该 webhook 自 `max(最近一次 succeeded 的 delivered_at, failure_reset_at)` 之后 `status='failed'` 的条数 N 与其中最早一条的 `created_at`；当 N ≥ 阈值且（小时数为 0 或最早一条早于 now − 小时数）→ `auto_disable_webhook(..., "consecutive_failures")`，成功后调用 `self._cache` 失效（给 `WebhookConfigCache` 加 `invalidate()`）。
  - 调用失败只记日志。
- 自动停用后端点不在内部列表里，后续 pending 投递会按既有逻辑落 `webhook_disabled`。

### 4.6 S2 验收

新增或追加到 `enterprise/apps/agent-runtime/tests/test_webhooks.py`（或新文件 `test_webhook_catalog.py`），用现有测试里的 fake store / fake cache 写法：

| AC | 断言 |
|---|---|
| AC-S2-1 | `session.status_running` 追加后，订阅 `session.status_run_started` 的端点入队 1 条；未订阅的不入队；`sources` 过滤生效 |
| AC-S2-2 | `session.status_idle`（stop_reason=requires_action）同时产生旧的 `session.idle` 与新的 `session.status_idled`（两类订阅各一条），旧行为不变 |
| AC-S2-3 | 三种线程事件映射正确，payload 含 `thread_id` |
| AC-S2-4 | 定时运行：`_fire` 成功后发 `schedule_run.started`；会话 `end_turn` 后发 `succeeded`；超时发 `failed` 且带 `error="timeout"`；同一 run 不重复 |
| AC-S2-5 | `POST /internal/ma/webhook-events`：无令牌 401；非法 type 400；合法时按租户与 `agent_ids` 过滤入队；同一 `id` 重复调用只入队一次 |
| AC-S2-6 | 自动停用：阈值 3、小时 0，连续 3 次最终失败后调用 `auto_disable_webhook(reason="consecutive_failures")`；中间一次成功会重置；`failure_reset_at` 晚于失败时不计；410 立即停用 |
| AC-S2-7 | `test_webhook_catalog_parity`：读取 `enterprise/packages/core-api/src/managed-agents.ts`，用正则取出 `MA_WEBHOOK_EVENT_GROUPS` 里所有类型字符串，与 Python 端（会话映射值 5 种 + 定时运行 3 种 + 资源 18 种 + 旧 3 种 = 29）集合相等 |
| AC-S2-8 | `python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q` 与改动前相比无新增失败；运行前确认 shell 没有导出 `DATABASE_URL` |

## 5. S3 — 新建 / 编辑弹窗与列表（管理台 UI）

文件 `enterprise/apps/admin-console/src/app/admin/_sections/agent-webhooks.tsx`，i18n `enterprise/apps/admin-console/messages/zh.json` 与 `en.json` 的 `pages.admin.agentWebhooks`。依赖 S1 的 `MA_WEBHOOK_EVENT_GROUPS`。

- 删除本地 `EVENT_TYPES`，改用 `MA_WEBHOOK_EVENT_GROUPS` / `MA_WEBHOOK_EVENT_TYPES`。`eventLabel` 改为查 i18n `events.<type 中的 . 换成 _>`（例如 `events.session_status_run_started`），未知类型回落原字符串。删除旧的 `isEventType` switch 时，如保留 switch 必须保持 `never` 穷尽检查。
- 字段顺序：端点 URL（placeholder `https://example.com/webhooks`）→ 名称（右侧 `n/120` 计数）→ 描述（多行，右侧 `n/2048` 计数，placeholder「说明这个端点接收哪些事件、由谁维护」）→ 事件类型 → 高级设置（默认收起：限定智能体、限定来源、附带回复正文）。
- 事件类型区：标题行左「事件类型」，右「全选」复选框 + 「已选择 X / 29 个事件类型」。每个分组一个卡片块：分组复选框（全选 / 部分选中显示 indeterminate / 未选）+ 分组名 + 右侧 `已选/组内总数`；组内每项一行：复选框 + 中文名 + 等宽小字英文类型名。分组名 i18n `eventGroups.<key>`。
- 新建默认不勾选任何事件（不再默认 `session.idle`）；保存时未选任何事件，在弹窗内显示「至少选择一种事件」，不发请求。
- 弹窗：`DialogContent` 宽度 `sm:max-w-2xl`，内容区可滚动（`max-h-[70vh] overflow-y-auto`），底部操作栏固定不滚动；底部「取消」紧挨主按钮左侧，主按钮文案新建时「新建 Webhook 端点」、编辑时「保存」。背景与输入框用现有主题 token，不使用半透明背景。
- 列表：「名称」列下方用次要文字显示描述（单行截断）；「启用」列：端点被自动停用（`disabled_reason` 非空）时，开关旁显示红色小字「已自动停用：连续投递失败」/「已自动停用：接收方返回 410」（i18n `disabledReason.consecutive_failures` / `disabledReason.gone`）。
- 投递记录 Sheet 的事件列使用新的 `eventLabel`。
- 不改动删除确认、密钥弹窗、轮换逻辑。

S3 验收：
| AC | 断言 |
|---|---|
| AC-S3-1 | `pnpm --filter @agenticx/app-admin-console exec tsc --noEmit` 与改动前相比无新增错误（既有错误在 `audit/page.tsx` 等，不要修） |
| AC-S3-2 | zh / en 两份 messages 都有 29 个 `events.*`、8 个 `eventGroups.*`、`disabledReason.*`、描述与高级设置相关键；新增一条单测（vitest）断言 `MA_WEBHOOK_EVENT_TYPES` 的每个类型在两份 messages 中都有对应键 |
| AC-S3-3 | 由 S4 的 e2e 覆盖交互 |

### 5.1 S3b — 侧栏拆出「智能体运行」「资源配置」两组

背景：托管智能体页面现在混在「平台配置」（`enterprise/apps/admin-console/src/components/AppShell.tsx` `NAV_GROUPS` 的 `platform` 组，L118–142，共 19 项）里；会话列表只是「运行观测」页的一个 tab（`src/app/ops/logs/page.tsx` L21 `{ id: "managed", label: "托管会话" }`，渲染 `ManagedSessionsPanel` L99–103），地址 `/ops/logs?tab=managed`；智能体用量在 `ops` 组（L115）。侧栏高亮按路径最长前缀匹配（`activeItem`，L364–368），不看查询参数，所以不能直接把 `?tab=managed` 做成菜单项。会话详情页已经在 `src/app/ops/logs/managed/[sessionId]/page.tsx`。

改动：
1. 新文件 `src/app/ops/logs/managed/page.tsx`：独立的会话列表页，页头用 `PageHeader`（标题「会话」，描述沿用该面板现有说明或留空），主体渲染 `ManagedSessionsPanel`（与 `ops/logs/page.tsx` 一样用 `dynamic(..., { ssr: false })` 引入），`reloadToken` 用本页自己的刷新状态（若面板必须传，给一个常量 0 并提供页头刷新按钮自增）。权限沿用该面板现有的取数接口校验，不新增权限逻辑。`ops/logs/page.tsx` 的「托管会话」tab 保持不动。
2. `NAV_GROUPS`：在 `ops` 组之后、`platform` 组之前插入两组，并从 `platform` / `ops` 中移除对应项（只移动，不改 href / icon / labelKey）：
   - `{ id: "agentRuntime", items: [agents（/admin/agents）, agentSessions（新，/ops/logs/managed，图标用 lucide `MessagesSquare` 以外的会话类图标如 `MessageSquareText`）, agentEvals（保留原开关条件）, agentSchedules, agentUsage（/metering/agents）] }`
   - `{ id: "agentResources", items: [agentEnvironments, agentVaults, agentMemory, agentWebhooks, agentChannels] }`
   - `platform` 组剩下：policy、models、channels、cache、apiTokens、mcpServers、connectors、capabilities、plugins。
3. i18n（zh / en 两份 messages）：`nav.groups.agentRuntime` =「智能体运行」/ `Agent runtime`；`nav.groups.agentResources` =「资源配置」/ `Agent resources`；`nav.items.agentSessions` =「会话」/ `Sessions`。现有菜单名保持不变（执行环境、凭证库、记忆库、Webhook 通知、IM 渠道、智能体、评测、定时任务、智能体用量）。
4. 命令面板（AppShell L694 起按 `NAV_GROUPS` 渲染）与面包屑（L371–373）自动跟随，无需单独改；改完确认面包屑在新会话页显示「智能体运行 / 会话」。

S3b 验收：
| AC | 断言 |
|---|---|
| AC-S3b-1 | 在 `/ops/logs/managed` 与 `/ops/logs/managed/<id>` 侧栏高亮「会话」，不高亮「运行观测」；在 `/ops/logs` 高亮「运行观测」 |
| AC-S3b-2 | `platform` 组不再包含任何托管智能体页面；两个新组顺序与内容同上 |
| AC-S3b-3 | 新增一条 vitest：遍历 `NAV_GROUPS`，断言两份 messages 都有每个 `nav.groups.<id>` 与 `nav.items.<labelKey>` 键；断言 `agentRuntime` / `agentResources` 的 href 列表与本节一致 |
| AC-S3b-4 | S4 的 e2e 追加一条：从侧栏「资源配置 → Webhook 通知」进入 Webhook 页（用定位器点击，断言页面标题） |

## 6. S4 — 智能体驱动的 e2e

### 6.1 位置与依赖

新目录 `enterprise/e2e/`（独立 npm 项目，不加入 pnpm workspace，避免影响现有构建）：
- `package.json`：`"private": true`，`"type": "module"`，scripts `"test": "e2e run"`；devDependencies `e2e@0.21.3`、`@e2e-dev/web`（与 e2e 同版本线，按 `npx e2e init` 生成的版本）、`ai`、`@ai-sdk/openai-compatible`、`typescript`。
- `.gitignore`：`node_modules/`、`.e2e/`（含 cache、报告、录像）。
- 先用 `npx e2e@0.21.3 init --yes` 生成骨架再改，保证配置格式与该版本一致；`node_modules/e2e/docs` 有离线文档，遇到 API 不确定就查这里。

### 6.2 配置 `enterprise/e2e/e2e.config.ts`

- target：`web()`，`app.url = process.env.ADMIN_URL ?? 'http://localhost:3001'`，不配 `command`（服务由开发者先起）。
- 模型：`createOpenAICompatible({ name: 'e2e-model', baseURL: process.env.E2E_MODEL_BASE_URL, apiKey: process.env.E2E_MODEL_API_KEY })`，`agents.default.model = provider.chatModel(process.env.E2E_MODEL_ID)`；三个变量缺任意一个时让配置加载报清楚的错误。模型须支持工具调用与图片输入。
- credentials：`admin: { username: process.env.ADMIN_EMAIL ?? 'admin@agenticx.local', password: process.env.ADMIN_CONSOLE_LOGIN_PASSWORD ?? '' }`（实施前读 `enterprise/apps/admin-console/src/app/login/page.tsx` 与其登录 API 确认管理台登录用的邮箱与密码来源，以实际为准）。
- `timeout: 180_000`，`workers: 1`，`video: 'retain-on-failure'`。

### 6.3 本机接收器 `enterprise/e2e/support/webhook-receiver.ts`

- `startReceiver(): Promise<{ url: string; received: Received[]; setSecret(s: string): void; close(): Promise<void> }>`：Node `http` 监听 `127.0.0.1:0`，收集 POST 的原始 body 与三个签名头。
- `verify(raw, headers, secret)`：按协议文档实现 Standard Webhooks 验签（去 `whsec_` 前缀 → base64 解码 → HMAC-SHA256(`id.timestamp.` + raw) → `v1,<base64>`，恒定时间比较，时间戳 5 分钟容差）。
- 运行时投递回环地址需要 `MA_WEBHOOK_ALLOW_LOOPBACK=1`（启动运行时时设置）。

### 6.4 测试 `enterprise/e2e/tests/`

- `auth.setup.e2e.ts`：`test.setup('admin signs in', { sessions: ['admin'] }, ...)`，用定位器登录，断言进入管理台后保存 session。
- `webhook-catalog.e2e.ts`（`{ session: 'admin' }`）：
  1. 打开 Webhook 页面（读 `agent-webhooks.tsx` 所在路由与侧栏入口确认 URL）。
  2. 用定位器点「新建」，填 URL（接收器地址）、名称 `unique('e2e-hook-<ts>')`、描述。
  3. `agent.act('在事件类型里只勾选「执行环境」分组下的全部事件', ...)`；随后 `expect` 断言计数文字「已选择 3 / 29 个事件类型」与执行环境分组计数「3 / 3」。
  4. 点「新建 Webhook 端点」；断言密钥弹窗出现，用定位器读出 `whsec_` 开头的密钥交给接收器；关闭弹窗；断言列表出现该名称与描述。
  5. 用浏览器 cookies 调 `POST /api/admin/ma-environments` 创建一个测试环境（请求体照该路由的校验要求构造，名称带时间戳）。
  6. `expect.poll` 等接收器收到 `data.type === 'environment.created'` 且 `data.resource_id` 等于新环境 id，且验签通过（超时 30 秒）。
  7. 打开该端点的投递记录，`agent.assert('投递记录里有一条环境已创建的记录，状态是成功')`，再用定位器断言表格含 `succeeded`。
  8. `afterEach` / 末尾清理：删除测试环境与该端点（走 admin API 或界面，任选其一，必须清理）。
- `webhook-select-all.e2e.ts`：打开新建弹窗，点「全选」，断言「已选择 29 / 29 个事件类型」；取消全选后断言「已选择 0 / 29」；勾选一个分组项后该分组复选框为部分选中（`aria-checked="mixed"` 或等价断言）；关闭弹窗不保存。
- 会话、线程、定时运行三类事件不在 e2e 里跑（本地运行时库与管理台库不同，无法造真实会话），由 S2 的 pytest 覆盖。

### 6.5 运行方式（写进 `enterprise/e2e/README.md`，简短）

1. 管理台已在 3001 运行；运行时以 `MA_RUNTIME_WEBHOOKS_ENABLED=1 MA_WEBHOOK_ALLOW_LOOPBACK=1` 和与管理台相同的内部令牌在 8092 运行。
2. 导出 `E2E_MODEL_BASE_URL`、`E2E_MODEL_API_KEY`、`E2E_MODEL_ID`、`ADMIN_CONSOLE_LOGIN_PASSWORD`。
3. `cd enterprise/e2e && npm install && npx e2e run`；首次跑完 `agent.act` 步骤会录入 `.e2e/cache/`，再跑会回放。

S4 验收：`npx e2e run` 三个测试全部通过；再跑一次时运行摘要显示 `act` 步骤为 replayed。

## 6.6 S5 — 投递记录改由运行时提供（e2e 发现的缺陷）

证据：S4 e2e 中，本机接收器两次验签收到 `environment.created`，PG（运行时库 `127.0.0.1:55432/ma`）`ma_webhook_deliveries` 有 2 行 `succeeded / 204`，管理台所在 MySQL 的同名表 0 行；管理台投递记录弹窗空表。根因：`ma_webhook_deliveries` 只由运行时写（表定义文件头注释），运行时只支持 PostgreSQL；管理台两条投递记录路由直接调 iam-core `listMaWebhookDeliveries` 读本地库（`src/app/api/admin/ma-webhooks/[webhookId]/deliveries/route.ts`、`src/app/api/ma/v1/webhooks/[webhookId]/deliveries/route.ts`）。管理台用 MySQL 部署时（运行时必须另配 PG），投递记录永远为空。该缺陷在 MA-E08 就已存在，不是本规划引入。

改动：
1. 运行时 `webhook_events_routes.py` 的 `build_internal_router` 增加 `GET /internal/ma/webhooks/{webhook_id}/deliveries?tenant_id=&limit=`：同一 Bearer 鉴权；`tenant_id` 必填；`limit` 1–200 默认 50；按 `tenant_id` + `webhook_id` 过滤、`created_at` 倒序；响应 `{"data":[{id, webhook_id, event_id, event_type, status, attempts, next_attempt_at, last_status_code, last_error, delivered_at, created_at}]}`，时间字段 ISO8601（UTC，`Z` 结尾），不返回 `payload` 与 `event_key`。该路由随 `webhooks_enabled` 一起挂载（与 POST 同一路由器）。
2. 管理台新文件 `src/lib/ma/webhook-deliveries.ts`：`listWebhookDeliveriesFromRuntime(tenantId, webhookId, limit)` 调 `runtimeInternal("GET", ...)`，返回与 `MA_WEBHOOK_DELIVERY_RECORD_KEYS` 同键的记录数组（运行时字段已是 snake_case，按键白名单挑字段即可）。
3. 两条投递记录路由改为调用第 2 步函数；admin 路由仍返回 `ok({ deliveries })`，公共路由仍返回 `{ data }`。运行时不可达（`MaRuntimeUnavailableError`）时：admin 返回 503 `{code:"50300", message:"运行时不可达，暂时无法读取投递记录"}`；公共路由返回 503 `{"error":{"code":"runtime_unavailable","message":"runtime unavailable"}}`（先在 `src/lib/ma/errors.ts` 查是否已有等价错误码，有则复用）。`MaRuntimeRequestError` 原样映射其 status。
4. 不删除 iam-core `listMaWebhookDeliveries`（其它地方可能引用，保持不动）。

验收：
| AC | 断言 |
|---|---|
| AC-S5-1 | 运行时 pytest：无令牌 401；缺 `tenant_id` 400；只返回该租户该端点的记录、倒序、`limit` 生效；不含 `payload` |
| AC-S5-2 | 管理台 vitest：两条路由 mock `runtimeInternal` 返回记录时透传；抛 `MaRuntimeUnavailableError` 时 503 |
| AC-S5-3 | `enterprise/e2e` 的 `webhook-catalog.e2e.ts` 全部通过（投递记录弹窗显示 `succeeded`） |

## 7. In scope / Out of scope

In scope：§2 的 29 种事件、§2.1 payload、§2.2 过滤、描述字段、自动停用、弹窗与列表改造、§5.1 侧栏分组与独立会话列表页、协议文档、§6 e2e。

Out of scope（不要做）：
- 随凭据库归档级联发凭据归档通知；`session.deleted` / `session.updated` / `session.status_rescheduled` / 任何 `deployment.*`。
- 测试投递按钮、手动补发、历史重放。
- 改 `ma_webhook_deliveries` 表结构、改签名算法、改退避参数、改地址策略。
- 改 Go 网关、Desktop、web-portal。
- 修既有失败用例（admin `audit/page.tsx` 类型错误、web-portal tsc 基线、`tests/test_studio_server.py` 三条等）。
- 新建「快速开始」「技能」「文件」等托管智能体页面；改菜单项名称（执行环境 / 凭证库 / 记忆库保持现名）；删除「运行观测」里的托管会话 tab。
- 触碰 `agenticx/studio/server.py`。

## 8. 子规划与推荐模型

| 子规划 | 内容 | 依赖 | 推荐模型 | 理由 |
|---|---|---|---|---|
| S1 | core-api 目录、iam-core、迁移、管理台路由发事件、内部停用接口、协议文档 | 无 | Grok 4.7 | 多文件样板接线，PG/MySQL 双分支需要细心 |
| S2 | 运行时监听、映射、资源事件入队、定时运行事件、自动停用 | 只依赖 §2 字符串与 §3.5 内部接口约定 | Grok 4.7 | 异步与幂等细节多 |
| S3 | 弹窗与列表、i18n；S3b 侧栏分组与会话列表页 | S1 | Grok 4.7 | 前端结构改造，视觉要求明确；S3 与 S3b 都改 messages，由同一个实施者连着做 |
| S4 | e2e 工程与用例 | S1–S3 | Grok 4.7 | 需要对照外部框架文档调试 |

S1 与 S2 并行；S3 在 S1 完成后开始；S4 最后。
