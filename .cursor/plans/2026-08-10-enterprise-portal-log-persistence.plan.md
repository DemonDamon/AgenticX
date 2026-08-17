# 子规划 D：Portal 请求日志入库（PG + MySQL）与管理后台查询

Planned-with: Claude Opus 5 (thinking)
Suggested-Impl-Model: GPT-5.6（强推理档；涉及双方言 schema + 异步批量写入 + 保留期治理，写放大与一致性风险较高）
Parent-Plan: `.cursor/plans/pending/2026-08-10-enterprise-trace-observability.plan.md`
Depends-On: `2026-08-10-enterprise-trace-id-propagation.plan.md`（A，提供 trace_id）、`2026-08-10-enterprise-portal-request-logging.plan.md`（B，提供结构化 logger）

## 一句话目标

把子规划 B 写到 stdout 的 portal 结构化日志**同时**落到数据库表 `portal_request_logs`（PG 与 MySQL 双支持），并在 admin-console 增加「Portal 日志」查询入口，使运维只在管理后台一处、用同一个 trace_id 就能看全「网关侧 + portal 侧」的完整链路。

## 为什么需要 D（A+B+C 之后仍存在的缺口）

做完 A+B+C，管理后台能查到两类数据：网关审计事件（`gateway_audit_events`）与 trace step 明细（`agent_token_traces`）。但**portal 进程内部发生的故障不在其中**：

- 前端 fetch 到 portal 就失败 → 请求根本没到网关 → 无审计事件
- 深度调研把 Node 事件环打满导致 SSE 断流 → 网关侧看到的是一次正常调用，portal 侧才是现场
- portal BFF 自身抛异常（会话归属校验、模型可见性校验、artifact 落盘失败）→ 全部只在 stdout

子规划 B 让这些有了结构化日志，但需要登录机器 `grep`，或依赖部署侧接了日志采集系统。D 补上「后台一处查全」的最后一段。

## 设计取舍（实施者必须理解，否则容易做成性能事故）

日志量级比审计大一到两个数量级，**不能照抄审计的同步写入模型**。本子规划的核心约束：

1. **写入必须异步 + 批量 + 有界丢弃。** 日志入库失败绝不能影响用户请求，宁可丢日志也不能拖慢或失败一次对话。
2. **只落结构化字段，绝不落正文。** prompt / 回复内容 / Authorization / Cookie 一律不入库（沿用 B 的 `redact()`）。
3. **必须有保留期治理。** 表自带 TTL 清理，默认 14 天，否则几个月后这张表会变成运维负担。
4. **stdout 输出保持不变。** DB 是**旁路**，不是替代。DB 挂了、未配置 `DATABASE_URL` 时，stdout 日志照常，功能无感降级。

## In scope

- `enterprise/packages/db-schema/`：新表 `portal_request_logs`（PG + MySQL 双 schema + 双迁移）
- `enterprise/apps/web-portal/src/lib/observability/`：新增 DB sink（异步批量）+ 接到 B 的 logger
- `enterprise/apps/admin-console/`：新增 `/portal-logs` 页面 + 查询 API + 导航项 + i18n
- 保留期清理入口（CLI 脚本或按需触发的 API）

## Out of scope（严禁改动）

- `desktop/`、`agenticx/`、`enterprise/apps/gateway/`
- 子规划 B 的 stdout 输出格式与 `redact()` 规则（只复用，不改）
- 审计表 `gateway_audit_events`、`audit_events` 与其 checksum 链
- 不引入 ClickHouse / Loki / OpenTelemetry Collector 等外部组件
- 不做日志的全文检索（本轮只按结构化字段等值/范围过滤）
- 不给 portal 日志做 checksum 链（它是排障日志，不是合规审计，不需要防篡改）

---

## FR-1：新表 `portal_request_logs`（双方言）

**落点：** `enterprise/packages/db-schema/src/schema/portal-request-logs.ts`（PG）与 `src/mysql-schema/portal-request-logs.ts`（MySQL），并在两侧 `index.ts` 导出。

