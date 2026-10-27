# MA-E08 定时任务与 Webhook（每次触发一个独立会话 · HMAC 签名推送）

> **主规划裁决（2026-10-25，优先于正文）**：Webhook 目标地址策略改为：**默认允许内网（RFC1918）地址与 `http://`**；始终拒绝回环（127.0.0.0/8、::1）、链路本地（169.254.0.0/16、fe80::/10）与云元数据地址，除非 `MA_WEBHOOK_ALLOW_LOOPBACK=1`（仅用于本机开发与 e2e）；`MA_WEBHOOK_BLOCK_PRIVATE=1` 时再额外拒绝内网地址与 `http://`。正文中「默认拦截内网」的描述与测试期望按此改写（新增测试：内网地址默认放行、回环默认拒绝、两个开关各自生效）。

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: .cursor/plans/2026-10-25-managed-agents-master.plan.md（W5 · MA-E08）
Depends-on:
- MA-E01 / E02 / E05 / E06（**已实现**：`ma_sessions`、`lib/ma/{errors,http,pat-auth,internal-auth,records}.ts`、`/api/ma/v1/*` 与 `/api/internal/ma/*` 写法、`MA_CONTROL_PLANE_ERROR_CODES`、`iam-core/src/ma-vault-crypto.ts` 的 `sealSecretPayload` / `openSecretPayload`）
- MA-E03（**已实现**：`enterprise/apps/agent-runtime`，`PgEventStore`、`AdminConsoleClient`、`Settings`、`build_app`）
- MA-E07 `.cursor/plans/pending/2026-10-25-ma-e07-memory-store-control-plane.plan.md`（**未实现**，占用迁移 PG `0064` / MySQL `0038`、`schema-parity` 表数 84、`admin-platform-sections` 可能追加 `agent-memory-stores`；**以实际实现为准，实施前核对**）
- MA-A06 / A07（**未实现**）：在它们合入前 agent-runtime 的 `SessionService.create_session` 对非空 `vault_ids` / `resources` 返回 400（`agenticx/managed/host/service.py:109-112`）。本文的定时任务**保存**这两个字段，但触发时若宿主不支持，该次运行记为 `failed`（`error` 为宿主返回的消息）
- 下游：MA-E09 复用本文的 `HookedPgEventStore`（§5.9）；MA-E10 的 `budget_exceeded` 会映射为 `session.failed` 通知

> 风险等级：中（新增出站 HTTP 与后台调度）。
> **栈**：TS（db-schema / iam-core / admin-console）+ Python（agent-runtime、`agenticx/managed/protocol.py` 的 scope 常量）。另有 nginx 一行正则（部署配置），**须在 master §12 登记**（§11）。
>
> **实施前必须核对**：
> 1. `ls enterprise/packages/db-schema/drizzle | tail -3`、`ls enterprise/packages/db-schema/drizzle-mysql | tail -3`：本文用 **PG `0065_ma_schedules_webhooks` / MySQL `0039_ma_schedules_webhooks`**，前提是 E07（0064 / 0038）已合入；未合入时按实际末项 +1 顺延并通知 E09 / E10，journal `idx` 必须连续。
> 2. `schema-parity.test.ts` 的 PG 表数（E07 后应为 84，本文 +4 → 88）；`migration-inventory.test.ts` 的 journal 条数与磁盘 `.sql` 数（各 +1）。
> 3. `rg -n "PAT_SCOPES" agenticx/managed/protocol.py enterprise/packages/core-api/src/managed-agents.ts`：当前 13 个 scope（§1.2）。

---

## 0. 一句话目标

管理员在管理台「定时任务」里为 Agent 配一条 cron（含时区）与输入模板，agent-runtime 按计划每次触发都新建一个 `source=schedule` 的独立会话并发送渲染后的 `user.message`，运行记录（含会话 id、结果）可在管理台查看并跳转观测台；管理员在「Webhook」里登记接收地址与订阅事件（`session.idle` / `session.failed` / `credential.expiring`），agent-runtime 在会话停下或凭证将过期时向其 POST 签名通知（`webhook-id` / `webhook-timestamp` / `webhook-signature: v1,<base64 HMAC-SHA256>`），失败按退避重试，投递记录可查。

---

## 1. 根因 / 动机与证据链

### 1.1 master 约束

| master 节 | 约束 | 落点 |
|---|---|---|
| §1.2 | Schedule：定时触发，每次触发创建独立 Session，留痕 | §5.8 调度器；`ma_schedule_runs` |
| §2.3 | `ma_schedules` 唯一写入方 admin-console；会话面数据唯一写入方 agent-runtime；agent-runtime 经 `/api/internal/ma/*` 读控制面 | D1、D2：`ma_schedules` / `ma_webhooks` 归管理台；`ma_schedule_runs` / `ma_webhook_deliveries` 归 agent-runtime；运行时经内部接口读配置 |
| §4 决策 4 | 控制面资源公共 API 在 admin-console `/api/ma/v1/*`；nginx 按前缀分流（`schedules` 已在正则内，`enterprise/deploy/nginx/gateway.conf:95`） | §5.5；nginx 追加 `webhooks` |
| §5.2 | Session `source` 含 `schedule` | `CreateSessionRequest(source="schedule")` |
| §7 W5 门 | 「一个定时任务每次触发生成独立会话，结果经 Webhook（HMAC 签名）推到测试接收端」 | §8 演示；`include_result_text` |
| §9 MA-E08 | 新表、agent-runtime 调度器按 cron 创建会话、Webhook 事件三种、HMAC-SHA256 签名与重试 | 全文 |
| §12「控制面扩展错误码」行 | 扩展码只放 admin-console `MA_CONTROL_PLANE_ERROR_CODES` | §4.6 |

### 1.2 现状代码证据（2026-10-25 核对，实施前重新核对行号）

