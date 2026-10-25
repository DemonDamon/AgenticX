# MA-E10 托管会话按智能体计量与「用户 × 智能体」token 配额

> **主规划裁决（2026-10-25，优先于正文）**：配额周期不再固定 UTC：新增环境变量 `MA_QUOTA_TIMEZONE`（IANA 名，默认 `Asia/Shanghai`，非法值启动失败），日 / 周（周一为首日）/ 月边界按该时区计算后再转成 UTC 时间戳查询 `ma_session_usage`；管理台展示的周期起止也按该时区。正文中「UTC 对齐」处按此改写，并补测试：`Asia/Shanghai` 下 2026-10-25T16:30Z 属于 10-26 当日周期。

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W5 · MA-E10）
Depends-on:
- MA-E01（**已实现**：`ma_session_usage` 表，`enterprise/packages/db-schema/src/schema/ma-sessions.ts:84-107`）
- MA-E03（**已实现**：agent-runtime 每条 `span.model_request_end` 写一行 `ma_session_usage`，`pg_event_store.py:295-319`；`GatewayLLMFactory`；`build_app`）
- MA-E04（**已实现**：门户 `budget_exceeded` 专属文案 `maNotices.budgetExceeded`，`web-portal/src/lib/collab-room/ma-agent-reply.ts:19-26`）
- MA-E08 / E09（**未实现**，占用迁移 `0065/0039`、`0066/0040`；本文用 `0067/0041`，**以实际实现为准，实施前核对**）

> 风险等级：高（会拦截模型调用；改动框架事件适配器的停止原因判定）。合入前建议强推理档只读审查 §5.3 与 §5.6。
> **栈**：Python（`agenticx/managed` 小改 + agent-runtime）+ TS（db-schema / iam-core / feature-metering / admin-console）。**Go 网关零改动**——与 master §9 表中「TS + Go（只读接线）」不同，原因见 D1，**须在 master §12 登记**。
>
> **实施前必须核对**：迁移末项（本文 **PG `0067_ma_agent_quotas` / MySQL `0041_ma_agent_quotas`**）；`schema-parity.test.ts` 表数（E09 后 92，本文 +1 → 93）。

---

## 0. 一句话目标

管理员在管理台「智能体用量」页按 智能体 × 用户 × 部门 × 模型 × 日 查看托管会话的 token 消耗（数据来自 `ma_session_usage`），并为某个智能体设置缺省或按用户覆盖的日 / 周 / 月 token 上限；agent-runtime 在**每次云端模型请求前**与**每轮开始时**检查「会话发起人 × 智能体」的已用量，超限即以 `stop_reason=budget_exceeded`（`session.error.type=budget_exceeded`，`retry_status=terminal`）结束本轮。门户、IM 渠道已有与合规拦截不同的「用量已达上限」文案。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §6.1 | `stop_reason` 新增 `budget_exceeded`，把 token 预算映射成明确停止原因 | §5.3、§5.6 |
| §7 W5 门 | 「把某用户在某 Agent 上的月度 token 配额调小后，下一次会话以 `budget_exceeded` 停止，门户提示与合规拦截可区分」 | FR-6、FR-7、§8 |
| §9 MA-E10 | `ma_session_usage` 汇入 metering 四维查询，新增 Agent 维度；用户 × Agent 日 / 周 / 月 token 配额；网关只增加读取 Agent 维度配额快照，**不改策略引擎** | D1、D2 |
| §12 第 6 行 | `max_tool_rounds` 是软上限，硬性成本上限由 MA-E10 的 token 配额承担 | 本文 |
| §12「托管会话在网关按服务 PAT 计量」行 | 用户 / 部门级网关配额在 MA-E10 前管不到托管会话 | 本文在 agent-runtime 内补上用户 × 智能体维度 |
| AGENTS.md | 网关配额当前以租户级为主；客户文档不得承诺未实现的部门 / 用户级配额 | 本文只实现「用户 × 智能体」托管会话配额；§10 写明边界 |