> 本仓双方言约定：两侧表名列名必须一一对应，由 `src/__tests__/schema-parity.test.ts` 强制校验。参考现有成对文件 `schema/gateway-audit-events.ts` ↔ `mysql-schema/gateway-audit-events.ts` 的写法差异（PG 用 `timestamp/jsonb/integer`，MySQL 用 `datetime({fsp:6})/json/int`）。

**列定义（逻辑，两侧等价）：**

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | ulid(26) | PK | 复用 `_shared.ts` 的 `ulid()` |
| `tenant_id` | varchar(64) | not null | **不加外键**，日志表要能容忍脏租户值而不阻断写入 |
| `log_time` | timestamp / datetime(fsp 6) | not null | 日志时间 |
| `level` | varchar(16) | not null | debug / info / warn / error |
| `event` | varchar(128) | not null | 稳定事件名，如 `chat.completions.gateway_unreachable` |
| `trace_id` | varchar(128) | nullable | 与 `gateway_audit_events.trace_id` 同源 |
| `user_id` | varchar(128) | nullable | |
| `session_id` | varchar(128) | nullable | |
| `route` | varchar(128) | nullable | |
| `status` | integer / int | nullable | HTTP 状态码 |
| `duration_ms` | integer / int | nullable | |
| `error_name` | varchar(128) | nullable | |
| `error_message` | text | nullable | 已由 B 截断到 500 字符 |
| `error_stack` | text | nullable | 已由 B 截断到 2000 字符 |
| `fields` | jsonb / json | nullable | 其余脱敏后的自定义字段 |
| `created_at` | 沿用 `auditColumns` | | 与其他表一致 |

**索引：**

- `portal_request_logs_tenant_trace_idx` on (`tenant_id`, `trace_id`) — 最高频入口
- `portal_request_logs_tenant_time_idx` on (`tenant_id`, `log_time`) — 时间范围 + TTL 清理
- `portal_request_logs_tenant_user_time_idx` on (`tenant_id`, `user_id`, `log_time`)
- `portal_request_logs_tenant_level_time_idx` on (`tenant_id`, `level`, `log_time`) — 只看 error 的场景

**迁移：** PG 新建 `drizzle/0049_portal_request_logs.sql`，MySQL 新建 `drizzle-mysql/0023_portal_request_logs.sql`。（编号按合入时的实际最大值顺延；本分支 Trace 迁移已占用 PG `0048` / MySQL `0022`。）

**AC-1：**
- `pnpm -C enterprise/packages/db-schema db:check:parity` 通过
- `pnpm -C enterprise db:migrate` 在 PG 与 MySQL 两种 `DATABASE_URL` 下分别跑通，且重复执行幂等
- 两种库上 `INSERT` 一行再 `SELECT` 回来，`fields` 的 JSON 往返无损

---

## FR-2：异步批量 DB sink

**落点：** 新建 `enterprise/apps/web-portal/src/lib/observability/db-sink.ts`

**参考现有双方言分发写法：** `enterprise/apps/web-portal/src/lib/chat-history.ts` L23-35 的 `store()` 函数（`resolveDatabaseConfig()` + switch + `never` 穷尽检查）。本文件照此模式在 `postgresql` / `mysql` 之间选择插入实现，schema 分别从 `@agenticx/db-schema` 与 `@agenticx/db-schema/mysql` 导入。portal 已具备 `@agenticx/iam-core`（`getIamDb`）、`drizzle-orm`、`pg`、`mysql2`、`ulid` 依赖，**无需新增任何 npm 包**。

**行为规格（逐条都是硬要求）：**