| 文件 | 行 | 事实 | 影响 |
|---|---|---|---|
| `agenticx/managed/protocol.py` | 41 | `SessionSource = Literal["portal","desktop","api","schedule","channel","eval"]` | 无需改 |
| 同上 | 71–85 | `PAT_SCOPES` 13 项（`ma:agents:*`、`ma:environments:*`、`ma:sessions:*`、`ma:sessions:on_behalf`、`ma:worker`、`ma:vaults:*`、`ma:memory:*`、`ma:admin`） | 追加 4 项（D9） |
| 同上 | 432–438 | `parse_client_events(raw)` 要求 `{"events":[1..10]}` | 调度器发消息用该形状 |
| `enterprise/packages/core-api/src/managed-agents.ts` | 36–51 | TS 侧 `PAT_SCOPES`（与 Python 由 `tests/managed/test_fixture_parity.py:16,52` 比对） | 同步追加 |
| `enterprise/apps/admin-console/src/lib/ma/pat-scope-options.ts` | 2–16 | `MA_PAT_SCOPE_OPTIONS` 与 `PAT_SCOPES` 逐项一致（`__tests__/pat-scope-options.test.ts`） | 同步追加 |
| `agenticx/managed/host/service.py` | 107–154 | `create_session(principal, req)`：校验 Agent active、版本、环境、执行器；不写事件；`vault_ids`/`resources` 非空 → 400 | 调度器在进程内直接调用 |
| 同上 | 162–164 | `post_events(principal, session_id, raw)` → `actor.handle_client_batch` | 调度器 / 中断用 |
| `agenticx/managed/host/actor.py` | 177–219 | `handle_client_batch` **持有 `actor.lock`**；`finish_turn_locked`（225–229）在持锁时 `append` 终态事件 | §5.9 的终态监听器**不得**在 `append_events` 内 await 任何会话操作（否则死锁），一律 `asyncio.create_task` |
| `agenticx/managed/events/broadcast.py` | 140 起 | `EventLog.append` → `store.append_events` → 广播 | 子类化 store 能覆盖本机执行与 Worker ingest 两条写入路径 |
| `agenticx/managed/events/state_machine.py` | 118–124 | `session_error_event(error_type, message, retry)` | 不直接使用；终态判断读事件 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/pg_event_store.py` | 105–124、236–343 | `PgEventStore(async_engine)`；`append_events(tenant_id, session_id, events) -> list[StoredEvent]` | §5.9 子类覆盖 `append_events` |
| `enterprise/apps/agent-runtime/ma_agent_runtime/control_plane.py` | 102–182 | `AdminConsoleClient._read(method, url, allow_404, params, json)`；401 / 非 200 → `MAError(INTERNAL)` | 追加 3 个读取方法 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/config.py` | 92–222 | `Settings` frozen dataclass；`from_env` 用 `_raw` / `_float_ok` / `_int_ok` | 追加字段 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/app.py` | 81–113 | `create_ma_app(config, llm_factory, store=PgEventStore(async_engine), registry, authenticator)`；`app.state.ma.shutdown_hooks.append(...)`；`desktop_worker_enabled` 时 `wire_worker_plane` | §5.10 接线 |
| `enterprise/apps/agent-runtime/ma_agent_runtime/tables.py` | 1–124 | SQLAlchemy Core 表；`MANAGED_TABLES`；`tests/test_tables_parity.py` 逐列比对 drizzle DDL（`_WANTED`、读取 0061 / 0062） | 新增 2 张运行时表并扩展 parity |
| `enterprise/apps/agent-runtime/requirements.txt` | 1–6 | 无 cron 库、无 `tzdata` | 自写 cron（D5）；追加 `tzdata`（slim 镜像无系统时区库） |
| `enterprise/apps/admin-console/src/lib/ma/errors.ts` | 6–18、29–35、46 起 | `MA_CONTROL_PLANE_ERROR_CODES`、`statusFor` 穷举、`maErrorFromException` 按 `error.name` 映射 | 追加 4 码 |
| `enterprise/apps/admin-console/src/app/api/internal/ma/environments/[envId]/route.ts` | 1–27 | 内部接口样板（`isMaInternalAuthorized`、`noStore`） | 照抄 |
| `enterprise/apps/admin-console/src/app/api/ma/v1/agents/route.ts` | 1–123 | 公共接口样板（`requireMaPat`、`readJsonObject`、`assertOnlyKeys`、`maErrorFromException`） | 照抄 |
| `enterprise/apps/admin-console/src/app/api/admin/ma-vaults/route.ts`、`shared.ts` | 1–35；8–29 | 管理台接口样板：`requireAdminScope(["provider:read"])`、`requiredTenantId()`、`{code:"00000",message:"ok",data}` | 照抄；权限复用 `provider:*`（与 `/api/admin/agents` 一致） |
| `enterprise/packages/iam-core/src/ma-vault-crypto.ts` | 23、71、87 | `SealedSecret`、`sealSecretPayload(secrets)`、`openSecretPayload(sealed)`（主密钥 `MA_VAULT_MASTER_KEY`，缺失抛 `VaultCryptoUnavailableError`） | Webhook 签名密钥用它加密存储 |
| `enterprise/packages/iam-core/src/repos/ma-environments.ts` | 1–15、301–460 | repo 样板（`resolveDatabaseConfig`、`getIamDb`、mysql 分支文件） | 照抄 |
| `enterprise/apps/admin-console/src/lib/admin-platform-sections.ts`、`app/admin/[section]/page.tsx`、`components/AppShell.tsx` | 2–15；1–30；114–130 | 平台页注册三处；**注意 `/admin/channels` 已被网关上游渠道占用** | 本文用 slug `agent-schedules`、`agent-webhooks` |
| `enterprise/deploy/nginx/gateway.conf` | 95 | `location ~ ^/ma/v1/(agents\|environments\|vaults\|memory_stores\|schedules\|channels)(/\|$)` | 追加 `webhooks` |
| `desktop/electron/main.ts` | 1315–1360 | 桌面 `AutomationScheduler`：30 秒 tick、按分钟去重、启动时把运行中任务标「已中断」 | 语义参考：分钟粒度、错过不补跑（D6） |

### 1.3 调研语义（`research/managed-agents/`）

| 来源 | 语义 | 采纳 |
|---|---|---|
| `zhipu/deployments.md` L56–70 | 5 段 cron + 时区；每次触发以 initial events 启动新会话；Agent 字符串 id 固定当时版本 | 采纳 5 段 cron 与时区；版本策略二选一（D4） |
| `zhipu/deployments.md` L72–74 | 无人值守时 `always_ask` / 自定义工具会让会话停在 `requires_action` | 定时会话进入 `requires_action` 即中断并记 `failed`（D7） |
| `zhipu/deployments.md` L118–126 | 暂停 / 恢复以当前时间重算，暂停期间漏掉的不补跑；手动触发不影响后续计划 | D6 |
| `zhipu/webhooks.md` L55–61、L88–160 | Standard Webhooks：`webhook-id`、`webhook-timestamp`、`webhook-signature: v1,<base64>`，签名输入 `id.timestamp.body`，密钥 `whsec_` + base64 | §4.5 逐字采纳 |
| `zhipu/webhooks.md` L268–278 | 单次 15 秒超时、重试内容与事件 id 不变、每次重新签名、积压保护 | §4.5 |
| `bailian/managed-agents-webhook-notifications.md` L285–298 | 响应码语义：2xx 成功；3xx 不重试；408/425/429/5xx/网络错误重试；其他 4xx 终止 | §4.5 逐字采纳 |
| `workbuddy/使用说明.md` L198–209 | 自动化任务：每次执行独立 Session，列表展示最新一次 / 下一次执行时间 | 管理台列表列（§5.7） |

---

## 2. 关键设计决策（本子规划内定）

| # | 决策 | 理由 |
|---|---|---|
| D1 | **配置表归管理台、状态表归运行时**：`ma_schedules`、`ma_webhooks` 只由 admin-console 写；`ma_schedule_runs`、`ma_webhook_deliveries` 只由 agent-runtime 写。管理台只读后两张表用于展示 | master §2.3 单一写入方 |
| D2 | **`next_run_at` 不放在 `ma_schedules`**：运行时为每个启用的定时任务预先插入一行 `status='scheduled'` 的 `ma_schedule_runs`，它的 `scheduled_for` 就是「下一次执行时间」；管理台接口把它作为计算字段 `next_run_at` 返回 | 放在 `ma_schedules` 会出现两个写入方；放在运行时表还让多副本去重有天然的唯一键 |
| D3 | **调度器不选主**：每个 agent-runtime 副本都跑 tick；正确性由 `ma_schedule_runs` 唯一索引 `(schedule_id, trigger, scheduled_for)`（插入去重）+ `UPDATE ... WHERE status='scheduled'` 的 CAS（触发去重）保证。默认关闭，`MA_RUNTIME_SCHEDULER_ENABLED=1` 开启 | 不引入选主协议；同一时刻只有抢到 CAS 的副本建会话 |
| D4 | **版本策略** `version_policy`：`follow_routing`（缺省，触发时不传 `agent_version`，由 agent-runtime 取 Agent 当前生效版本——跟随 Agent 的「跟随最新 / 固定」路由）或 `pinned`（触发时传 `pinned_version`） | 与 Agent 版本路由（master §12 最后一行）一致，不另造第三种语义 |
| D5 | **cron 自己实现，TS 只校验、Python 负责计算**：5 段、不支持名称与 `L/W/#/?`；共享夹具 `tests/fixtures/managed_agents/cron_cases.json` 让两端对同一组表达式给出相同的合法性结论；Python 另对 `next_fire` 结果做断言。分钟字段展开后最多 12 个值（平均间隔 ≥ 5 分钟） | 不新增依赖；TS 不需要做时区计算（下一次时间由运行时写进 runs 表） |
| D6 | **错过不补跑**：触发时 `now - scheduled_for > misfire_grace_seconds`（缺省 300）→ 该次记 `skipped`（`skip_reason='missed'`），从 `now` 重新排下一次。同一定时任务上一轮仍 `firing` / `running` 时新一轮记 `skipped`（`overlap`）。配置修改（`revision` 变化）、停用、删除时，已排的 `scheduled` 行记 `skipped`（`revised` / `disabled` / `deleted`） | 与桌面 `AutomationScheduler` 及调研一致；避免宕机恢复后瞬间触发一串 |
| D7 | **无人值守收尾**：定时会话一旦出现 `session.status_idle(requires_action)`，运行时发 `user.interrupt` 并把运行记为 `failed`（`error='requires_action'`）；运行超过 `MA_RUNTIME_SCHEDULE_RUN_TIMEOUT_SECONDS`（缺省 3600）同样中断并记 `failed`（`timeout`） | 门户 / 管理台都没有审批入口；不让会话无限挂起 |
| D8 | **手动触发不跨写入方**：管理台「立即运行」只把 `ma_schedules.manual_run_requested_at` 写为当前时间；运行时 tick 发现它晚于最近一次 manual 运行的 `scheduled_for` 时插入一行 `trigger='manual'` 的运行（`scheduled_for = manual_run_requested_at`，唯一索引去重） | 运行时表仍只有运行时写；不需要管理台调用运行时 |
| D9 | **新增 4 个 PAT scope**：`ma:schedules:read`、`ma:schedules:write`、`ma:webhooks:read`、`ma:webhooks:write`（`ma:admin` 照旧放行全部） | 最小权限；与 vaults / memory 同构。**须在 master §12 登记** |
| D10 | **终态监听在存储层**：新建 `HookedPgEventStore(PgEventStore)` 覆盖 `append_events`，成功写入后若批内含 `session.status_idle` 或 `session.status_terminated`，用 `asyncio.create_task` 通知监听器（调度器收尾、Webhook 入队）。进程在「写入成功」与「入队」之间崩溃会丢一条通知（至多一次），文档写明 | 同时覆盖云端执行与 Worker ingest；不改框架；不在持锁路径 await |
| D11 | **Webhook 签名密钥**：创建 / 轮换时生成 32 随机字节，明文形如 `whsec_<base64>` 只在响应里出现一次；库里用 `sealSecretPayload({signing_secret})` 存三列；运行时经内部接口 `GET /api/internal/ma/webhooks` 拿明文（`MA_INTERNAL_TOKEN`，30 秒缓存，不落盘、不写日志） | 复用 E06 信封加密；主密钥只在管理台 |
| D12 | **投递目标限制**：只允许 `https://`；`MA_RUNTIME_WEBHOOK_ALLOW_HTTP=1` 才放开 `http://`（本地开发）。投递前解析 DNS，命中回环 / 私网 / 链路本地 / 保留地址时直接记 `failed`（`last_error='blocked_address'`），`MA_RUNTIME_WEBHOOK_ALLOW_PRIVATE_NETWORK=1` 才放开（私有化部署接收端在内网时由运维显式开启）。不跟随重定向 | SSRF 防护；私有化场景可显式放开 |
| D13 | **事件语义**：`session.idle` = `status_idle` 且 `stop_reason.type ∈ {end_turn, max_tool_rounds, requires_action}`；`session.failed` = `status_idle` 且 `stop_reason.type ∈ {retries_exhausted, refusal, budget_exceeded, policy_blocked}`，或 `session.status_terminated`；`credential.expiring` = 凭证 `expires_at` 在未来 72 小时内（运行时每小时向管理台查询一次） | 把冻结的 `stop_reason` 枚举完整划入两类；名称取 master §9 原文 |
| D14 | **结果文本可选**：Webhook 有开关 `include_result_text`（缺省关）；开启时 `data.result_text` = 该会话最后一条 `agent.message` 的文本块拼接，截断 4000 字符 | W5 门要「结果推到接收端」；缺省不外推内容 |

---

## 3. In scope / Out of scope

### 3.1 In scope（只能创建或修改这些文件）

**db-schema（TS）**
- 新建 `enterprise/packages/db-schema/drizzle/0065_ma_schedules_webhooks.sql`、`drizzle-mysql/0039_ma_schedules_webhooks.sql`
- 修改 `drizzle/meta/_journal.json`、`drizzle-mysql/meta/_journal.json`（各追加 1 条）
- 新建 `src/schema/ma-schedules.ts`、`src/schema/ma-webhooks.ts`、`src/mysql-schema/ma-schedules.ts`、`src/mysql-schema/ma-webhooks.ts`
- 修改 `src/schema/index.ts`、`src/mysql-schema/index.ts`（各追加 2 行 `export * from`，放在最后一个 `ma-*` 行之后）
- 修改 `src/__tests__/migration-inventory.test.ts`、`src/__tests__/schema-parity.test.ts`、`src/__tests__/ma-schema.test.ts`

**core-api / 协议（TS + Python 常量）**
- 修改 `enterprise/packages/core-api/src/managed-agents.ts`（`PAT_SCOPES` 在 `"ma:memory:write"` 与 `"ma:admin"` 之间插入 4 项，见 §9 第 4 条）
- 修改 `agenticx/managed/protocol.py`（`PAT_SCOPES` 同位置插入同样 4 项）
- 修改 `docs/managed-agents/protocol.md`（scope 表追加 4 行；Webhook 签名格式一节）
- 新建 `tests/fixtures/managed_agents/cron_cases.json`

**iam-core（TS）**
- 新建 `enterprise/packages/iam-core/src/repos/ma-cron.ts`（纯函数校验）
- 新建 `src/repos/ma-schedules.ts`、`src/repos/mysql/ma-schedules.ts`
- 新建 `src/repos/ma-webhooks.ts`、`src/repos/mysql/ma-webhooks.ts`
- 修改 `src/index.ts`（追加 3 行 export）
- 新建 `src/repos/__tests__/ma-cron.test.ts`、`src/repos/__tests__/ma-schedules-validate.test.ts`、`src/repos/__tests__/ma-webhooks-validate.test.ts`

**admin-console（TS）**
- 修改 `src/lib/ma/errors.ts`（4 码 + 异常映射）
- 修改 `src/lib/ma/pat-scope-options.ts`（追加 4 项）
- 新建 `src/lib/ma/schedule-records.ts`、`src/lib/ma/webhook-records.ts`
- 新建公共接口（相对 `src/app/api/ma/v1/`）：`schedules/route.ts`、`schedules/[scheduleId]/route.ts`、`schedules/[scheduleId]/run/route.ts`、`schedules/[scheduleId]/runs/route.ts`、`webhooks/route.ts`、`webhooks/[webhookId]/route.ts`、`webhooks/[webhookId]/rotate_secret/route.ts`、`webhooks/[webhookId]/deliveries/route.ts`
- 新建内部接口：`src/app/api/internal/ma/schedules/route.ts`、`src/app/api/internal/ma/webhooks/route.ts`、`src/app/api/internal/ma/credentials/expiring/route.ts`
- 新建管理台接口（相对 `src/app/api/admin/`）：`ma-schedules/route.ts`、`ma-schedules/shared.ts`、`ma-schedules/[scheduleId]/route.ts`、`ma-schedules/[scheduleId]/run/route.ts`、`ma-schedules/[scheduleId]/runs/route.ts`、`ma-webhooks/route.ts`、`ma-webhooks/[webhookId]/route.ts`、`ma-webhooks/[webhookId]/rotate-secret/route.ts`、`ma-webhooks/[webhookId]/deliveries/route.ts`
- 新建页面 `src/app/admin/_sections/agent-schedules.tsx`、`src/app/admin/_sections/agent-webhooks.tsx`
- 修改 `src/app/admin/[section]/page.tsx`、`src/lib/admin-platform-sections.ts`、`src/lib/__tests__/admin-platform-sections.test.ts`、`src/components/AppShell.tsx`
- 修改 `messages/zh.json`、`messages/en.json`（`nav.items.agentSchedules`、`nav.items.agentWebhooks`、`pages.admin.agentSchedules.*`、`pages.admin.agentWebhooks.*`）
- 新建测试：`src/app/api/ma/v1/__tests__/schedules-route.test.ts`、`src/app/api/ma/v1/__tests__/webhooks-route.test.ts`、`src/app/api/internal/ma/__tests__/schedule-webhook-internal-routes.test.ts`、`src/app/api/admin/ma-schedules/__tests__/route.test.ts`