### 1.2 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `enterprise/packages/db-schema/src/schema/ma-sessions.ts` | 84–107 | `ma_session_usage(id, tenant_id, session_id, agent_id, agent_version, user_id, model, input_tokens, output_tokens, cache_read_input_tokens, tool_calls, runtime_ms, is_error, event_seq, created_at)`；索引 `(tenant_id, agent_id, created_at)`、`(tenant_id, user_id, created_at)` | 配额求和需新复合索引 `(tenant_id, agent_id, user_id, created_at)` |
| `enterprise/apps/agent-runtime/ma_agent_runtime/pg_event_store.py` | 250–319 | `append_events` 对 `span.model_request_end` 写 usage 行：`user_id = ma_sessions.created_by_user_id`，token 取 `payload.model_usage` | 云端执行与 Worker ingest（同一 `append_events`）都会落用量；`user_id` 是**会话发起人** |
| `enterprise/apps/gateway/internal/quota/tracker.go` | 42–51、150–167、451–461 | 网关 `Config.Agents map[string]Rule`：按请求头 `X-Agenticx-Agent-Id` 的**智能体整体**月度配额（不分用户），与用户 / 角色规则二选一 | 已对托管云端调用生效（`gateway_llm.py:28` 发该头）；本文不改，见 D1 |
| `enterprise/apps/gateway/internal/server/server.go` | 1504–1517 | 网关以 PAT 属主为身份；托管云端调用属主是服务 PAT | 网关无法按「会话发起人」计 → 用户 × 智能体配额必须在 agent-runtime 做 |
| `agenticx/managed/gateway_llm.py` | 100–117 | `GatewayLLMFactory.create(provider, model, context)`；`LLMCallContext(tenant_id, session_id, agent_id, agent_version, user_id)`（`llm.py:16-21`） | 每次请求前的检查包在工厂外层（§5.2），`context.user_id` 即会话发起人 |
| `agenticx/runtime/agent_runtime.py` | 5145–5194、5444、5482 | 运行时只调用 LLM 的同步 `stream_with_tools` / `invoke`（在线程里），`stream_with_tools` 抛错后回退 `invoke`；第 4695–4697 行读 `self.llm.model` 与 `type(self.llm).__name__` | 包装对象须透传 `model` 等属性；检查函数会在工作线程里被调用（可同步访问数据库） |
| `agenticx/managed/events/adapter.py` | 27–29、144、163、270–315、431–461 | `POLICY_BLOCK_RE`；`_policy_blocked` 标志；`finish_turn(error)` 与 `_on_error` 两处识别合规拦截；停止优先级 interrupted → max_tool_rounds → policy_blocked → retries_exhausted；暂存错误 `policy_blocked` 时 `retry="terminal"`（第 285 行） | 按同一模式追加 `budget_exceeded` 识别（§5.3） |
| `agenticx/managed/host/service.py` | 72–77 | `register_executor_factory(env, factory)`、`supports_environment`；`_factories` 私有 | 追加只读 `executor_factory(env)` 以便外层包装（§5.4） |
| `agenticx/managed/host/actor.py` | 221–229、309–322 | `begin_turn_locked()`、`finish_turn_locked(outcome)`；`LocalTurnExecutor._start_locked` 先 `begin_turn_locked` 再 `mark_processed` | 轮次准入拒绝时照此顺序收尾（§5.5） |
| `agenticx/managed/host/remote_executor.py` | 29–39 | 桌面执行器 `submit_message` 只建 Work Item | 桌面会话只能在轮次准入时拦（每次模型请求在员工机器上发生） |
| `enterprise/apps/agent-runtime/ma_agent_runtime/app.py` | 66–71、81–87、111–112 | `GatewayLLMFactory(...)`；`create_ma_app(...)`；`wire_worker_plane` | §5.6 接线位置 |
| `enterprise/features/metering/src/services/metering.ts` | 81–99；`sql/postgresql.ts` 3–22 | `MeteringService` 构造：`resolveDatabaseConfig` → `createPostgresqlExecutor` / `createMysqlExecutor` + `postgresqlMeteringSql` / `mysqlMeteringSql`；`SqlExecutor.query(statement, params) -> {rows,rowCount}` | 新服务照抄构造（§5.8） |
| `enterprise/features/metering/src/types.ts` | 1 | `MeteringGroupKey = "dept"\|"user"\|"provider"\|"model"\|"day"\|"pat"`，查询 `usage_records`（网关写入） | **不**往该联合类型加 `agent`（D2） |
| `enterprise/apps/admin-console/src/lib/metering-service.ts` | 1–40 | 真 wrapper；`resolveTenantId()` 读 `DEFAULT_TENANT_ID` | 追加 2 个导出函数 |
| `enterprise/apps/admin-console/src/app/api/metering/query/route.ts` | 1–30 | `requireAdminScope(["metering:read"])`、`toArray` 解析 | 新路由照抄 |
| `enterprise/apps/admin-console/src/components/AppShell.tsx` | 104–110 | ops 分组含 `/metering`、`/metering/quota`、`/metering/plans`、`/metering/split` | 在 `/metering/split` 后加「智能体用量」 |
| `enterprise/apps/web-portal/src/lib/collab-room/ma-agent-reply.ts` | 19–26 | `policyBlocked`：「…的请求触发合规拦截」；`budgetExceeded`：「…本次用量已达上限，请联系管理员」 | 门户无需改；FR-11 只做回归断言 |

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **不改 Go 网关**。用户 × 智能体配额只在 agent-runtime 执行：云端会话每次模型请求前检查，所有会话（含桌面执行）每轮开始前检查。网关现有的「智能体整体月度配额」（`quotas.json` 的 `agents`）继续按原样作用于托管云端调用，与本文独立 | 网关看到的是服务 PAT / 设备 PAT 的属主，不是会话发起人；在网关读「发起人 × 智能体」快照需要在请求头里传可信的发起人身份并改配额判定——属于策略/配额引擎改动，master 明确不做 |
| D2 | **计量的智能体维度单独成视图**：新服务 `AgentUsageService` 只查 `ma_session_usage`（可按 智能体 / 用户 / 部门 / 模型 / 日 分组），**不**与 `usage_records` 合并、**不**往 `MeteringGroupKey` 加 `agent` | 网关已为同一次托管云端调用写了 `usage_records`（属主为服务 PAT），合并会重复计数；分开展示口径清晰 |
| D3 | **计数口径**：token = `input_tokens + output_tokens`（不另加 `cache_read_input_tokens`，它是输入的一部分）。用户维度 = `ma_session_usage.user_id`（会话发起人：门户为代表的员工、定时任务为执行身份、IM 渠道为渠道属主、桌面房间任务为发起 @ 的员工） | 与 `Usage` 语义一致；配额按「谁发起」计 |
| D4 | **周期按 UTC 对齐**：日 = 当天 00:00Z 起；周 = 本周一 00:00Z 起（ISO 周）；月 = 当月 1 日 00:00Z 起。管理台页面标注「按 UTC 统计」 | 与网关月度配额（`time.Now().UTC()`，`tracker.go:155`）一致；避免运行时与管理台各自解释时区 |
| D5 | **规则选择**：同一智能体可有一条「缺省」规则（`subject_key='default'`，对所有用户）与任意条「用户」规则（`subject_key='user:<user_id>'`）；某用户有用户规则时**整条替换**缺省规则（不取较小值）。三个上限中 0 表示不限；三个都为 0 的规则不允许保存 | 简单可预期；需要「更严格」时直接给该用户设用户规则 |
| D6 | **检查是「已用 ≥ 上限」**：请求前不预估本次 token；某次请求可能让用量越过上限一次，下一次请求 / 下一轮即被拦 | 不需要 token 预估；超额幅度 ≤ 单次请求 |
| D7 | **控制面不可用时放行**：规则读取失败 → 沿用最近一次成功结果（最长 10 分钟），没有则放行并 `logger.warning`（每 (租户, 智能体) 每分钟最多 1 条）；用量 SQL 失败同样放行 | 配额是成本控制，不应因管理台短暂不可用中断业务 |
| D8 | **拦截以异常标记传达**：检查函数抛 `BudgetExceededError`，消息以 `agx_budget_exceeded:` 开头；适配器用 `BUDGET_EXCEEDED_RE` 在 `finish_turn(error)` 与 `_on_error` 两处识别（与合规拦截同模式），停止原因 `budget_exceeded`，`session.error.retry_status=terminal` | 不改 `AgentRuntime`；运行时把 LLM 异常转成错误事件或抛出，两条路径都能识别 |
| D9 | **轮次准入**：外层执行器 `BudgetAdmissionExecutor` 包住 `cloud` 与 `desktop_worker` 两种执行器；会话 `idle` 时收到 `user.message` 先检查，超限则直接 `begin_turn_locked` → 标记消息已处理 → `finish_turn_locked(budget_exceeded)`，不进入内层执行器（桌面不建 Work Item） | 桌面会话的模型请求不经 agent-runtime，只能在轮次开始时拦；云端也因此不必建 runtime 就能快速拒绝 |
| D10 | **规则读取经内部接口**：agent-runtime 调 `GET /api/internal/ma/agent-quotas/effective`（`MA_INTERNAL_TOKEN`），按 (租户, 智能体, 用户) 缓存 30 秒；用量直接查 `ma_session_usage`（agent-runtime 自己写的表） | master §2.3：控制面表经接口读 |
| D11 | **开关** `MA_RUNTIME_AGENT_QUOTA_ENABLED`，缺省 `0`（关闭时既不包工厂也不包执行器，行为与改动前一致） | 回滚 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