1. 导出 `enqueueLog(row: PortalLogRow): void` —— **同步返回，永不 await，永不抛异常**。内部只做入队。
2. 内存队列上限 `MAX_QUEUE = 1000` 条。队列满时**丢弃最旧的 info/debug 条目优先保留 warn/error**；若全是 warn/error 则丢最旧的，并计数 `droppedCount`。
3. 批量刷写：满 `BATCH_SIZE = 50` 条或距上次刷写超过 `FLUSH_INTERVAL_MS = 2000` 触发一次 `insert().values(batch)`。
4. 刷写失败时：`console.error` 一行 `{"event":"portal_log_sink.flush_failed",...}`（**不得递归 enqueue，会形成死循环**），批次直接丢弃，不重试不堆积。
5. 每 60 秒若 `droppedCount > 0`，输出一行 `portal_log_sink.dropped` 并归零，让运维知道采样丢失。
6. **开关与降级：** 环境变量 `PORTAL_LOG_DB_SINK`（默认 `off`；取值 `on`/`off`）。未开启、或 `resolveDatabaseConfig()` 抛错、或首次插入失败超过 3 次时，自动进入 `disabled` 状态并只走 stdout，**不再重试**（避免 DB 故障时每次请求都打一次连接）。
7. 只入库 `level >= PORTAL_LOG_DB_MIN_LEVEL`（默认 `info`），debug 默认不入库。

**接线：** 修改子规划 B 的 `enterprise/apps/web-portal/src/lib/observability/logger.ts`，在 `console.log/error` 之后追加一行 `enqueueLog(...)`。**顺序不能反**——stdout 必须先出，保证 sink 出任何问题都不影响基础日志。

**AC-2：** 新建 `db-sink.test.ts`，用 fake timers + stub db 断言：
- (a) `enqueueLog` 返回值为 `undefined` 且在 stub db 抛错时**不抛异常**
- (b) 入队 50 条触发一次批量插入，插入参数条数为 50
- (c) 入队 10 条后推进 2000ms，触发一次插入
- (d) 入队 1500 条（含 100 条 error）后，队列内 error 条目一条不丢
- (e) `PORTAL_LOG_DB_SINK=off` 时 stub db 完全未被调用
- (f) 连续 3 次插入失败后进入 disabled，第 4 次入队不再调用 db

---

## FR-3：保留期清理

**落点：** 新建 `enterprise/packages/db-schema/scripts/purge-portal-logs.mjs`，并在 `enterprise/packages/db-schema/package.json` 增加脚本 `"db:purge:portal-logs": "node ./scripts/purge-portal-logs.mjs"`。

**行为：** 读取 `PORTAL_LOG_RETENTION_DAYS`（默认 14），删除 `log_time < now() - N days` 的行。**必须分批删除**（每批 5000 行，批间 `sleep` 50ms），避免单条大事务锁表。支持 `--dry-run` 只打印将删除的行数。PG 与 MySQL 都要支持（复用 `resolveDatabaseConfig()` 分发）。

**AC-3：** 造 100 条跨 30 天的数据，`--dry-run` 报告正确条数且不删；正式执行后仅保留 14 天内的行；PG 与 MySQL 两种库上结果一致。

---

## FR-4：admin-console 查询 API

**落点：** 新建 `enterprise/apps/admin-console/src/app/api/portal-logs/query/route.ts`

**参考实现：** `enterprise/apps/admin-console/src/app/api/audit/query/route.ts`（POST + `requireAdminSomeScope` + 字段白名单映射 + 统一错误码风格），本路由照此结构。

**权限：** `requireAdminSomeScope(["audit:read:all", "audit:manage"])`。

> **注意可见域差异：** portal 日志不带 `department_id`，无法做部门级收窄。因此**只放行 `audit:read:all` 与 `audit:manage`**，不放行 `audit:read` / `audit:read:dept`——否则部门管理员会看到越权数据。这是有意收紧，不是遗漏。

**入参白名单：** `trace_id` / `user_id` / `session_id` / `level` / `event` / `route` / `start` / `end` / `limit`（默认 100，上限 500）/ `offset`。所有字符串入参 trim 后长度 > 128 直接返回 400 `invalid <field>`。查询**必须**带 `tenant_id = guard.session.tenantId` 条件。