**agent-runtime（Python）**
- 新建 `enterprise/apps/agent-runtime/ma_agent_runtime/cron.py`
- 新建 `ma_agent_runtime/session_hooks.py`
- 新建 `ma_agent_runtime/scheduler.py`
- 新建 `ma_agent_runtime/webhooks.py`
- 修改 `ma_agent_runtime/tables.py`（追加 2 表，`MANAGED_TABLES` 不变，新增 `AUTOMATION_TABLES`）
- 修改 `ma_agent_runtime/control_plane.py`（`AdminConsoleClient` 追加 3 个方法）
- 修改 `ma_agent_runtime/config.py`（`Settings` 追加 8 字段）
- 修改 `ma_agent_runtime/app.py`（§5.10 接线）
- 修改 `enterprise/apps/agent-runtime/requirements.txt`（追加 `tzdata>=2024.1`）
- 修改 `enterprise/apps/agent-runtime/README.md`（环境变量表追加）
- 新建测试：`tests/test_cron.py`、`tests/test_scheduler.py`、`tests/test_webhooks.py`、`tests/test_session_hooks.py`；修改 `tests/test_tables_parity.py`、`tests/fakes.py`（`FakeAdminConsole` 追加 3 个路由）

**部署**
- 修改 `enterprise/deploy/nginx/gateway.conf` 第 95 行正则（追加 `webhooks`，其余字符不动）

### 3.2 Out of scope

- `agenticx/managed/host/**`、`agenticx/managed/events/**`（框架会话面零改动）；`agenticx/studio/server.py`；Near；web-portal；Go 网关。
- Webhook 订阅 Agent / Environment / Vault 的增删改事件、`session.thread_*`、`deployment_run.*` 类事件（只做 master 列出的三种）。
- 投递历史重放、手动补发、测试投递按钮。
- 定时任务的图片 / 文件输入（`input_template` 只支持文本）。
- 定时任务的执行身份选择器（v1 固定为创建者，见 §4.2 `run_as_user_id`）。
- cron 名称（`MON`、`JAN`）、秒字段、`L/W/#/?`、`@daily` 等宏。

---

## 4. 数据与协议

### 4.1 PG `0065_ma_schedules_webhooks.sql`（逐字）

```sql
-- Managed Agents 定时任务与 Webhook。
-- ma_schedules / ma_webhooks：唯一写入方 admin-console（iam-core）。
-- ma_schedule_runs / ma_webhook_deliveries：唯一写入方 agent-runtime；admin-console 只读展示。
CREATE TABLE IF NOT EXISTS "ma_schedules" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "description" text,
  "agent_id" varchar(26) NOT NULL REFERENCES "enterprise_agents"("id") ON DELETE CASCADE,
  "version_policy" varchar(16) DEFAULT 'follow_routing' NOT NULL,
  "pinned_version" integer,
  "environment_id" varchar(26),
  "cron" varchar(120) NOT NULL,
  "timezone" varchar(64) DEFAULT 'Asia/Shanghai' NOT NULL,
  "input_template" text NOT NULL,
  "vault_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "run_as_user_id" varchar(26) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "misfire_grace_seconds" integer DEFAULT 300 NOT NULL,
  "manual_run_requested_at" timestamp with time zone,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_schedules_tenant_name_uq" ON "ma_schedules" ("tenant_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedules_tenant_agent_idx" ON "ma_schedules" ("tenant_id", "agent_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_schedule_runs" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "schedule_id" varchar(26) NOT NULL,
  "schedule_revision" integer NOT NULL,
  "trigger" varchar(16) NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" varchar(16) DEFAULT 'scheduled' NOT NULL,
  "skip_reason" varchar(32),
  "session_id" varchar(26),
  "agent_version" integer,
  "error" varchar(500),
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_schedule_runs_slot_uq" ON "ma_schedule_runs" ("schedule_id", "trigger", "scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedule_runs_due_idx" ON "ma_schedule_runs" ("status", "scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedule_runs_schedule_idx" ON "ma_schedule_runs" ("tenant_id", "schedule_id", "scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_schedule_runs_session_idx" ON "ma_schedule_runs" ("session_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_webhooks" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" varchar(120) NOT NULL,
  "url" varchar(2048) NOT NULL,
  "event_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "agent_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "include_result_text" boolean DEFAULT false NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "wrapped_dek" text NOT NULL,
  "kek_id" varchar(32) NOT NULL,
  "secret_rotated_at" timestamp with time zone,
  "created_by" varchar(26),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_webhooks_tenant_name_uq" ON "ma_webhooks" ("tenant_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ma_webhook_deliveries" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "tenant_id" varchar(26) NOT NULL,
  "webhook_id" varchar(26) NOT NULL,
  "event_id" varchar(26) NOT NULL,
  "event_type" varchar(32) NOT NULL,
  "event_key" varchar(160) NOT NULL,
  "payload" jsonb NOT NULL,
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone NOT NULL,
  "locked_until" timestamp with time zone,
  "last_status_code" integer,
  "last_error" varchar(500),
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ma_webhook_deliveries_event_uq" ON "ma_webhook_deliveries" ("webhook_id", "event_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_webhook_deliveries_due_idx" ON "ma_webhook_deliveries" ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ma_webhook_deliveries_webhook_idx" ON "ma_webhook_deliveries" ("tenant_id", "webhook_id", "created_at");
```

运行时表不加外键：定时任务 / Webhook 被删后历史仍可查，且管理台删除不会级联写运行时表。

### 4.2 MySQL `0039_ma_schedules_webhooks.sql`（逐字；约定同 `0037_ma_vaults.sql`）