**框架（Python，`agenticx/managed`）**
- 新建 `agenticx/managed/budget.py`
- 修改 `agenticx/managed/events/adapter.py`（§5.3 列出的 6 处，其他行不动）
- 修改 `agenticx/managed/host/service.py`（追加 `executor_factory` 方法 3 行）
- 新建 `tests/managed/test_budget_guard.py`；修改 `tests/managed/test_event_adapter.py`（只追加用例）

**agent-runtime（Python）**
- 新建 `enterprise/apps/agent-runtime/ma_agent_runtime/quota.py`
- 修改 `ma_agent_runtime/config.py`（`Settings` 追加 3 字段）
- 修改 `ma_agent_runtime/app.py`（§5.6）
- 修改 `enterprise/apps/agent-runtime/README.md`
- 新建 `tests/test_quota.py`

**db-schema（TS）**
- 新建 `drizzle/0067_ma_agent_quotas.sql`、`drizzle-mysql/0041_ma_agent_quotas.sql`；修改两个 journal
- 新建 `src/schema/ma-agent-quotas.ts`、`src/mysql-schema/ma-agent-quotas.ts`；修改两个 `index.ts`
- 修改 `src/schema/ma-sessions.ts`、`src/mysql-schema/ma-sessions.ts`（`ma_session_usage` 追加 1 个索引声明）
- 修改 `src/__tests__/migration-inventory.test.ts`、`schema-parity.test.ts`、`ma-schema.test.ts`
- 修改 `enterprise/apps/agent-runtime/tests/test_tables_parity.py`（若其索引比对覆盖 `ma_session_usage`，同步新索引；否则不改）

**iam-core（TS）**
- 新建 `enterprise/packages/iam-core/src/repos/ma-agent-quotas.ts`、`src/repos/mysql/ma-agent-quotas.ts`；修改 `src/index.ts`
- 新建 `src/repos/__tests__/ma-agent-quotas.test.ts`

**feature-metering（TS）**
- 新建 `enterprise/features/metering/src/services/agent-usage.ts`；修改 `src/index.ts`（1 行 export）、`src/types.ts`（追加 `AgentUsage*` 类型，不改现有类型）
- 新建 `enterprise/features/metering/tests/agent-usage.test.ts`

**admin-console（TS）**
- 修改 `src/lib/metering-service.ts`（追加 2 个导出函数，不改现有）
- 新建 `src/app/api/metering/agents/usage/route.ts`、`src/app/api/metering/agents/quotas/route.ts`、`src/app/api/metering/agents/quotas/[quotaId]/route.ts`
- 新建 `src/app/api/internal/ma/agent-quotas/effective/route.ts`
- 新建页面 `src/app/metering/agents/page.tsx`
- 修改 `src/components/AppShell.tsx`（ops 分组 1 项）、`messages/zh.json`、`messages/en.json`
- 新建测试 `src/app/api/metering/agents/__tests__/routes.test.ts`、`src/app/api/internal/ma/__tests__/agent-quota-internal-route.test.ts`

### 3.2 Out of scope

- `enterprise/apps/gateway/**`（零改动，D1）；`/metering` 现有四维页面与 `usage_records` 查询（零改动）；`/metering/quota` 现有 token 配额页与 `enterprise_runtime_token_quotas`。
- web-portal（`budget_exceeded` 文案已在 E04 存在）；Near；桌面执行时的每次模型请求拦截。
- 部门 × 智能体配额、费用（USD）配额、请求数 / 并发配额、配额告警通知、成本单价换算。
- `AgentRuntime`（`agenticx/runtime/**`）任何改动。

---

## 4. 数据与协议

### 4.1 PG `0067_ma_agent_quotas.sql`（逐字）

```sql
-- 托管智能体「用户 × 智能体」token 配额。唯一写入方 admin-console；agent-runtime 经 /api/internal/ma/agent-quotas/effective 读取。
CREATE TABLE IF NOT EXISTS "ma_agent_quotas" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "subject_key" varchar(40) NOT NULL,
  "user_id" varchar(26),
  "daily_tokens" bigint DEFAULT 0 NOT NULL,
  "weekly_tokens" bigint DEFAULT 0 NOT NULL,
  "monthly_tokens" bigint DEFAULT 0 NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_agent_quotas_subject_uq" ON "ma_agent_quotas" ("tenant_id", "agent_id", "subject_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_session_usage_quota_idx" ON "ma_session_usage" ("tenant_id", "agent_id", "user_id", "created_at");
```

### 4.2 MySQL `0041_ma_agent_quotas.sql`（逐字）