**AC-4：** 新建 route 单测断言：(a) 只有 `audit:read:all`/`audit:manage` 能通过，`audit:read:dept` 返回 403；(b) 超长入参返回 400；(c) 查询条件必然含当前租户 ID；(d) `limit=9999` 被夹到 500。

---

## FR-5：admin-console「Portal 日志」页面

**落点：** 新建 `enterprise/apps/admin-console/src/app/portal-logs/page.tsx`，并在侧栏导航配置中新增该项（放在「网关审计」相邻位置）。

**参考实现：** `enterprise/apps/admin-console/src/app/audit/page.tsx` 的整体结构（顶部筛选行 + 活动筛选 chips + 列表 + 右侧详情面板），本页可显著简化。

**页面内容：**

1. 顶部一个显眼的「请求 ID」输入框（**不藏在高级筛选里**，这是最高频入口），旁边放级别下拉（全部/warn+/仅 error）与时间范围。
2. 列表列：时间 / 级别（error 红、warn 黄、info 灰）/ event / route / 状态码 / 耗时 / 用户。
3. 点击行展开详情：完整 `fields` JSON、`error_message`、`error_stack`（等宽字体、可复制）。
4. 空态、加载态、无权限态各一行文案。**无权限时不得白屏**，显示「需要 audit:read:all 权限」。
5. i18n：`messages/zh.json` 与 `messages/en.json` 同步新增 `pages.ops.portalLogs.*`，两侧 key 必须完全一致。

**AC-5：** 起 admin-console，`/portal-logs` 可打开；粘贴一个真实 trace_id 能查到该请求在 portal 侧的全部日志行；级别筛选生效；中英文均无 missing message 警告。

---

## FR-6：审计页与 Portal 日志页互跳

**落点：** `enterprise/apps/admin-console/src/app/audit/page.tsx` 详情面板（子规划 C 的 FR-5 已在此加了「请求 ID」行与「查看 Trace」按钮）

在「查看 Trace」旁再加一个「查看 Portal 日志」按钮，跳转 `/portal-logs?trace_id=<id>`；`/portal-logs` 页面读取该 query 参数作为初始筛选值。反向亦然：portal 日志详情里若有 trace_id，提供「查看网关审计」跳回 `/audit`。

**AC-6：** 从审计详情点「查看 Portal 日志」→ 落地页已自动填入该 trace_id 并完成查询；反向跳转同样生效。

---

## 端到端验收（AC-E2E）

前置：A、B、C 已合入；`PORTAL_LOG_DB_SINK=on`。

1. `bash enterprise/scripts/start-dev-with-infra.sh`（PG）
2. web-portal 发一条正常对话 → admin `/portal-logs` 用该 trace_id 能查到 `chat.completions.finish`
3. `kill` 掉 :8088 网关后再发一条 → 后台能查到 `chat.completions.gateway_unreachable` 的 error 行**且此时 `gateway_audit_events` 中没有对应记录**（证明补上的正是审计的盲区）
4. 从 `/audit` 详情跳 `/portal-logs`，再跳回，trace_id 全程不丢
5. 切到 MySQL（改 `DATABASE_URL` 后 `pnpm -C enterprise db:migrate`）重跑步骤 2-4，行为一致
6. **降级验证：** 停掉数据库后发对话，页面功能正常、stdout 日志正常、终端出现有限次 `portal_log_sink.flush_failed` 后不再刷屏
7. **性能兜底：** 连发 20 条对话，对比 `PORTAL_LOG_DB_SINK=on/off` 两种情况下 `chat.completions.finish` 的 `duration_ms` 中位数，差异应在噪声范围内（p50 增幅 < 5%）
8. `pnpm -C enterprise typecheck && pnpm -C enterprise build` 绿

## 回滚方案

- 代码：`PORTAL_LOG_DB_SINK=off` 即可运行时关闭，无需发版；彻底回滚则回退 commit。
- 数据库：`portal_request_logs` 是独立新表，不影响任何既有表；确需清理执行 `DROP TABLE portal_request_logs;`。