```sql
-- Managed Agents 定时任务与 Webhook（MySQL）。agent-runtime 只支持 PostgreSQL，MySQL 侧仅保持 schema 对齐。
CREATE TABLE IF NOT EXISTS `ma_schedules` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(120) NOT NULL,
  `description` text,
  `agent_id` varchar(26) NOT NULL,
  `version_policy` varchar(16) NOT NULL DEFAULT 'follow_routing',
  `pinned_version` int,
  `environment_id` varchar(26),
  `cron` varchar(120) NOT NULL,
  `timezone` varchar(64) NOT NULL DEFAULT 'Asia/Shanghai',
  `input_template` text NOT NULL,
  `vault_ids` json NOT NULL DEFAULT (JSON_ARRAY()),
  `resources` json NOT NULL DEFAULT (JSON_ARRAY()),
  `run_as_user_id` varchar(26) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `revision` int NOT NULL DEFAULT 1,
  `misfire_grace_seconds` int NOT NULL DEFAULT 300,
  `manual_run_requested_at` datetime(6),
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_schedules_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_schedules_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  CONSTRAINT `ma_schedules_agent_fk` FOREIGN KEY (`agent_id`) REFERENCES `enterprise_agents` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_schedules_tenant_name_uq` (`tenant_id`, `name`),
  INDEX `ma_schedules_tenant_agent_idx` (`tenant_id`, `agent_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_schedule_runs` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `schedule_id` varchar(26) NOT NULL,
  `schedule_revision` int NOT NULL,
  `trigger` varchar(16) NOT NULL,
  `scheduled_for` datetime(6) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'scheduled',
  `skip_reason` varchar(32),
  `session_id` varchar(26),
  `agent_version` int,
  `error` varchar(500),
  `started_at` datetime(6),
  `finished_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_schedule_runs_id` PRIMARY KEY (`id`),
  UNIQUE INDEX `ma_schedule_runs_slot_uq` (`schedule_id`, `trigger`, `scheduled_for`),
  INDEX `ma_schedule_runs_due_idx` (`status`, `scheduled_for`),
  INDEX `ma_schedule_runs_schedule_idx` (`tenant_id`, `schedule_id`, `scheduled_for`),
  INDEX `ma_schedule_runs_session_idx` (`session_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_webhooks` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `name` varchar(120) NOT NULL,
  `url` varchar(2048) NOT NULL,
  `event_types` json NOT NULL DEFAULT (JSON_ARRAY()),
  `agent_ids` json NOT NULL DEFAULT (JSON_ARRAY()),
  `sources` json NOT NULL DEFAULT (JSON_ARRAY()),
  `include_result_text` boolean NOT NULL DEFAULT false,
  `enabled` boolean NOT NULL DEFAULT true,
  `secret_ciphertext` text NOT NULL,
  `wrapped_dek` text NOT NULL,
  `kek_id` varchar(32) NOT NULL,
  `secret_rotated_at` datetime(6),
  `created_by` varchar(26),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_webhooks_id` PRIMARY KEY (`id`),
  CONSTRAINT `ma_webhooks_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE,
  UNIQUE INDEX `ma_webhooks_tenant_name_uq` (`tenant_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ma_webhook_deliveries` (
  `id` varchar(26) NOT NULL,
  `tenant_id` varchar(26) NOT NULL,
  `webhook_id` varchar(26) NOT NULL,
  `event_id` varchar(26) NOT NULL,
  `event_type` varchar(32) NOT NULL,
  `event_key` varchar(160) NOT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT 0,
  `next_attempt_at` datetime(6) NOT NULL,
  `locked_until` datetime(6),
  `last_status_code` int,
  `last_error` varchar(500),
  `delivered_at` datetime(6),
  `created_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  `updated_at` datetime(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
  CONSTRAINT `ma_webhook_deliveries_id` PRIMARY KEY (`id`),
  UNIQUE INDEX `ma_webhook_deliveries_event_uq` (`webhook_id`, `event_key`),
  INDEX `ma_webhook_deliveries_due_idx` (`status`, `next_attempt_at`),
  INDEX `ma_webhook_deliveries_webhook_idx` (`tenant_id`, `webhook_id`, `created_at`)
);
```

Journal：PG `{"idx": 64, "version": "7", "when": 1788300000000, "tag": "0065_ma_schedules_webhooks", "breakpoints": true}`；MySQL `{"idx": 39, "version": "5", "when": 1788300000001, "tag": "0039_ma_schedules_webhooks", "breakpoints": true}`（`idx` 以实际末项 +1 为准）。Drizzle schema 文件按 `ma-vaults.ts` 的写法逐列映射（`ulid()`、`varchar`、`jsonb`/`json`、`boolean`、`timestamp(..., { withTimezone: true })`/`datetime(..., { fsp: 6 })`；`created_at`/`updated_at` 用 `auditColumns`）。

### 4.3 cron 语法（TS 与 Python 逐字一致）

```text
expr    := field SP field SP field SP field SP field     (exactly 5 fields, separated by one or more spaces)
field   := "*" | item ("," item)*
item    := "*/" step | range ("/" step)?
range   := num | num "-" num
num     := [0-9]{1,2}         step := [0-9]{1,2}, 1..59
order   := minute(0-59) hour(0-23) day_of_month(1-31) month(1-12) day_of_week(0-7, 0 and 7 = Sunday)
```

规则：
- `a-b` 要求 `a <= b`；值越界、空项、多余逗号、非数字字符 → 非法，错误文本 `cron: <field_name> is invalid`（`field_name` ∈ `minute/hour/day_of_month/month/day_of_week`）；字段数不为 5 → `cron: expected 5 fields`。
- 分钟字段展开后的集合大小 > 12 → `cron: minute field fires more than 12 times per hour`。
- 日与周：两字段都不是 `*` 时取**并集**（任一匹配即可）；否则取交集（标准 vixie cron 语义）。
- 时区：IANA 名称。TS 用 `new Intl.DateTimeFormat("en-US", { timeZone })` 不抛错即合法；Python 用 `zoneinfo.ZoneInfo(name)`。非法 → `timezone: unknown time zone`。

共享夹具 `tests/fixtures/managed_agents/cron_cases.json`：

```json
{
  "valid": ["0 9 * * 1-5", "*/15 * * * *", "5,35 8-18 * * *", "0 0 1 * *", "30 2 * * 0", "0 12 15 * 7", "0 9 1-7 * 1"],
  "invalid": [
    {"expr": "* * * * *", "error": "cron: minute field fires more than 12 times per hour"},
    {"expr": "*/2 * * * *", "error": "cron: minute field fires more than 12 times per hour"},
    {"expr": "0 9 * *", "error": "cron: expected 5 fields"},
    {"expr": "60 9 * * *", "error": "cron: minute is invalid"},
    {"expr": "0 24 * * *", "error": "cron: hour is invalid"},
    {"expr": "0 9 0 * *", "error": "cron: day_of_month is invalid"},
    {"expr": "0 9 * 13 *", "error": "cron: month is invalid"},
    {"expr": "0 9 * * 8", "error": "cron: day_of_week is invalid"},
    {"expr": "0 9 * * MON", "error": "cron: day_of_week is invalid"},
    {"expr": "0 9 5-1 * *", "error": "cron: day_of_month is invalid"},
    {"expr": "0 9 * * 1,", "error": "cron: day_of_week is invalid"}
  ],
  "next_fire": [
    {"expr": "0 9 * * 1-5", "tz": "Asia/Shanghai", "after": "2026-10-23T02:00:00Z", "expect": "2026-10-26T01:00:00Z"},
    {"expr": "*/15 * * * *", "tz": "UTC", "after": "2026-10-25T10:07:30Z", "expect": "2026-10-25T10:15:00Z"},
    {"expr": "0 9 1-7 * 1", "tz": "UTC", "after": "2026-10-25T00:00:00Z", "expect": "2026-10-26T09:00:00Z"},
    {"expr": "30 2 * * 0", "tz": "America/New_York", "after": "2026-03-07T00:00:00Z", "expect": "2026-03-08T07:30:00Z"},
    {"expr": "0 0 1 * *", "tz": "UTC", "after": "2026-12-01T00:00:00Z", "expect": "2027-01-01T00:00:00Z"}
  ]
}
```

（第 3 条 `next_fire`：日 1–7 与周一取并集，10-26 是周一；第 4 条：2026-03-08 美东 02:30 落在夏令时跳变缺口，按「缺口时间顺延到跳变后同一分钟值」规则得到 03:30 EDT = 07:30Z。实施者用 Python 先算一遍核对夹具，夹具与实现不一致时**修夹具前先在 PR 描述里说明**。）

### 4.4 资源 JSON（公共 / 管理台接口共用的记录形状）

**Schedule**（`toMaScheduleRecord`，恰为下列键）：

```json
{
  "id": "01J…", "tenant_id": "01J…", "name": "每日销售日报", "description": null,
  "agent_id": "01J…", "version_policy": "follow_routing", "pinned_version": null, "environment_id": null,
  "cron": "0 9 * * 1-5", "timezone": "Asia/Shanghai",
  "input_template": "生成 {{date}} 的销售日报",
  "vault_ids": [], "resources": [],
  "run_as_user_id": "01J…", "enabled": true, "revision": 3, "misfire_grace_seconds": 300,
  "next_run_at": "2026-10-26T01:00:00.000Z",
  "last_run": { "id": "01J…", "status": "succeeded", "scheduled_for": "…", "session_id": "01J…" },
  "created_at": "…", "updated_at": "…"
}
```

`next_run_at` = 该定时任务 `trigger='schedule' AND status='scheduled' AND schedule_revision = revision` 的 `scheduled_for`（无则 null）；`last_run` = 该任务 `status NOT IN ('scheduled')` 中 `scheduled_for` 最大的一行（无则 null）。

**ScheduleRun**：`{id, schedule_id, schedule_revision, trigger, scheduled_for, status, skip_reason, session_id, agent_version, error, started_at, finished_at, created_at}`。`status` ∈ `scheduled|firing|running|succeeded|failed|skipped`；`skip_reason` ∈ `missed|overlap|revised|disabled|deleted|null`。

**创建 / 更新 Schedule 请求体**（`assertOnlyKeys`）：`name`（1–120，租户内唯一）、`description?`（≤ 2000 或 null）、`agent_id`（ULID，须存在于本租户）、`version_policy?`（缺省 `follow_routing`）、`pinned_version?`（`version_policy=pinned` 时必填正整数，且该版本存在；`follow_routing` 时必须为 null 或省略）、`environment_id?`（ULID 或 null；非 null 时须存在且 `status=active`）、`cron`、`timezone?`（缺省 `Asia/Shanghai`）、`input_template`（1–16384 字节 UTF-8）、`vault_ids?`（ULID 数组，≤ 20，不重复）、`resources?`（≤ 8 项，形状同 master §12「会话 resources」行，只做结构校验）、`enabled?`（缺省 true）、`misfire_grace_seconds?`（60–86400）。`run_as_user_id` 不可提交：创建时 = 调用者 `userId`，之后不变。PATCH 任一配置字段变化 → `revision = revision + 1`（只改 `enabled` 也加 1，使已排的下一次被替换）。每租户 ≤ 100 条（超出 409 `schedule_limit`）。

**Webhook**（`toMaWebhookRecord`）：`{id, tenant_id, name, url, event_types, agent_ids, sources, include_result_text, enabled, secret_rotated_at, created_at, updated_at}`——**永不**含密钥或密文。创建与轮换响应额外带一次 `"signing_secret": "whsec_…"`。

**创建 / 更新 Webhook 请求体**：`name`（1–120，租户内唯一）、`url`（`new URL()` 可解析；协议 `https:`，或 `http:`（管理台不拦，由运行时按 D12 拦截并在投递记录显示原因）；不含用户名密码与 `#fragment`；≤ 2048）、`event_types`（非空子集 ⊆ `["session.idle","session.failed","credential.expiring"]`，去重）、`agent_ids?`（ULID 数组 ≤ 50；空 = 全部）、`sources?`（⊆ `SessionSource` 六值；空 = 全部）、`include_result_text?`（缺省 false）、`enabled?`（缺省 true）。每租户 ≤ 20 条（409 `webhook_limit`）。URL 创建后可改（与调研「不可改」不同：私有化场景接收端迁移频繁；改 URL 不轮换密钥）。

**WebhookDelivery**：`{id, webhook_id, event_id, event_type, status, attempts, next_attempt_at, last_status_code, last_error, delivered_at, created_at}`（不回 payload，避免在管理台二次暴露结果文本）。`status` ∈ `pending|sending|succeeded|failed|abandoned`。

### 4.5 Webhook 投递协议（agent-runtime → 接收端）

请求：`POST <url>`，头：

```text
content-type: application/json
user-agent: AgenticX-Webhooks/1
webhook-id: <event_id>                  # ULID, constant across retries
webhook-timestamp: <unix seconds>       # regenerated on each attempt
webhook-signature: v1,<base64(HMAC_SHA256(key, "<webhook-id>.<webhook-timestamp>.<raw body>"))>
```

`key = base64decode(signing_secret[len("whsec_"):])`（标准 base64，带填充）。body 为 `json.dumps(payload, ensure_ascii=False, separators=(",", ":"))` 的 UTF-8 字节，签名与发送用**同一份字节**。

payload：

```json
{
  "type": "event",
  "id": "<event_id>",
  "created_at": "<触发事件的 created_at（会话事件）或检测时间（凭证）ISO-8601>",
  "data": {
    "type": "session.idle",
    "tenant_id": "01J…",
    "session_id": "01J…",
    "agent_id": "01J…",
    "agent_version": 3,
    "source": "schedule",
    "stop_reason": { "type": "end_turn" },
    "schedule_id": "01J…",
    "schedule_run_id": "01J…",
    "result_text": "……"
  }
}
```

- `stop_reason` 只含 `type`（不含 `event_ids`）；`session.status_terminated` 触发的 `session.failed` 中 `stop_reason` 为 `{"type":"terminated"}`。
- `schedule_id` / `schedule_run_id`：`source=schedule` 时从 `ma_schedule_runs`（`session_id` 索引）查出，否则为 null。
- `result_text`：仅 `include_result_text=true` 时出现（D14）。
- `credential.expiring` 的 `data`：`{type, tenant_id, vault_id, credential_id, credential_type, display_name, expires_at}`。

投递规则（`webhooks.py::classify_response`）：

| 结果 | 处理 |
|---|---|
| 2xx | `succeeded`，`delivered_at=now` |
| 3xx | `failed`（不重试，`last_error='redirect'`），不跟随 |
| 408 / 425 / 429 / 5xx / 连接、DNS、读写超时 | `attempts += 1`；未达 `MA_RUNTIME_WEBHOOK_MAX_ATTEMPTS`（缺省 6）→ `pending`，`next_attempt_at = now + backoff(attempts)`；否则 `failed` |
| 其他 4xx | `failed`（不重试） |
| TLS 证书 / 主机名校验失败 | `failed`（`last_error='tls_error'`） |
| D12 地址拦截 | `failed`（`last_error='blocked_address'` 或 `'http_not_allowed'`） |
| 行创建超过 24 小时仍未成功 | `abandoned` |

`backoff(n)`：`[10, 30, 120, 600, 1800][min(n, 5) - 1]` 秒，乘以 `random.uniform(0.8, 1.2)`。单次请求超时 10 秒（`httpx.Timeout(10.0)`），`follow_redirects=False`，`trust_env=True`（企业出站代理）。`last_error` 一律截断 500 字符，且**不得**包含密钥、请求头或 body。

### 4.6 错误码（admin-console `MA_CONTROL_PLANE_ERROR_CODES` 追加，须在 master §12 登记）

| 码 | HTTP | 异常类名（iam-core） | 消息 |
|---|---|---|---|
| `schedule_not_found` | 404 | `MaScheduleNotFoundError` | `schedule not found` |
| `schedule_limit` | 409 | `MaScheduleLimitError` | `a tenant can hold at most 100 schedules` |
| `webhook_not_found` | 404 | `MaWebhookNotFoundError` | `webhook not found` |
| `webhook_limit` | 409 | `MaWebhookLimitError` | `a tenant can hold at most 20 webhooks` |

校验错误：`MaScheduleValidationError` / `MaWebhookValidationError` → `invalid_request`（消息即字段错误文本）；名称重复 → `MaScheduleNameConflictError` / `MaWebhookNameConflictError` → `invalid_request`（消息 `name already exists`，不新增码）；主密钥缺失 → 复用 `vault_crypto_unavailable` 503。

### 4.7 接口一览

**公共（`requireMaPat`；nginx `/ma/v1/<x>` → `/api/ma/v1/<x>`）**

| 方法 | 路径 | scope | 响应 |
|---|---|---|---|
| GET | `/api/ma/v1/schedules?agent_id=` | `ma:schedules:read` | `{data:[Schedule]}` |
| POST | `/api/ma/v1/schedules` | `ma:schedules:write` | 201 `{schedule}` |
| GET / PATCH / DELETE | `/api/ma/v1/schedules/:id` | read / write / write | `{schedule}` / `{schedule}` / `{deleted:true}` |
| POST | `/api/ma/v1/schedules/:id/run` | `ma:schedules:write` | 202 `{schedule}`（只写 `manual_run_requested_at`） |
| GET | `/api/ma/v1/schedules/:id/runs?limit=` | `ma:schedules:read` | `{data:[ScheduleRun]}`（`scheduled_for` 倒序，`limit` 1–200 缺省 50） |
| GET | `/api/ma/v1/webhooks` | `ma:webhooks:read` | `{data:[Webhook]}` |
| POST | `/api/ma/v1/webhooks` | `ma:webhooks:write` | 201 `{webhook, signing_secret}` |
| GET / PATCH / DELETE | `/api/ma/v1/webhooks/:id` | read / write / write | `{webhook}` / `{webhook}` / `{deleted:true}` |
| POST | `/api/ma/v1/webhooks/:id/rotate_secret` | `ma:webhooks:write` | `{webhook, signing_secret}` |
| GET | `/api/ma/v1/webhooks/:id/deliveries?limit=` | `ma:webhooks:read` | `{data:[WebhookDelivery]}` |

**内部（`isMaInternalAuthorized`；`cache-control: no-store`；跨租户）**

| 方法 | 路径 | 响应 |
|---|---|---|
| GET | `/api/internal/ma/schedules` | `{data:[{...Schedule 去掉 next_run_at/last_run, manual_run_requested_at}]}`：全部租户 `enabled=true` 的定时任务，另附 `disabled_ids: string[]`（全部租户 `enabled=false` 的 id，用于运行时把它们已排的下一次记为 skipped） |
| GET | `/api/internal/ma/webhooks` | `{data:[{id, tenant_id, url, event_types, agent_ids, sources, include_result_text, signing_secret}]}`：全部租户 `enabled=true`；解密失败的行跳过并 `console.error` 一行（不含密钥） |
| GET | `/api/internal/ma/credentials/expiring?within_hours=72` | `{data:[{tenant_id, vault_id, credential_id, credential_type, display_name, expires_at}]}`：`status='active'` 且 `expires_at` ∈ `(now, now + within_hours]`；`within_hours` 1–720 |

**管理台（`requireAdminScope`；`{code:"00000",message:"ok",data}`）**：`/api/admin/ma-schedules*` 与 `/api/admin/ma-webhooks*` 与公共接口一一对应（同一 iam-core 函数），读用 `provider:read`、写用 `provider:update`、删除用 `provider:delete`；轮换路径为 `rotate-secret`。

---

## 5. 精确落点

### 5.1 iam-core `src/repos/ma-cron.ts`（新建，纯函数）

```ts
export const CRON_FIELD_NAMES = ["minute", "hour", "day_of_month", "month", "day_of_week"] as const;
export class MaCronValidationError extends Error { name = "MaCronValidationError"; }
/** 解析并返回每个字段展开后的升序数值数组；day_of_week 中 7 归一为 0。非法抛 MaCronValidationError（§4.3 文本）。 */
export function parseCron(expr: string): { minute: number[]; hour: number[]; dayOfMonth: number[]; month: number[]; dayOfWeek: number[]; domRestricted: boolean; dowRestricted: boolean };
export function validateTimezone(tz: string): string; // 返回原值；非法抛 MaCronValidationError("timezone: unknown time zone")
```

### 5.2 iam-core `src/repos/ma-schedules.ts` / `ma-webhooks.ts`（新建，照抄 `ma-environments.ts` 的结构与 mysql 分支写法）

```ts
// ma-schedules.ts
export type MaSchedule = { id; tenantId; name; description: string | null; agentId; versionPolicy: "follow_routing" | "pinned"; pinnedVersion: number | null; environmentId: string | null; cron; timezone; inputTemplate; vaultIds: string[]; resources: Record<string, unknown>[]; runAsUserId; enabled: boolean; revision: number; misfireGraceSeconds: number; manualRunRequestedAt: string | null; createdBy: string | null; createdAt; updatedAt };
export type MaScheduleRun = { id; scheduleId; scheduleRevision; trigger: "schedule" | "manual"; scheduledFor; status; skipReason: string | null; sessionId: string | null; agentVersion: number | null; error: string | null; startedAt: string | null; finishedAt: string | null; createdAt };
export class MaScheduleValidationError extends Error {}   // name = "MaScheduleValidationError"（其余异常同理设置 name）
export class MaScheduleNotFoundError extends Error {}
export class MaScheduleNameConflictError extends Error {}
export class MaScheduleLimitError extends Error {}
export function normalizeScheduleInput(body: Record<string, unknown>, mode: "create" | "update"): NormalizedScheduleInput; // 纯函数，§4.4 规则；调用 parseCron / validateTimezone
export async function listMaSchedules(tenantId: string, filter?: { agentId?: string }): Promise<MaSchedule[]>;
export async function getMaSchedule(tenantId: string, id: string): Promise<MaSchedule>;            // 不存在抛 NotFound
export async function createMaSchedule(tenantId: string, body: Record<string, unknown>, actorUserId: string): Promise<MaSchedule>;
export async function updateMaSchedule(tenantId: string, id: string, body: Record<string, unknown>): Promise<MaSchedule>; // revision+1
export async function deleteMaSchedule(tenantId: string, id: string): Promise<void>;
export async function requestMaScheduleRun(tenantId: string, id: string): Promise<MaSchedule>;     // manual_run_requested_at = now
export async function listEnabledMaSchedulesForRuntime(): Promise<{ enabled: MaSchedule[]; disabledIds: string[] }>;
export async function listMaScheduleRuns(tenantId: string, scheduleId: string, limit: number): Promise<MaScheduleRun[]>;
export async function getMaScheduleRunSummary(tenantId: string, scheduleIds: string[]): Promise<Map<string, { nextRunAt: string | null; lastRun: MaScheduleRun | null }>>;
```

`createMaSchedule` / `updateMaSchedule` 额外校验：`agent_id` 经 `getAgent(tenantId, agentId)`（不存在 → `MaScheduleValidationError("agent_id: agent not found")`）；`pinned` 时经 `getAgentVersion` 校验版本存在（函数名以 iam-core 实际导出为准：`rg -n "export async function getAgentVersion" enterprise/packages/iam-core/src/repos/agent-versions.ts`）；`environment_id` 经 `getMaEnvironment`。

```ts
// ma-webhooks.ts
export const MA_WEBHOOK_EVENT_TYPES = ["session.idle", "session.failed", "credential.expiring"] as const;
export type MaWebhook = { id; tenantId; name; url; eventTypes: string[]; agentIds: string[]; sources: string[]; includeResultText: boolean; enabled: boolean; secretRotatedAt: string | null; createdBy: string | null; createdAt; updatedAt };
export class MaWebhookValidationError / MaWebhookNotFoundError / MaWebhookNameConflictError / MaWebhookLimitError extends Error {}
export function generateSigningSecret(): string; // "whsec_" + randomBytes(32).toString("base64")
export function normalizeWebhookInput(body: Record<string, unknown>, mode: "create" | "update"): NormalizedWebhookInput;
export async function listMaWebhooks(tenantId: string): Promise<MaWebhook[]>;
export async function getMaWebhook(tenantId: string, id: string): Promise<MaWebhook>;
export async function createMaWebhook(tenantId: string, body: Record<string, unknown>, actorUserId: string): Promise<{ webhook: MaWebhook; signingSecret: string }>;
export async function updateMaWebhook(tenantId: string, id: string, body: Record<string, unknown>): Promise<MaWebhook>;
export async function rotateMaWebhookSecret(tenantId: string, id: string): Promise<{ webhook: MaWebhook; signingSecret: string }>;
export async function deleteMaWebhook(tenantId: string, id: string): Promise<void>;
export async function listEnabledMaWebhooksForRuntime(): Promise<Array<{ id; tenantId; url; eventTypes; agentIds; sources; includeResultText; signingSecret: string }>>;
export async function listMaWebhookDeliveries(tenantId: string, webhookId: string, limit: number): Promise<MaWebhookDelivery[]>;
export async function listExpiringMaCredentials(withinHours: number): Promise<Array<{ tenantId; vaultId; credentialId; credentialType; displayName: string | null; expiresAt: string }>>;
```

密钥存储：`const sealed = sealSecretPayload({ signing_secret: secret })` → 列 `secret_ciphertext = sealed.ciphertext`、`wrapped_dek = sealed.wrappedDek`、`kek_id = sealed.kekId`；读取 `openSecretPayload({ ciphertext, wrappedDek, kekId }).signing_secret`。`sealSecretPayload` 抛 `VaultCryptoUnavailableError` 时原样上抛（路由映射为 503 `vault_crypto_unavailable`）。`listExpiringMaCredentials` 只读 `ma_credentials`（不解密）。

### 5.3 admin-console 记录映射 `src/lib/ma/schedule-records.ts`、`webhook-records.ts`

`toMaScheduleRecord(schedule, summary)` 输出 §4.4 恰好的键（snake_case）；`toMaScheduleRunRecord`、`toMaWebhookRecord`、`toMaWebhookDeliveryRecord` 同理。新增测试断言键集合恰好相等。

### 5.4 admin-console 错误映射 `src/lib/ma/errors.ts`

在 `MA_CONTROL_PLANE_ERROR_CODES` 末尾追加 §4.6 四码；在 `maErrorFromException` 的 `switch (error.name)` 中追加：`MaScheduleValidationError`、`MaScheduleNameConflictError`、`MaWebhookValidationError`、`MaWebhookNameConflictError`、`MaCronValidationError` → `invalid_request`（`MaScheduleNameConflictError` / `MaWebhookNameConflictError` 消息固定 `name already exists`）；`MaScheduleNotFoundError` → `schedule_not_found`；`MaScheduleLimitError` → `schedule_limit`；`MaWebhookNotFoundError` → `webhook_not_found`；`MaWebhookLimitError` → `webhook_limit`。现有分支一字不改。

### 5.5 路由

全部照抄 §1.2 列出的样板：公共接口 `requireMaPat(request, "<scope>")` → `readJsonObject` → `assertOnlyKeys` → iam-core → `NextResponse.json(...)`；路径参数先 `ULID_RE.test`，不匹配直接返回对应 not_found。内部接口 `isMaInternalAuthorized` + `noStore()`。管理台接口 `requireAdminScope` + `requiredTenantId()`（从 `ma-vaults/shared.ts` 复制到 `ma-schedules/shared.ts`，Webhook 路由也从该文件 import）。

### 5.6 nginx `enterprise/deploy/nginx/gateway.conf:95`

Before：`location ~ ^/ma/v1/(agents|environments|vaults|memory_stores|schedules|channels)(/|$) {`
After：`location ~ ^/ma/v1/(agents|environments|vaults|memory_stores|schedules|channels|webhooks)(/|$) {`

### 5.7 管理台页面

`agent-schedules.tsx`（`useTranslations("pages.admin.agentSchedules")`，数据经 `adminFetch("/api/admin/ma-schedules…")`）：
- 表格列：名称、智能体（显示名，来自 `/api/admin/agents`）、计划（`cron` + 时区）、启用（`SettingsSwitch` 同款开关，切换即 PATCH `{enabled}`）、下一次执行（`next_run_at` 本地化；null 显示「待计算」）、最近一次（状态徽标 + 时间）、操作（编辑 / 立即运行 / 运行记录 / 删除）。
- 新建 / 编辑弹窗字段：名称、描述、智能体（下拉）、版本策略（「跟随智能体版本路由」/「固定版本」+ 版本号输入）、执行环境（下拉，可空 =「智能体默认环境」）、计划（cron 输入，右侧显示 `parseCron` 失败时的错误文本）、时区（文本输入，缺省 `Asia/Shanghai`）、输入内容（多行，提示可用变量 `{{date}}` `{{datetime}}` `{{schedule_name}}` `{{run_id}}`）。不提供 `vault_ids` / `resources` / 错过宽限编辑（API 可设）。底部「取消」紧邻「保存」左侧；保存失败保留弹窗并显示接口错误文本。
- 运行记录抽屉：最近 50 条，列：计划时间、触发方式（定时 / 手动）、状态（含 `skip_reason` 中文：错过 / 上一轮未结束 / 配置已变更 / 已停用 / 已删除）、会话（有 `session_id` 时链接 `/ops/logs/managed/<session_id>`）、错误。
- 删除：应用内主题化确认弹窗（不用 `window.confirm`），文案「删除后不再触发，历史运行记录保留」。

`agent-webhooks.tsx`：表格列：名称、地址、订阅事件、启用、更新时间、操作（编辑 / 轮换密钥 / 投递记录 / 删除）。新建弹窗字段：名称、地址、事件（三个复选框：会话完成 / 会话失败 / 凭证即将过期）、智能体范围（多选，可空 = 全部）、来源范围（多选：门户 / 桌面 / API / 定时任务 / IM 渠道 / 评测）、附带结果文本（开关）。创建 / 轮换成功后弹窗显示一次 `signing_secret` 与复制按钮（「关闭后不能再次查看」一行）。投递记录抽屉：最近 50 条（事件类型、状态、尝试次数、最后状态码、最后错误、时间）。

注册：`admin-platform-sections.ts` 在 `"agent-vaults"` 之后（若 E07 已在其后加了 `agent-memory-stores`，则在其后）插入 `"agent-schedules", "agent-webhooks"`；`[section]/page.tsx` 两行 import + 两行映射；`AppShell.tsx` 平台分组在凭证库（或记忆库）之后加两项：`{ href: "/admin/agent-schedules", labelKey: "agentSchedules", icon: CalendarClock }`、`{ href: "/admin/agent-webhooks", labelKey: "agentWebhooks", icon: Webhook }`（`lucide-react` 已是依赖；图标名以实际导出为准）。文案 zh：`agentSchedules: "定时任务"`、`agentWebhooks: "Webhook 通知"`；en：`"Schedules"`、`"Webhooks"`。

### 5.8 agent-runtime `ma_agent_runtime/cron.py`（新建）

```python
#!/usr/bin/env python3
"""Five-field cron parsing and next-fire computation for managed schedules.

Author: Damon Li
"""

class CronError(ValueError): ...

@dataclass(frozen=True)
class CronSpec:
    minutes: tuple[int, ...]; hours: tuple[int, ...]; days_of_month: frozenset[int]; months: frozenset[int]
    days_of_week: frozenset[int]          # 0 = Sunday; 7 folded into 0
    dom_restricted: bool; dow_restricted: bool

def parse_cron(expr: str) -> CronSpec: ...                       # same grammar and error texts as §4.3
def next_fire(spec: CronSpec, tz: str, after: datetime) -> datetime: ...   # strictly greater than `after`, UTC-aware
def render_template(template: str, *, scheduled_for: datetime, tz: str, schedule_name: str, run_id: str) -> str: ...
```

`next_fire` 算法：`local = after.astimezone(ZoneInfo(tz))`；从 `local.date()` 起逐日遍历最多 1500 天；某日满足 `month ∈ months` 且日匹配（`dom_restricted and dow_restricted` → `day ∈ dom or weekday ∈ dow`；只限其一则只看该项；都不限则匹配），则按升序遍历 `hours × minutes` 构造 `datetime(y, m, d, h, mi, tzinfo=ZoneInfo(tz))`；若该本地时间不存在（`dt.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != naive`，即夏令时缺口）则取 `naive + 1 hour` 的本地时间（与 §4.3 夹具一致）；候选 UTC 值 `> after` 即返回。1500 天内无解抛 `CronError("cron: no future fire time")`。Python `weekday()` 周一 = 0，转换为 cron 周日 = 0：`(dt.weekday() + 1) % 7`。

`render_template`：只替换 `{{date}}`（本地 `YYYY-MM-DD`）、`{{datetime}}`（本地 `YYYY-MM-DD HH:MM`）、`{{schedule_name}}`、`{{run_id}}`；未知 `{{x}}` 原样保留；结果超过 16384 字节截断。

### 5.9 agent-runtime `ma_agent_runtime/session_hooks.py`（新建）

```python
TERMINAL_EVENT_TYPES = frozenset({"session.status_idle", "session.status_terminated"})
TerminalListener = Callable[[str, str, StoredEvent], Awaitable[None]]   # (tenant_id, session_id, event)

class HookedPgEventStore(PgEventStore):
    """PgEventStore that notifies listeners after terminal status events are committed."""
    def __init__(self, engine, **kwargs) -> None: ...                    # forwards to PgEventStore.__init__
    def add_terminal_listener(self, listener: TerminalListener) -> None: ...
    async def append_events(self, tenant_id, session_id, events) -> list[StoredEvent]:
        stored = await super().append_events(tenant_id, session_id, events)
        for item in stored:
            if item.type in TERMINAL_EVENT_TYPES:
                for listener in list(self._listeners):
                    task = asyncio.create_task(self._safe(listener, tenant_id, session_id, item))
                    self._tasks.add(task); task.add_done_callback(self._tasks.discard)
        return stored
    async def drain(self) -> None: ...      # await pending listener tasks (tests and shutdown)
```

`_safe` 捕获所有异常并 `logger.exception("terminal listener failed session=%s", session_id)`；**不得**在 `append_events` 中直接 await 监听器（§1.2 actor 锁）。

### 5.10 agent-runtime `ma_agent_runtime/scheduler.py`（新建）

```python
class ScheduleTicker:
    def __init__(self, *, engine: AsyncEngine, client: AdminConsoleClient, service: SessionService,
                 settings: Settings, clock: Callable[[], datetime] = utc_now) -> None: ...
    async def tick(self) -> None: ...                 # one full pass; safe to call concurrently from several replicas
    async def run_forever(self) -> None: ...          # while True: tick(); sleep(settings.scheduler_tick_seconds)
    async def on_terminal(self, tenant_id: str, session_id: str, event: StoredEvent) -> None: ...   # listener
```

`tick()`（顺序执行；每步独立 try/except 并记日志，一个任务出错不影响其他任务）：

```text
snapshot = await client.list_runtime_schedules()          # {data, disabled_ids}
now = clock()
for s in snapshot.data:                                   # enabled schedules
    # (a) replace stale planned rows
    UPDATE ma_schedule_runs SET status='skipped', skip_reason='revised', finished_at=now, updated_at=now
      WHERE schedule_id=s.id AND trigger='schedule' AND status='scheduled' AND schedule_revision <> s.revision
    # (b) ensure one planned row for this revision
    if not EXISTS(schedule_id=s.id, trigger='schedule', status='scheduled', schedule_revision=s.revision):
        anchor = max(now, latest scheduled_for of this schedule's trigger='schedule' rows with status <> 'skipped' or skip_reason='missed')
        at = next_fire(parse_cron(s.cron), s.timezone, anchor)   # CronError -> log and skip this schedule
        INSERT (id=new_ulid(), tenant, schedule_id, revision, trigger='schedule', scheduled_for=at, status='scheduled') ON CONFLICT DO NOTHING
    # (c) manual request
    if s.manual_run_requested_at and not EXISTS(schedule_id=s.id, trigger='manual', scheduled_for=s.manual_run_requested_at):
        INSERT (..., trigger='manual', scheduled_for=s.manual_run_requested_at, status='scheduled') ON CONFLICT DO NOTHING
for sid in snapshot.disabled_ids + ids of 'scheduled' rows whose schedule_id is in neither list:
    UPDATE ... SET status='skipped', skip_reason=('disabled' if sid in disabled_ids else 'deleted') WHERE schedule_id=sid AND status='scheduled'
# (d) fire due rows
due = SELECT * FROM ma_schedule_runs WHERE status='scheduled' AND scheduled_for <= now ORDER BY scheduled_for LIMIT 50
for run in due:
    if UPDATE ... SET status='firing', updated_at=now WHERE id=run.id AND status='scheduled' affects 0 rows: continue   # another replica owns it
    s = schedules_by_id.get(run.schedule_id)
    if s is None: mark skipped('deleted'); continue
    if run.trigger == 'schedule' and (now - run.scheduled_for).total_seconds() > s.misfire_grace_seconds: mark skipped('missed'); continue
    if EXISTS(schedule_id=s.id, status IN ('firing','running'), id <> run.id): mark skipped('overlap'); continue
    await self._fire(s, run)                          # see below
# (e) timeouts
for run in SELECT * WHERE status='running' AND started_at < now - settings.schedule_run_timeout_seconds:
    await self._interrupt(run); mark failed('timeout')
```

`_fire(s, run)`：

```python
principal = Principal(tenant_id=s.tenant_id, user_id=s.run_as_user_id,
                      scopes=frozenset({"ma:sessions:read", "ma:sessions:write"}))
req = CreateSessionRequest(agent_id=s.agent_id,
                           agent_version=s.pinned_version if s.version_policy == "pinned" else None,
                           environment_id=s.environment_id, vault_ids=s.vault_ids, resources=s.resources,
                           title=f"定时任务 · {s.name} · {local_time(run.scheduled_for, s.timezone):%Y-%m-%d %H:%M}"[:200],
                           source="schedule")
try:
    record = await service.create_session(principal, req)
    UPDATE runs SET status='running', session_id=record.id, agent_version=record.agent_version, started_at=now WHERE id=run.id
    text = render_template(s.input_template, scheduled_for=run.scheduled_for, tz=s.timezone, schedule_name=s.name, run_id=run.id)
    await service.post_events(principal, record.id, {"events": [{"type": "user.message", "content": [{"type": "text", "text": text}]}]})
except MAError as exc: mark failed(f"{exc.code}: {exc.message}"[:500])
except Exception: logger.exception(...); mark failed("internal_error")
if run.trigger == 'schedule': plan the next slot (step (b) with anchor = run.scheduled_for)
```

（`run_id` 先于会话创建确定，故 `{{run_id}}` 可用；`create_session` 成功但 `post_events` 失败时，会话留在 idle，运行记 `failed`。）

`on_terminal(tenant_id, session_id, event)`：

```text
run = SELECT * FROM ma_schedule_runs WHERE session_id=:sid AND status='running'   (none -> return)
stop = event.payload.get("stop_reason", {}).get("type") if event.type == "session.status_idle" else "terminated"
if stop == "requires_action":
    await service.post_events(Principal(tenant, run_as_user, scopes), sid, {"events": [{"type": "user.interrupt"}]})  # errors logged
    mark failed("requires_action"); return
mark (succeeded if stop in {"end_turn", "max_tool_rounds"} else failed(stop or "unknown"))
```

`run_as_user_id` 在 `on_terminal` 里来自会话记录的 `created_by_user_id`（`await service.store.get_session(tenant_id, sid)`）。「mark」一律 `UPDATE ... SET status=..., error=..., finished_at=now, updated_at=now WHERE id=:id AND status IN (<expected>)`。

SQL 一律用 SQLAlchemy Core（`tables.ma_schedule_runs`）+ `async with engine.begin()`；`ON CONFLICT DO NOTHING` 用 `sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_nothing(index_elements=[...])`，SQLite 测试库用 `sqlite_insert(...).on_conflict_do_nothing`（参考 `pg_event_store.py:47` 的 `_insert_ignore`，可直接 import 复用）。

### 5.11 agent-runtime `ma_agent_runtime/webhooks.py`（新建）

```python
IDLE_STOP_TYPES = frozenset({"end_turn", "max_tool_rounds", "requires_action"})
FAILED_STOP_TYPES = frozenset({"retries_exhausted", "refusal", "budget_exceeded", "policy_blocked"})
BACKOFF_SECONDS = (10, 30, 120, 600, 1800)
RESULT_TEXT_LIMIT = 4000

def classify_session_event(event: StoredEvent) -> tuple[str, str] | None: ...   # -> ("session.idle"|"session.failed", stop_type) or None
def sign(secret: str, event_id: str, timestamp: int, body: bytes) -> str: ...    # "v1,<base64>"; raises ValueError if not whsec_
def classify_response(status: int | None, error: str | None) -> Literal["succeeded", "retry", "failed"]: ...
def is_blocked_address(host: str) -> bool: ...   # resolves with socket.getaddrinfo; any loopback/private/link_local/reserved/multicast/unspecified -> True

class WebhookConfigCache:            # wraps client.list_runtime_webhooks(); TTL settings.webhook_config_cache_seconds (30)
class WebhookOutbox:
    def __init__(self, *, engine, cache: WebhookConfigCache, store: PgEventStore, clock=utc_now) -> None: ...
    async def on_terminal(self, tenant_id: str, session_id: str, event: StoredEvent) -> None: ...   # listener
    async def enqueue_credential_expiring(self, items: list[dict]) -> int: ...
class WebhookDeliverer:
    def __init__(self, *, engine, cache, settings, http: httpx.AsyncClient | None = None, clock=utc_now) -> None: ...
    async def deliver_due(self) -> int: ...       # claims up to 20 rows, sends, updates; returns sent count
    async def run_forever(self) -> None: ...      # loop deliver_due(); sleep 2s when nothing was due
class CredentialExpiryScanner:
    async def scan(self) -> None: ...            # client.list_expiring_credentials(72) -> outbox.enqueue_credential_expiring
    async def run_forever(self) -> None: ...     # every 3600s
```

`WebhookOutbox.on_terminal`：`classified = classify_session_event(event)`（None → return）；`session = await store.get_session(tenant_id, session_id)`；对缓存中 `tenant_id` 相同、`event_type ∈ event_types`、（`agent_ids` 空或含 `session.agent_id`）、（`sources` 空或含 `session.source`）的每个 Webhook 插入一行 delivery：`event_id=new_ulid()`、`event_key=f"{event_type}:{event.id}"`、`payload` 按 §4.5（schedule 字段查 `ma_schedule_runs`；`include_result_text` 时 `store.list_events(..., types=["agent.message"])` 翻到最后一页取最后一条）、`status='pending'`、`next_attempt_at=now`，`ON CONFLICT (webhook_id, event_key) DO NOTHING`。`enqueue_credential_expiring` 的 `event_key = f"credential.expiring:{credential_id}:{expires_at}"`。

`deliver_due` 领取（PG）：

```sql
UPDATE ma_webhook_deliveries SET status='sending', locked_until=:lock_until, updated_at=:now
WHERE id IN (
  SELECT id FROM ma_webhook_deliveries
  WHERE (status='pending' AND next_attempt_at <= :now) OR (status='sending' AND locked_until < :now)
  ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED)
RETURNING *;
```

（`lock_until = now + 60s`；SQLite 测试库不支持 `SKIP LOCKED`，用 `dialect.name == "sqlite"` 分支去掉 `FOR UPDATE SKIP LOCKED`，同 `pg_work_queue.py` 的做法。）每行：`created_at < now - 24h` → `abandoned`；从缓存取 Webhook（已删除 / 停用 → `failed`，`last_error='webhook_disabled'`）；URL 校验（D12）；`body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()`；`ts = int(now.timestamp())`；发送并按 §4.5 更新。

### 5.12 `control_plane.py`（只追加，放在 `AdminConsoleClient.introspect` 之后）

```python
async def list_runtime_schedules(self) -> dict[str, Any]:
    return await self._read("GET", "/api/internal/ma/schedules", allow_404=False) or {"data": [], "disabled_ids": []}
async def list_runtime_webhooks(self) -> list[dict[str, Any]]:
    body = await self._read("GET", "/api/internal/ma/webhooks", allow_404=False); return list((body or {}).get("data") or [])
async def list_expiring_credentials(self, within_hours: int) -> list[dict[str, Any]]:
    body = await self._read("GET", "/api/internal/ma/credentials/expiring", allow_404=False, params={"within_hours": str(within_hours)})
    return list((body or {}).get("data") or [])
```

### 5.13 `config.py`（`Settings` 追加字段，默认值使开关关闭时行为不变）

| 字段 | 环境变量 | 默认 | 解析 |
|---|---|---|---|
| `scheduler_enabled: bool` | `MA_RUNTIME_SCHEDULER_ENABLED` | False | `== "1"` |
| `scheduler_tick_seconds: float` | `MA_RUNTIME_SCHEDULER_TICK_SECONDS` | 15.0 | `_float_ok`，5–300，非法回退 |
| `schedule_run_timeout_seconds: float` | `MA_RUNTIME_SCHEDULE_RUN_TIMEOUT_SECONDS` | 3600.0 | `_float_ok`，60–86400，非法回退 |
| `webhooks_enabled: bool` | `MA_RUNTIME_WEBHOOKS_ENABLED` | False | `== "1"` |
| `webhook_max_attempts: int` | `MA_RUNTIME_WEBHOOK_MAX_ATTEMPTS` | 6 | `_int_ok`，1–10 |
| `webhook_allow_http: bool` | `MA_RUNTIME_WEBHOOK_ALLOW_HTTP` | False | `== "1"` |
| `webhook_allow_private_network: bool` | `MA_RUNTIME_WEBHOOK_ALLOW_PRIVATE_NETWORK` | False | `== "1"` |
| `webhook_config_cache_seconds: float` | `MA_RUNTIME_WEBHOOK_CONFIG_CACHE_SECONDS` | 30.0 | `_float_ok`，0–300，非法回退 |

### 5.14 `app.py` 接线（Before / After）

Before（第 81–87 行）：`app = create_ma_app(config, ..., store=PgEventStore(async_engine), ...)`。

After：

```python
store = HookedPgEventStore(async_engine)
app = create_ma_app(config, llm_factory=llm_factory, store=store, registry=registry, authenticator=authenticator)
...
if settings.scheduler_enabled:
    ticker = ScheduleTicker(engine=async_engine, client=client, service=app.state.ma.service, settings=settings)
    store.add_terminal_listener(ticker.on_terminal)
    _add_background(app, "schedule_ticker", ticker.run_forever)
if settings.webhooks_enabled:
    cache = WebhookConfigCache(client, ttl=settings.webhook_config_cache_seconds)
    outbox = WebhookOutbox(engine=async_engine, cache=cache, store=store)
    store.add_terminal_listener(outbox.on_terminal)
    _add_background(app, "webhook_deliverer", WebhookDeliverer(engine=async_engine, cache=cache, settings=settings).run_forever)
    _add_background(app, "credential_expiry_scanner", CredentialExpiryScanner(client=client, outbox=outbox).run_forever)
```

`_add_background(app, name, coro_fn)`（`app.py` 内私有函数）：startup hook 中 `state.extras[name] = asyncio.create_task(coro_fn())`；shutdown hook 中取消并 await（吞 `CancelledError`），并在最后 `await store.drain()`。**两开关都关时** `HookedPgEventStore` 没有监听器，行为与 `PgEventStore` 逐字一致。

---

## 6. FR / NFR / AC

| ID | 需求 | AC（测试文件 :: 用例 → 断言） |
|---|---|---|
| FR-1 | 表结构 | `ma-schema.test.ts`：四表列集合 PG / MySQL 一致；`schema-parity.test.ts::mirrors all 88 PostgreSQL tables in MySQL`（以实施时实际值 +4）；`migration-inventory.test.ts` journal 末 tag `0065_ma_schedules_webhooks`；`agent-runtime/tests/test_tables_parity.py::test_automation_tables_match_ddl` 读取 `0065` 比对 `ma_schedule_runs`、`ma_webhook_deliveries` 列名 / 类型族 / 非空 |
| FR-2 | cron 两端一致 | `iam-core/src/repos/__tests__/ma-cron.test.ts::matches shared cron fixture`：读取 `tests/fixtures/managed_agents/cron_cases.json`，`valid` 全部不抛，`invalid` 每条抛出且 `message === error`；`agent-runtime/tests/test_cron.py::test_shared_fixture_validity` 同一断言；`test_next_fire_fixture` 逐条 `next_fire(...) == expect`；`test_next_fire_strictly_after`（`after` 恰为某触发点时返回下一个）；`test_render_template_variables`（`{{date}}` 用时区本地日期，未知变量保留） |
| FR-3 | Schedule 校验 | `ma-schedules-validate.test.ts`：`pinned` 缺 `pinned_version` → `pinned_version: is required`；`follow_routing` 带 `pinned_version: 2` → `pinned_version: must be null unless version_policy is pinned`；`input_template` 16385 字节 → 报错；`vault_ids` 21 项 → 报错；`run_as_user_id` 出现在 body → `run_as_user_id: is not allowed`；`misfire_grace_seconds: 30` → 报错 |
| FR-4 | Schedule 公共接口 | `schedules-route.test.ts`：无 scope → 403；POST 成功 201 且 `run_as_user_id === PAT 属主`、`revision === 1`、`next_run_at === null`；PATCH `{enabled:false}` → `revision === 2`；POST `/:id/run` → 202 且 iam-core `requestMaScheduleRun` 被调用；GET `/:id/runs` 返回 `toMaScheduleRunRecord` 键集合；第 101 条 → 409 `schedule_limit`；不存在 id → 404 `schedule_not_found` |
| FR-5 | Webhook 公共接口与密钥 | `webhooks-route.test.ts`：POST 201 响应含 `signing_secret` 且匹配 `^whsec_[A-Za-z0-9+/]{43}=$`；随后 GET 不含 `signing_secret`、`secret_ciphertext`、`wrapped_dek`（键集合断言）；`rotate_secret` 返回新密钥且与旧值不同；`event_types: []` → 400；`event_types: ["session.started"]` → 400；`url: "https://u:p@x.example.com/h"` → 400；主密钥缺失（`vi.stubEnv("MA_VAULT_MASTER_KEY","")`）→ 503 `vault_crypto_unavailable` | gitleaks:allow
| FR-6 | 内部接口 | `schedule-webhook-internal-routes.test.ts`：错误 token → 401；`/schedules` 返回跨租户启用项与 `disabled_ids`；`/webhooks` 返回明文 `signing_secret`（与创建时一致）且响应头 `cache-control: no-store`；`/credentials/expiring?within_hours=72` 只含 72 小时内、`status=active` 的凭证；`within_hours=0` → 400 |
| FR-7 | 调度：排期与触发 | `test_scheduler.py`（SQLite 测试库 + `FakeAdminConsole` + 内存 `SessionService` 替身，见 §6.1）：`test_plans_next_slot`：一次 tick 后存在 1 行 `scheduled`，`scheduled_for == next_fire(...)`；`test_fires_due_run_once`：时钟推进到 `scheduled_for` 后 tick → `create_session` 恰调用 1 次，参数 `source == "schedule"`、`agent_version is None`（follow_routing）；运行行 `status == "running"` 且 `session_id` 非空；`post_events` 收到的文本为渲染后的模板；新的 `scheduled` 行已排到下一个触发点 |
| FR-8 | 调度：并发去重 | `test_two_tickers_fire_once`：两个 `ScheduleTicker` 共用同一库，`asyncio.gather(t1.tick(), t2.tick())` → `create_session` 总共 1 次 |
| FR-9 | 调度：错过 / 重叠 / 修订 / 停用 / 删除 | `test_missed_run_is_skipped`：`scheduled_for` 比 now 早 600 秒（宽限 300）→ `skipped/missed`，未建会话，已排下一次；`test_overlap_is_skipped`：上一轮 `running` 时新一轮 → `skipped/overlap`；`test_revision_replaces_planned_row`：revision 从 1 改到 2 → 旧行 `skipped/revised`，新行 revision 2；`test_disabled_and_deleted`：`disabled_ids` 含该 id → `skipped/disabled`；快照中消失 → `skipped/deleted` |
| FR-10 | 手动触发 | `test_manual_request_fires_once`：`manual_run_requested_at` 设值 → 连续两次 tick 只建 1 个会话，运行 `trigger == "manual"`；不影响已排的 `schedule` 行 |
| FR-11 | 运行收尾 | `test_terminal_marks_run`：对运行中会话调用 `on_terminal(..., status_idle{end_turn})` → `succeeded`；`retries_exhausted` → `failed` 且 `error == "retries_exhausted"`；`requires_action` → `post_events` 收到 `user.interrupt`，运行 `failed/requires_action`；`test_run_timeout_interrupts`：`started_at` 早于超时 → 中断 + `failed/timeout` |
| FR-12 | 宿主拒绝 vault_ids | `test_host_rejection_marks_failed`：替身 `create_session` 抛 `MAError(INVALID_REQUEST, "vault_ids are not supported by this host yet")` → 运行 `failed`，`error == "invalid_request: vault_ids are not supported by this host yet"`；下一次仍正常排期 |
| FR-13 | 终态监听 | `test_session_hooks.py::test_listener_runs_after_commit`：`HookedPgEventStore`（SQLite）追加 `[agent.message, session.status_idle]` → 监听器恰被调用 1 次且收到 idle 事件；`test_listener_not_awaited_inline`：监听器内 `await asyncio.sleep(0.2)` 时 `append_events` 在 < 0.1 秒返回；`test_listener_errors_are_swallowed`：监听器抛错 → `append_events` 正常返回、日志含 `terminal listener failed`；无监听器时返回值与 `PgEventStore` 相同 |
| FR-14 | Webhook 签名 | `test_webhooks.py::test_signature_matches_reference`：`secret = "whsec_" + base64(b"k"*32)`、`id="01JEVENT000000000000000000"`、`ts=1700000000`、`body=b'{"a":1}'` → `sign(...) == "v1," + base64(hmac_sha256(b"k"*32, b"01JEVENT000000000000000000.1700000000.{\"a\":1}"))`；并用 §1.3 调研文档中的 Python `verify_webhook` 函数（复制进测试，改名 `reference_verify`）验证通过 |
| FR-15 | Webhook 入队与过滤 | `test_outbox_filters`：两个 Webhook（一个订阅 `session.idle` 且 `agent_ids=[A]`，一个订阅 `session.failed`）；`status_idle{end_turn}` 的 A 会话 → 只为第一个入队 1 行，`payload.data.type == "session.idle"`、`stop_reason == {"type":"end_turn"}`；同一事件再次 `on_terminal` → 仍 1 行（唯一键）；`source=schedule` 会话的 payload 含 `schedule_id`、`schedule_run_id`；`include_result_text=false` 时无 `result_text` 键、`true` 时为最后一条 `agent.message` 文本；`budget_exceeded` 映射为 `session.failed` |
| FR-16 | Webhook 投递与重试 | `test_deliver_success_headers`（`httpx.MockTransport`）：收到的请求头含 `webhook-id == event_id`、`webhook-timestamp` 为整数、`webhook-signature` 以 `v1,` 开头且 `reference_verify` 通过；行 `succeeded`。`test_retry_then_fail`：接收端依次返回 503 ×5、再 503 → `attempts` 递增、`next_attempt_at` 按退避增长（容忍 ±20%），第 6 次后 `failed`；`test_redirect_fails_without_retry`：302 → `failed`、`last_error == "redirect"`、只请求 1 次；`test_400_fails_without_retry`；`test_retry_keeps_event_id_but_resigns`：两次尝试 `webhook-id` 相同、`webhook-timestamp` 不同 |
| FR-17 | 地址拦截 | `test_blocked_addresses`：`http://example.com/h` 在 `allow_http=False` 时 `failed/http_not_allowed`；`https://127.0.0.1/h`、`https://10.0.0.5/h` 在 `allow_private_network=False` 时 `failed/blocked_address` 且 MockTransport 未收到请求；两个开关打开后正常投递 |
| FR-18 | 凭证即将过期 | `test_credential_expiring_enqueued_once`：`FakeAdminConsole` 返回 1 条 72 小时内过期凭证 → `scan()` 两次后只有 1 行 `credential.expiring` delivery，`payload.data.credential_id` 正确 |
| FR-19 | 开关关闭零影响 | `tests/test_app_e2e.py` 不改一行仍全绿；`test_session_hooks.py::test_build_app_without_flags_has_no_listeners`：`build_app(Settings(..., scheduler_enabled=False, webhooks_enabled=False))` 后 `app.state.ma.store._listeners == []` 且 `extras` 无 `schedule_ticker` / `webhook_deliverer` |
| FR-20 | PAT scope 同步 | `tests/managed/test_fixture_parity.py` 全绿（Python / TS `PAT_SCOPES` 一致）；`pat-scope-options.test.ts` 全绿；`PAT_SCOPES` 长度 17 |
| FR-21 | 管理台页面 | `admin-platform-sections.test.ts` 含两个新 slug；`src/app/api/admin/ma-schedules/__tests__/route.test.ts`：无 `provider:read` → 403；列表项含 `next_run_at`、`last_run` 键；删除需 `provider:delete` |
| NFR-1 | 不泄露 | `test_webhooks.py::test_errors_never_contain_secret`：投递失败时 `last_error` 与日志（`caplog`）不含签名密钥与 `signature` 值；FR-5 键集合断言 |
| NFR-2 | 类型 | 所有涉及包 `typecheck` 无错；新增 `switch` 对联合类型写 `never` 穷尽 |
| NFR-3 | 框架不回归 | `python -m pytest tests/managed -q --no-cov` 全绿（只改了 `protocol.py` 常量） |

### 6.1 测试替身约定（`agent-runtime/tests`）

- 数据库：复用 `conftest.py` 的 `sqlite_urls` fixture（`MA_RUNTIME_ALLOW_SQLITE` 语义）+ `tables.metadata.create_all`（新表须加入 `metadata`）。
- `SessionService` 替身：`FakeSessions`，实现 `create_session(principal, req) -> SessionRecord`（记录调用、生成 ULID）、`post_events(principal, session_id, raw)`（记录调用）、`store.get_session(...)`。
- `FakeAdminConsole`（`tests/fakes.py`）追加 3 个路由，数据由测试设置 `fake.schedules`、`fake.disabled_ids`、`fake.webhooks`、`fake.expiring`。
- 时钟：`conftest.Clock`。

---

## 7. 验证命令

```bash
cd /Users/damon/myWork/AgenticX
python -m pytest tests/managed -q --no-cov
python -m pytest -o addopts="" -o asyncio_mode=auto enterprise/apps/agent-runtime/tests -q

cd enterprise
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/db-schema test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/iam-core test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/admin-console test
env -u DATABASE_URL -u DATABASE_DIALECT pnpm --filter @agenticx/core-api test
pnpm --filter @agenticx/db-schema typecheck && pnpm --filter @agenticx/iam-core typecheck
pnpm --filter @agenticx/admin-console typecheck && pnpm --filter @agenticx/admin-console build
docker run --rm -v "$PWD/deploy/nginx/gateway.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t   # 若 conf 依赖外部 upstream 定义，按 E03 §8 的方式验证
```

**W5 门演示（定时任务 + Webhook 部分）：**

```bash
# 0) 接收端：python3 - <<'PY' 起一个 http.server，把每次 POST 的头与 body 追加到 /tmp/wh.jsonl（参考 bailian/managed-agents-webhook-notifications.md L103-130）
# 1) 启动（PG 容器、admin-console、网关已起）：
cd /Users/damon/myWork/AgenticX/enterprise
MA_RUNTIME_SCHEDULER_ENABLED=1 MA_RUNTIME_WEBHOOKS_ENABLED=1 MA_RUNTIME_WEBHOOK_ALLOW_HTTP=1 \
MA_RUNTIME_WEBHOOK_ALLOW_PRIVATE_NETWORK=1 bash scripts/start-dev-with-infra.sh --with-agent-runtime --ui=stream
# 2) 管理台 → Webhook 通知：新建，地址 http://127.0.0.1:9911/hook，勾选「会话完成」「会话失败」，打开「附带结果文本」，复制密钥
# 3) 管理台 → 定时任务：新建，智能体选一个已发布 cloud Agent，计划 "*/5 * * * *"，输入「用一句话报告当前时间 {{datetime}}」
# 4) 等两个触发点（或点「立即运行」两次，间隔 > 1 秒）
# 期望：运行记录出现两行 succeeded，各自 session_id 不同，均可跳转观测台；/tmp/wh.jsonl 有两条 session.idle，
#       data.source=schedule、data.schedule_run_id 与运行记录一致、result_text 非空；用复制的密钥按 §4.5 验签通过
```

---

## 8. 回滚

- agent-runtime：`MA_RUNTIME_SCHEDULER_ENABLED=0`、`MA_RUNTIME_WEBHOOKS_ENABLED=0`（缺省）→ 无监听器、无后台任务，与 E03 行为一致；已排的运行行停在 `scheduled`，重新打开后按 D6 记 `missed` 并重新排期。
- admin-console：新页面 / 接口无人调用即无影响；迁移只新增表，不改旧表，可保留。
- nginx：还原第 95 行（只影响 `/ma/v1/webhooks*` 公共入口）。
- 代码：删除 §3.1 新建文件，`git checkout` 修改文件；PAT scope 回滚时需同时还原 Python / TS / 管理台三处（否则 parity 测试失败）。

## 9. 不变量

1. 两个运行时开关关闭时，agent-runtime 的会话面 API、事件写入、Worker 面行为与 E03/D01 逐字一致。
2. `ma_schedules` / `ma_webhooks` 只由 admin-console 写；`ma_schedule_runs` / `ma_webhook_deliveries` 只由 agent-runtime 写。
3. Webhook 签名密钥明文只出现在：创建 / 轮换响应各一次、内部接口响应、运行时内存缓存。不进日志、不进投递记录、不进管理台列表接口。
4. 现有 `MA_CONTROL_PLANE_ERROR_CODES` 与 `maErrorFromException` 已有分支不变；现有 13 个 PAT scope 相对顺序不变：4 个新 scope 按 `ma:schedules:read`、`ma:schedules:write`、`ma:webhooks:read`、`ma:webhooks:write` 顺序插在 `ma:memory:write` 之后、`ma:admin` 之前（`ma:admin` 保持最后一项），Python / TS / 管理台三处完全一致。
5. 框架 `agenticx/managed/host/**`、`events/**` 零改动；终态监听器不在持锁路径 await。

## 10. 风险与待确认

1. **至多一次的通知**：进程在事件提交后、入队前崩溃会丢一条 Webhook（D10）。接收端应定期回查会话；文档已写明。
2. **定时会话的配额与可见性归属**：会话 `created_by_user_id = run_as_user_id`（创建者），MA-E10 的用户 × Agent 配额按创建者计。若需要「以某个服务身份运行」，属后续。
3. **私网投递**：缺省拦截私网地址；私有化部署接收端多在内网，运维须显式开 `MA_RUNTIME_WEBHOOK_ALLOW_PRIVATE_NETWORK=1`（Q1：是否改为缺省放开？）。
4. **多副本**：调度与投递均已做到多副本安全；但同一会话在多副本间仍受 E03 的「会话 actor 进程内」限制（中断请求打到另一副本时由该副本新建 actor 处理，状态以库为准）。
5. **cron 自实现**：夏令时缺口规则与常见实现可能不同（§4.3 夹具第 4 条），中国时区无夏令时，影响面小。

## 11. 需要在 master §12 登记的事项

- PAT scope 新增 `ma:schedules:read`、`ma:schedules:write`、`ma:webhooks:read`、`ma:webhooks:write`（改 MA-00 冻结常量）。
- 控制面扩展错误码 `schedule_not_found` 404、`schedule_limit` 409、`webhook_not_found` 404、`webhook_limit` 409。
- `ma_schedules` 不含 `next_run_at`：下一次执行时间由 agent-runtime 预排在 `ma_schedule_runs`（`status='scheduled'`）；调度器多副本无选主，靠唯一索引 + CAS 去重；错过不补跑。
- Webhook 事件名 `session.idle` / `session.failed` / `credential.expiring` 的判定规则（D13）与签名格式（§4.5）。
- 栈：TS + Python + nginx 一行（`/ma/v1/webhooks` 归控制面）。
- agent-runtime 新增依赖 `tzdata`。