```sql
-- 托管智能体「用户 × 智能体」token 配额（MySQL）。
CREATE TABLE IF NOT EXISTS `ma_agent_quotas` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `agent_id` varchar(26) NOT NULL,
  `subject_key` varchar(40) NOT NULL,
  `user_id` varchar(26),
  `daily_tokens` bigint NOT NULL DEFAULT 0,
  `weekly_tokens` bigint NOT NULL DEFAULT 0,
  `monthly_tokens` bigint NOT NULL DEFAULT 0,
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_agent_quotas_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_agent_quotas_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_agent_quotas_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_agent_quotas_subject_uq` (`tenant_id`, `agent_id`, `subject_key`)
);
--> statement-breakpoint
CREATE INDEX `ma_session_usage_quota_idx` ON `ma_session_usage` (`tenant_id`, `agent_id`, `user_id`, `created_at`);
```

Journal：PG `{"idx": 66, "version": "7", "when": 1788500000000, "tag": "0067_ma_agent_quotas", "breakpoints": true}`；MySQL `{"idx": 41, "version": "5", "when": 1788500000001, "tag": "0041_ma_agent_quotas", "breakpoints": true}`（`idx` 以实际末项 +1）。Drizzle：`ma-sessions.ts` 的 `maSessionUsage` 索引对象追加 `tenantAgentUserIdx: index("ma_session_usage_quota_idx").on(table.tenantId, table.agentId, table.userId, table.createdAt)`（两方言同名）。

### 4.3 规则记录与接口

**QuotaRule**（`toAgentQuotaRecord`，恰为下列键）：`{id, agent_id, subject: "default" | "user", user_id: string | null, daily_tokens, weekly_tokens, monthly_tokens, created_at, updated_at}`。

**管理台接口**（`{code:"00000",message:"ok",data}`；租户 = `DEFAULT_TENANT_ID`，同 `metering-service.ts`）：

| 方法 | 路径 | 权限 | 请求 | 响应 `data` |
|---|---|---|---|---|
| POST | `/api/metering/agents/usage` | `metering:read` | `{start?, end?, agent_id?: string[], user_id?: string[], group_by: ("agent"\|"user"\|"dept"\|"model"\|"day")[]}`（`start` 缺省 30 天前，`end` 缺省现在；`group_by` 1–3 项，去重，未知项 400） | `{rows: AgentUsageRow[]}` |
| GET | `/api/metering/agents/quotas?agent_id=` | `metering:read` | `agent_id` 必填 ULID | `{rules: QuotaRule[], usage: {"<user_id>": {day, week, month}}}`（`usage` 只含有用户规则的用户，按 D4 周期计算） |
| PUT | `/api/metering/agents/quotas` | `metering:manage` | `{agent_id, subject: "default" \| "user", user_id?: string, daily_tokens, weekly_tokens, monthly_tokens}`（`subject="user"` 时 `user_id` 必填且为本租户存在的用户；三个值为 0..1e12 整数且至少一个 > 0） | `{rule: QuotaRule}`（按 `(tenant, agent, subject_key)` upsert） |
| DELETE | `/api/metering/agents/quotas/:quotaId` | `metering:manage` | — | `{deleted: true}`；不存在 → 404 `{code:"40401",message:"quota rule not found"}` |

校验错误 → 400 `{code:"40001", message:"<field>: <reason>"}`（与 `/api/metering/*` 现有信封一致）。

**AgentUsageRow**：`{dims: {agent?: string, agent_name?: string | null, user?: string | null, dept?: string | null, model?: string, day?: string}, input_tokens, output_tokens, total_tokens, cache_read_input_tokens, requests, sessions}`（`day` 为 `YYYY-MM-DD`）。

**内部接口**：`GET /api/internal/ma/agent-quotas/effective?tenant_id=&agent_id=&user_id=`（`isMaInternalAuthorized`，`cache-control: no-store`）：

```json
{ "quota": { "source": "user", "rule_id": "01J…", "daily_tokens": 0, "weekly_tokens": 0, "monthly_tokens": 200000 } }
```

无规则 → `{"quota": null}`；`tenant_id` 不符 `TENANT_ID_RE` → 400；`agent_id` / `user_id` 不符 `ULID_RE` → 400。选择规则：有 `user:<user_id>` 行用它（`source="user"`），否则 `default` 行（`source="default"`），否则 null。

### 4.4 `session.error` 与停止原因

- 拦截消息（`BudgetExceededError.__str__`）：`agx_budget_exceeded: {period} token quota reached (used={used}, limit={limit})`，`period` ∈ `daily|weekly|monthly`（多个周期都超限时取第一个：daily → weekly → monthly）。
- 事件：`session.error{error:{type:"budget_exceeded", message:<上面整句，截断 500>, retry_status:{type:"terminal"}}}` 后跟 `session.status_idle{stop_reason:{type:"budget_exceeded"}}`（`session_error_event` 的实际 `retry_status` 形状以 `state_machine.py:118` 为准）。
- `budget_exceeded` 已在冻结枚举中（`protocol.py:37`），无需改协议；`session.error.type` 是开放字符串，本文新增取值 `budget_exceeded`（**须在 master §12 登记**）。

---

## 5. 精确落点

### 5.1 `agenticx/managed/budget.py`（新建）

```python
#!/usr/bin/env python3
"""Pre-request budget guard for managed sessions.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from typing import Any

from agenticx.managed.llm import LLMCallContext, LLMFactory

BUDGET_EXCEEDED_MARKER = "agx_budget_exceeded"
_GUARDED_METHODS = frozenset({"invoke", "stream", "stream_with_tools", "ainvoke"})

BudgetGuard = Callable[[LLMCallContext], None]


class BudgetExceededError(RuntimeError):
    """Raised by a budget guard. The message always starts with the marker."""

    def __init__(self, *, period: str, used: int, limit: int) -> None:
        self.period, self.used, self.limit = period, used, limit
        super().__init__(f"{BUDGET_EXCEEDED_MARKER}: {period} token quota reached (used={used}, limit={limit})")


class _GuardedLLM:
    """Proxy that runs the guard before each model request and delegates everything else."""

    def __init__(self, inner: Any, check: Callable[[], None]) -> None:
        object.__setattr__(self, "_inner", inner)
        object.__setattr__(self, "_check", check)

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._inner, name)          # AttributeError propagates (keeps getattr(..., None) probes working)
        if name not in _GUARDED_METHODS or not callable(attr):
            return attr
        if inspect.iscoroutinefunction(attr):
            async def guarded_async(*args: Any, **kwargs: Any) -> Any:
                await asyncio.to_thread(self._check)
                return await attr(*args, **kwargs)
            return guarded_async
        def guarded(*args: Any, **kwargs: Any) -> Any:
            self._check()
            return attr(*args, **kwargs)
        return guarded

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(self._inner, name, value)

    def __repr__(self) -> str:
        return f"Budgeted({self._inner!r})"


class BudgetGuardedLLMFactory:
    """LLMFactory wrapper. ``guard(context)`` raises BudgetExceededError to stop a request."""

    def __init__(self, inner: LLMFactory, guard: BudgetGuard) -> None: ...
    def create(self, *, provider: str, model: str, context: LLMCallContext) -> Any:
        llm = self._inner.create(provider=provider, model=model, context=context)
        return _GuardedLLM(llm, lambda: self._guard(context))
```

注意：`stream` / `stream_with_tools` 返回生成器，检查在**调用时**（取生成器之前）执行，满足「每次请求前」。`type(self.llm).__name__` 会变成 `_GuardedLLM`（`agent_runtime.py:4697` 只用于识别 MiniMax，托管模型名已带 provider，不受影响）。

### 5.2 不改 `gateway_llm.py`

外层包装在 agent-runtime `app.py` 完成（§5.6），框架 `GatewayLLMFactory` 不动。

### 5.3 `agenticx/managed/events/adapter.py`（6 处）

1. 第 29 行 `POLICY_BLOCK_RE` 之后追加：

```python
# Managed budget guard (agenticx.managed.budget). Kept as a string match so the
# adapter does not depend on how the runtime wraps provider exceptions.
BUDGET_EXCEEDED_RE = re.compile(r"agx_budget_exceeded")
```

2. `__init__`（第 144 行 `self._policy_blocked = False` 之后）追加 `self._budget_exceeded = False`。
3. `begin_turn`（第 163 行 `self._policy_blocked = False` 之后）追加 `self._budget_exceeded = False`。
4. `finish_turn` 错误分支（第 276–282 行）。Before：

```python
        if error is not None:
            error_text = f"{type(error).__name__}: {error}"[:500]
            if POLICY_BLOCK_RE.search(str(error)):
                self._policy_blocked = True
                events.append(session_error_event("policy_blocked", error_text, "terminal"))
            else:
                events.append(session_error_event("internal_error", error_text, "exhausted"))
        elif self._stashed_error is not None and not self._interrupted:
            stashed = self._stashed_error
            retry = "terminal" if stashed["type"] == "policy_blocked" else "exhausted"
```

After：

```python
        if error is not None:
            error_text = f"{type(error).__name__}: {error}"[:500]
            if POLICY_BLOCK_RE.search(str(error)):
                self._policy_blocked = True
                events.append(session_error_event("policy_blocked", error_text, "terminal"))
            elif BUDGET_EXCEEDED_RE.search(str(error)):
                self._budget_exceeded = True
                events.append(session_error_event("budget_exceeded", error_text, "terminal"))
            else:
                events.append(session_error_event("internal_error", error_text, "exhausted"))
        elif self._stashed_error is not None and not self._interrupted:
            stashed = self._stashed_error
            retry = "terminal" if stashed["type"] in ("policy_blocked", "budget_exceeded") else "exhausted"
```

5. 停止原因（第 293–294 行之后）插入：

```python
        elif self._budget_exceeded:
            stop_type = "budget_exceeded"
```

（位置：`elif self._policy_blocked:` 分支之后、`elif fatal:` 之前。）

6. `_on_error`（第 454–456 行）。Before：

```python
        if POLICY_BLOCK_RE.search(message):
            self._policy_blocked = True
            error_type = "policy_blocked"
```

After（追加一个 `elif`）：

```python
        if POLICY_BLOCK_RE.search(message):
            self._policy_blocked = True
            error_type = "policy_blocked"
        elif BUDGET_EXCEEDED_RE.search(message):
            self._budget_exceeded = True
            error_type = "budget_exceeded"
```

其余行一字不改。

### 5.4 `agenticx/managed/host/service.py`

在 `supports_environment`（第 76–77 行）之后追加：

```python
    def executor_factory(self, env_type: EnvironmentType) -> ExecutorFactory | None:
        """Return the registered factory for ``env_type`` (used to wrap it)."""
        return self._factories.get(env_type)
```

### 5.5 agent-runtime `ma_agent_runtime/quota.py`（新建）

```python
#!/usr/bin/env python3
"""User x agent token quotas for managed sessions.

Author: Damon Li
"""

PERIODS = ("daily", "weekly", "monthly")

@dataclass(frozen=True)
class QuotaRule:
    source: Literal["user", "default"]; rule_id: str; daily_tokens: int; weekly_tokens: int; monthly_tokens: int

@dataclass(frozen=True)
class QuotaDecision:
    exceeded: bool; period: str | None = None; used: int = 0; limit: int = 0

def window_starts(now: datetime) -> dict[str, datetime]: ...
    # UTC: daily = now 00:00; weekly = Monday 00:00 of now's ISO week; monthly = day 1 00:00

class AgentQuotaEnforcer:
    """Synchronous on purpose: the runtime calls LLMs from worker threads."""
    def __init__(self, *, sync_engine: Engine, admin_url: str, internal_token: str, settings: Settings,
                 http: httpx.Client | None = None, clock: Callable[[], datetime] = utc_now,
                 monotonic: Callable[[], float] = time.monotonic) -> None: ...
    def rule_for(self, tenant_id: str, agent_id: str, user_id: str) -> QuotaRule | None: ...   # cache 30s; stale <= 600s on failure (D7)
    def usage(self, tenant_id: str, agent_id: str, user_id: str, now: datetime) -> dict[str, int]: ...  # one SQL, §5.5.1
    def check(self, tenant_id: str, agent_id: str, user_id: str | None) -> QuotaDecision: ...
    def guard(self, context: LLMCallContext) -> None: ...      # raise BudgetExceededError when check(...).exceeded
    def close(self) -> None: ...

class BudgetAdmissionExecutor:
    """Wraps a TurnExecutor; rejects a new turn when the quota is exhausted (D9)."""
    def __init__(self, inner: TurnExecutor, actor: SessionActor, enforcer: AgentQuotaEnforcer) -> None: ...
    async def submit_message(self, message: StoredEvent) -> None: ...   # called with actor.lock held
    async def on_resolved(self, resolutions) -> None: await self._inner.on_resolved(resolutions)
    async def interrupt(self, dropped_pending) -> None: await self._inner.interrupt(dropped_pending)
    async def close(self) -> None: await self._inner.close()

def wrap_executors_with_quota(service: SessionService, enforcer: AgentQuotaEnforcer) -> None: ...
```

#### 5.5.1 用量 SQL（`sqlalchemy.text`，PG）

```sql
SELECT
  COALESCE(SUM(CASE WHEN created_at >= :day   THEN input_tokens + output_tokens ELSE 0 END), 0) AS daily,
  COALESCE(SUM(CASE WHEN created_at >= :week  THEN input_tokens + output_tokens ELSE 0 END), 0) AS weekly,
  COALESCE(SUM(input_tokens + output_tokens), 0) AS monthly
FROM ma_session_usage
WHERE tenant_id = :tenant AND agent_id = :agent AND user_id = :user AND created_at >= :earliest
```

`:earliest = min(day, week, month)`（周一可能落在上月）；`monthly` 列因此要改为 `SUM(CASE WHEN created_at >= :month THEN ... END)`——实现时三列都写 `CASE`，`WHERE` 用 `:earliest`。

#### 5.5.2 `check`

```text
if user_id is None or not settings.agent_quota_enabled: return QuotaDecision(False)
rule = rule_for(...)            # None -> not exceeded
if rule is None: return QuotaDecision(False)
used = usage(...)               # exception -> log warning (rate-limited) -> QuotaDecision(False)
for period in PERIODS:
    limit = getattr(rule, f"{period}_tokens")
    if limit > 0 and used[period] >= limit: return QuotaDecision(True, period, used[period], limit)
return QuotaDecision(False)
```

`rule_for`：`GET {admin_url}/api/internal/ma/agent-quotas/effective?tenant_id=&agent_id=&user_id=`，`httpx.Client(timeout=5.0, trust_env=False, headers={"Authorization": f"Bearer {internal_token}"})`；200 → 解析 `quota`；其他状态 / 网络错误 → 用缓存（≤ 600 秒）或 None。缓存键 `f"{tenant}|{agent}|{user}"`，`null` 结果也缓存 30 秒。

#### 5.5.3 `BudgetAdmissionExecutor.submit_message`

```text
actor = self._actor
sm = actor.sm
if sm.status != "idle" or (sm.stop_reason is not None and sm.stop_reason.type == "requires_action"):
    return await self._inner.submit_message(message)          # a turn is running/parked; inner queues it
decision = await asyncio.to_thread(self._enforcer.check, actor.tenant_id, actor.record.agent_id, actor.record.created_by_user_id)
if not decision.exceeded:
    return await self._inner.submit_message(message)
err = BudgetExceededError(period=decision.period, used=decision.used, limit=decision.limit)
await actor.begin_turn_locked()
await actor.service.store.mark_processed(actor.tenant_id, actor.session_id, [message.id], utc_now_iso())
await actor.finish_turn_locked(TurnOutcome(
    stop_type="budget_exceeded",
    events=[session_error_event("budget_exceeded", str(err)[:500], "terminal")],
    usage=actor.record.usage,
))
```

（`session_error_event` 从 `agenticx.managed.events.state_machine` 导入；`TurnOutcome` 从 `agenticx.managed.events.adapter` 导入；`utc_now_iso` 从 `agenticx.managed.ids` 导入。状态机须允许 `idle → running → idle(budget_exceeded)`——`turn_finished` 接受冻结枚举中的任一停止类型，实施前读 `state_machine.py` 的 `turn_finished` 确认。）

`wrap_executors_with_quota`：

```python
for env_type in ("cloud", "desktop_worker"):
    inner_factory = service.executor_factory(env_type)
    if inner_factory is None:
        continue
    service.register_executor_factory(
        env_type,
        lambda actor, f=inner_factory: BudgetAdmissionExecutor(f(actor), actor, enforcer),
    )
```

### 5.6 `app.py` 接线（Before / After）

Before（第 66–71 行）：

```python
    llm_factory = GatewayLLMFactory(base_url=settings.gateway_url, token=settings.gateway_token, timeout_seconds=settings.llm_timeout_seconds)
```

After：

```python
    llm_factory: Any = GatewayLLMFactory(base_url=settings.gateway_url, token=settings.gateway_token, timeout_seconds=settings.llm_timeout_seconds)
    enforcer: AgentQuotaEnforcer | None = None
    if settings.agent_quota_enabled:
        enforcer = AgentQuotaEnforcer(sync_engine=sync_engine, admin_url=settings.admin_url,
                                      internal_token=settings.internal_token, settings=settings)
        llm_factory = BudgetGuardedLLMFactory(llm_factory, enforcer.guard)
```

并在 `build_app` 末尾 `return app` 之前（所有 `register_executor_factory` / `wire_worker_plane` 之后）追加：

```python
    if enforcer is not None:
        wrap_executors_with_quota(app.state.ma.service, enforcer)
        app.state.ma.shutdown_hooks.append(_async(enforcer.close))   # _async: tiny local wrapper returning a coroutine
```

（若 E08 / E09 在 `build_app` 末尾加了后台任务接线，本段放在它们之后、`return app` 之前。）

### 5.7 `config.py`（`Settings` 追加）

| 字段 | 环境变量 | 默认 | 解析 |
|---|---|---|---|
| `agent_quota_enabled: bool` | `MA_RUNTIME_AGENT_QUOTA_ENABLED` | False | `== "1"` |
| `agent_quota_cache_seconds: float` | `MA_RUNTIME_AGENT_QUOTA_CACHE_SECONDS` | 30.0 | 0–300，非法回退 |
| `agent_quota_stale_seconds: float` | `MA_RUNTIME_AGENT_QUOTA_STALE_SECONDS` | 600.0 | 0–3600，非法回退 |

### 5.8 feature-metering `src/services/agent-usage.ts`（新建）

```ts
export type AgentUsageGroupKey = "agent" | "user" | "dept" | "model" | "day";
export type AgentUsageQueryInput = { tenant_id: string; start: string; end: string; agent_id?: string[]; user_id?: string[]; group_by: AgentUsageGroupKey[] };
export type AgentUsageRow = { dims: Record<string, string | null>; input_tokens: number; output_tokens: number; total_tokens: number; cache_read_input_tokens: number; requests: number; sessions: number };
export type AgentQuotaWindowTotals = { day: number; week: number; month: number };

export class AgentUsageService {
  public constructor(opts?: { executor?: SqlExecutor; sql?: MeteringSqlBuilder; connectionString?: string });
  public async query(input: AgentUsageQueryInput): Promise<{ rows: AgentUsageRow[] }>;
  public async windowTotals(tenantId: string, agentId: string, userIds: string[], now?: Date): Promise<Record<string, AgentQuotaWindowTotals>>;
}
export function agentQuotaWindowStarts(now: Date): { day: Date; week: Date; month: Date };   // UTC, same rule as quota.py window_starts
```

`query` SQL（`u` = `ma_session_usage`，`usr` = `users`，`a` = `enterprise_agents`；占位符用 `this.sql.placeholder(i)`）：

```sql
SELECT <select dims>,
  SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens,
  SUM(u.input_tokens + u.output_tokens) AS total_tokens, SUM(u.cache_read_input_tokens) AS cache_read_input_tokens,
  COUNT(*) AS requests, COUNT(DISTINCT u.session_id) AS sessions
FROM ma_session_usage u
LEFT JOIN users usr ON usr.id = u.user_id
LEFT JOIN enterprise_agents a ON a.id = u.agent_id
WHERE u.tenant_id = $1 AND u.created_at >= $2 AND u.created_at <= $3 [AND u.agent_id IN (...)] [AND u.user_id IN (...)]
GROUP BY <group dims>
ORDER BY total_tokens DESC
LIMIT 1000
```

维度映射：`agent` → select `u.agent_id AS agent, a.display_name AS agent_name`，group `u.agent_id, a.display_name`；`user` → `u.user_id`；`dept` → `usr.dept_id`；`model` → `u.model`；`day` → `this.sql.dateBucket("day", "u.created_at")`（结果按 `MeteringService` 同样方式转 `YYYY-MM-DD`）。数值列一律 `Number(...)`（pg 返回 string）。失败返回 `{ rows: [] }` 并 `console.error`（与 `MeteringService` 风格一致）。

`windowTotals`：一条 SQL 按 `u.user_id` 分组，三列 `SUM(CASE WHEN u.created_at >= $x THEN u.input_tokens + u.output_tokens ELSE 0 END)`。

### 5.9 iam-core `src/repos/ma-agent-quotas.ts`（新建，照抄 `ma-environments.ts`）

```ts
export type MaAgentQuota = { id; tenantId; agentId; subject: "default" | "user"; userId: string | null; dailyTokens: number; weeklyTokens: number; monthlyTokens: number; createdBy: string | null; createdAt; updatedAt };
export class MaAgentQuotaValidationError / MaAgentQuotaNotFoundError extends Error {}
export function normalizeAgentQuotaInput(body: Record<string, unknown>): { agentId; subject; userId: string | null; dailyTokens; weeklyTokens; monthlyTokens };   // 纯函数
export async function listMaAgentQuotas(tenantId: string, agentId: string): Promise<MaAgentQuota[]>;
export async function upsertMaAgentQuota(tenantId: string, body: Record<string, unknown>, actorUserId: string): Promise<MaAgentQuota>;
export async function deleteMaAgentQuota(tenantId: string, id: string): Promise<void>;
export async function getEffectiveMaAgentQuota(tenantId: string, agentId: string, userId: string): Promise<MaAgentQuota | null>;
```

`subject_key`：`"default"` 或 `` `user:${userId}` ``。`upsert` 校验 `agentId` 存在（`getAgent`）与 `userId` 属于本租户（iam-core 现有用户查询函数，实施前 `rg -n "export async function getAdminUser" enterprise/packages/iam-core/src/repos/users.ts` 确认名称与签名）。bigint 列读取后 `Number(...)`。

### 5.10 管理台页面 `src/app/metering/agents/page.tsx`

- 顶部 Tabs：「用量」「配额」。
- 用量：日期范围（缺省近 30 天）、智能体多选、分组（多选，缺省「智能体」）；表格列 = 选中维度 + 输入 / 输出 / 合计 token、请求数、会话数；表头下方一行小字「按 UTC 统计，数据来自托管会话」——这是口径说明，不是长备注。
- 配额：先选智能体 → 显示「所有用户（缺省）」一行与用户覆盖列表；每行三个数值输入（日 / 周 / 月，0 = 不限）与保存按钮；用户行额外显示本日 / 本周 / 本月已用（来自 `usage`），已用 ≥ 上限时数字标红；「添加用户」用用户搜索下拉（复用 `/api/admin/users` 现有查询，参数以实际为准）；删除用主题化确认弹窗。保存成功 toast，失败保留输入并显示接口错误文本。
- `AppShell.tsx` ops 分组在 `/metering/split` 之后追加 `{ href: "/metering/agents", labelKey: "agentUsage", icon: Bot }`（`Bot` 已在文件内 import 用于 `/admin/agents`）；文案 zh `agentUsage: "智能体用量"`、en `"Agent Usage"`。

---

## 6. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 表与索引 | `ma-schema.test.ts`：`ma_agent_quotas` 列 PG / MySQL 一致；`schema-parity.test.ts` 表数 93（以实际 +1）；journal 末 tag `0067_ma_agent_quotas`；PG 与 MySQL 迁移文件都包含 `ma_session_usage_quota_idx` |
| FR-2 | 包装器只在请求时检查 | `tests/managed/test_budget_guard.py::test_guard_runs_before_invoke_and_stream`：假 LLM 有 `invoke`、`stream_with_tools`、`model="m"`；guard 计数器 → `llm.model == "m"`、`getattr(llm, "missing", None) is None`、调用 `invoke` 一次计数 1、调用 `stream_with_tools` 计数 2；guard 抛 `BudgetExceededError` 时 `invoke` 不触达假 LLM；`test_async_methods_are_guarded`：`ainvoke` 先跑 guard |
| FR-3 | 适配器识别 | `tests/managed/test_event_adapter.py::test_budget_exceeded_error_maps_stop_reason`：`finish_turn(error=BudgetExceededError(period="monthly", used=10, limit=5))` → `stop_type == "budget_exceeded"`，事件含 `session.error`，`error.type == "budget_exceeded"`，`retry_status` 为 terminal；`test_budget_exceeded_runtime_error_event`：喂 runtime `ERROR` 事件 `text="agx_budget_exceeded: daily token quota reached (used=1, limit=1)"` 后 `finish_turn()` → 同样结果；`test_policy_block_still_wins`：两种标记同时出现时 `stop_type == "policy_blocked"`；现有适配器用例全部不改仍通过 |
| FR-4 | 端到端（框架宿主，云端执行器） | `test_budget_guard.py::test_hosted_turn_stops_with_budget_exceeded`：`create_ma_app(build_dev_config(...), llm_factory=BudgetGuardedLLMFactory(PerSessionScriptFactory([...]), guard=always_raise))`，`AGX_EFFECT_GUARD=0`，建会话发消息 → 最终 `session.status_idle.stop_reason.type == "budget_exceeded"`，整轮 < 10 秒（若运行时对该异常做了重试，断言仍成立；用时超限则在 PR 描述里记录重试次数） |
| FR-5 | 周期与求和 | `tests/test_quota.py::test_window_starts`：`2026-10-25T13:00Z`（周日）→ day `10-25 00:00`、week `10-19 00:00`、month `10-01 00:00`；`2026-11-01T05:00Z`（周日）→ week `10-26`；`test_usage_sums_by_window`（SQLite 库）：插入 3 行 usage（今天 100、本周早些 200、上月 999）→ `{"daily":100,"weekly":300,"monthly":300}`；不同 agent / user 的行不计入 |
| FR-6 | 规则选择与判定 | `test_check_uses_user_rule_over_default`：`FakeAdminConsole` 返回 `source="user"`、`monthly_tokens=250`，用量 300 → `exceeded`、`period=="monthly"`、`used==300`、`limit==250`；无规则 → 不超限；daily 与 monthly 同时超 → `period=="daily"`；`user_id=None` → 不超限且未请求控制面 |
| FR-7 | 轮次准入 | `test_admission_rejects_new_turn`：用 `build_app(Settings(..., agent_quota_enabled=True, allow_sqlite=True))` + `FakeAdminConsole`（规则 `monthly_tokens=1`）+ 预插 1 行用量 → `POST /events user.message` 后事件序列恰为 `[user.message, session.status_running, session.error(budget_exceeded), session.status_idle(budget_exceeded)]`，`FakeGateway` 未收到任何请求；该 `user.message` 的 `processed_at` 非空。`test_admission_passes_when_under_quota`：规则 `monthly_tokens=1000` → 正常 `end_turn`，网关收到请求。`test_admission_desktop_no_work_item`：`MA_RUNTIME_DESKTOP_WORKER_ENABLED=1` 的 desktop 环境会话超限 → `ma_work_items` 无新行 |
| FR-8 | 请求前拦截（轮中越限） | `test_guard_stops_mid_turn`：规则 `monthly_tokens=50`，`FakeGateway` 第一次响应带 `usage.total` 60 且要求调用一次工具，第二次请求前检查 → 第二次请求未到达网关；最终 `stop_reason.type == "budget_exceeded"` |
| FR-9 | 控制面不可用放行 | `test_control_plane_down_allows`：`FakeAdminConsole` 返回 500 且无缓存 → `check` 不超限；先成功取到规则再 500 → 在 600 秒内仍用旧规则判定；日志 warning 每分钟至多 1 条 |
| FR-10 | 开关关闭零影响 | `tests/test_app_e2e.py` 不改一行全绿；`test_flag_off_does_not_wrap`：`agent_quota_enabled=False` → `service.executor_factory("cloud") is LocalTurnExecutor`（未被包装），LLM 工厂类型为 `GatewayLLMFactory` |
| FR-11 | 门户文案可区分（回归） | 不改 web-portal；运行 `pnpm --filter @agenticx/app-web-portal test -- src/lib/collab-room/__tests__/ma-agent-reply.test.ts`，现有 `maps stop reasons without text to notices` 用例中 `budget_exceeded` 与 `policy_blocked` 文案不同 |
| FR-12 | 智能体用量查询 | `features/metering/tests/agent-usage.test.ts`（注入假 `SqlExecutor` 记录 SQL 与参数）：`group_by:["agent","day"]` → SQL 含 `FROM ma_session_usage u`、`a.display_name AS agent_name`、`GROUP BY` 含 `u.agent_id`；不含 `usage_records`；`agent_id:["A","B"]` → 参数含 A、B 且 SQL 含 `u.agent_id in (`；返回行数值为 number、`day` 为 `YYYY-MM-DD`；`agentQuotaWindowStarts` 与 FR-5 同一组时刻结果一致 |
| FR-13 | 管理台接口 | `routes.test.ts`：无 `metering:read` → 403；`group_by:["cost"]` → 400；PUT 三个值全 0 → 400 `{code:"40001"}`；PUT `subject:"user"` 无 `user_id` → 400；PUT 成功返回 `toAgentQuotaRecord` 键集合；同一 subject 再 PUT → 更新同一 `id`；DELETE 不存在 → 404 `40401`；写操作需 `metering:manage` |
| FR-14 | 内部接口 | `agent-quota-internal-route.test.ts`：错误 token 401；有用户规则 → `source:"user"`；只有缺省 → `source:"default"`；都无 → `{quota:null}`；`cache-control: no-store` |
| FR-15 | iam-core 校验 | `ma-agent-quotas.test.ts`：`daily_tokens: -1` → 报错；`1.5` → 报错；`1e13` → 报错；`subject:"dept"` → 报错 |
| NFR-1 | 框架改动面 | `git diff --name-only -- agenticx` 只含 `agenticx/managed/budget.py`、`agenticx/managed/events/adapter.py`、`agenticx/managed/host/service.py`；`python -m pytest tests/managed -q --no-cov` 全绿；`agenticx/runtime/**` 零改动 |
| NFR-2 | 网关零改动 | `git diff --name-only -- enterprise/apps/gateway` 为空 |
| NFR-3 | 性能 | `test_quota.py::test_usage_query_uses_index`（仅在设置 `MA_TEST_DATABASE_URL` 时运行，否则 skip）：PG 上 `EXPLAIN` 用量 SQL 含 `ma_session_usage_quota_idx` |
| NFR-4 | 类型 | 涉及 TS 包 `typecheck` 无错 |

---

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
AGX_EFFECT_GUARD=0 python -m pytest -o addopts="" -o asyncio_mode=auto tests/managed/test_budget_guard.py -q
python -m pytest tests/managed -q --no-cov
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q
cd enterprise
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/db-schema test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/iam-core test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/feature-metering test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/admin-console test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/app-web-portal test -- src/lib/collab-room/__tests__/ma-agent-reply.test.ts
pnpm --filter @agenticx/feature-metering typecheck && pnpm --filter @agenticx/admin-console typecheck && pnpm --filter @agenticx/admin-console build
git diff --name-only -- apps/gateway   # 期望为空
```

**W5 门演示（配额部分）：**

```bash
cd /Users/damon/myWork/AgenticX/enterprise
MA_RUNTIME_AGENT_QUOTA_ENABLED=1 bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream   # 门户 MA_RUNTIME_ENABLED='1'
# 1) 员工 A 在协作房间 @ 某 cloud Agent 两次，确认正常回复
# 2) 管理台 → 智能体用量 → 用量：按「智能体 + 用户」分组能看到 A 的 token
# 3) 配额：选该 Agent，添加用户 A，月上限填一个小于其本月已用量的数（如 1），保存
# 4) A 再 @ 一次（30 秒内规则缓存可能未刷新，等 30 秒）
# 期望：房间出现「智能体「X」本次用量已达上限，请联系管理员」（与「触发合规拦截」不同）；
#       观测台该会话 stop_reason=budget_exceeded，session.error.type=budget_exceeded；网关审计无该轮新请求
# 5) 删除该用户规则，30 秒后再 @ → 正常回复
```

---

## 8. 回滚

- `MA_RUNTIME_AGENT_QUOTA_ENABLED=0`（缺省）→ 不包工厂、不包执行器，agent-runtime 行为与改动前一致。
- 适配器新增分支只在出现 `agx_budget_exceeded` 字样时生效；开关关闭时不会产生该字样。
- 管理台：新页面 / 接口无人调用即无影响；迁移只新增表与索引。
- 代码：删除新建文件，`git checkout` 修改文件。

## 9. 不变量

1. Go 网关、`usage_records`、现有 `/metering` 与 `/metering/quota` 页面与接口行为不变。
2. `AgentRuntime` 与个人模式（`agx serve`、Near）零改动；`POLICY_BLOCK_RE` 及合规拦截判定不变，且优先级高于预算。
3. `ma_agent_quotas` 只由 admin-console 写；agent-runtime 只读其内部接口、只读 `ma_session_usage`。
4. 开关关闭时，适配器对任何现有输入的输出与改动前逐字一致（现有适配器测试不改即通过）。

## 10. 风险与待确认

1. **桌面执行只在轮次开始拦**（D9）：员工机器上一轮可能连续多次模型请求越过上限；硬上限需 Near 侧配合（后续子规划）。
2. **超额一次请求**（D6）：单轮单请求的输出可能让用量越过上限；对成本控制足够，对精确计费不够。
3. **UTC 周期**（D4）：中国时区用户的「今天」从上午 8 点开始计。Q1：是否改为可配置时区（需管理台与运行时同时读同一配置）。
4. **规则缓存 30 秒**：调小配额后最多 30 秒生效（W5 门演示已说明）。
5. **口径与网关不同**：网关 `usage_records` 把托管云端调用记在服务 PAT 名下；本页面按会话发起人计。两页数字按设计不一致，页面口径说明一行已写明。
6. **客户文档边界**：本文只提供「托管会话 · 用户 × 智能体」token 配额；不得据此宣称网关已支持部门 / 用户级通用配额（AGENTS.md）。

## 11. 需要在 master §12 登记的事项

- MA-E10 的栈改为「Python + TS」，**不改 Go 网关**（替代 master §9 表中「TS + Go（只读接线）」）；用户 × 智能体配额在 agent-runtime 执行（云端每次请求前 + 所有会话每轮开始前）。
- `session.error.type` 新增取值 `budget_exceeded`；拦截标记字符串 `agx_budget_exceeded`（框架 `agenticx/managed/budget.py`）。
- 框架小改：`agenticx/managed/events/adapter.py` 识别预算标记；`SessionService.executor_factory(env)` 只读访问器。
- 配额周期按 UTC 对齐；用户规则整条替换缺省规则；控制面不可用时放行（≤ 10 分钟沿用旧规则）。
- 计量的智能体维度单独成视图（只查 `ma_session_usage`），不与 `usage_records` 合并，避免重复计数。
