# 能力回流 B9a：网关分层预算与数据库账本

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: B0（网关测试可编译）
Sibling: B9b（管理台侧，同一份配置契约，可并行）

## 目标

网关对每次模型请求，同时检查并预留以下几层预算，任何一层超限即按规则处理：

1. 公司月度硬顶（Token 和 / 或美元）
2. 组织共享上限
3. 部门共享上限
4. 个人层：个人特例 > 所在用户组里最严的一条 > 每人默认

数据库模式下，所有层在一个事务里一起预留，结算和退款按收据幂等执行，多副本不超卖。

## 现状（已核实）

- `enterprise/apps/gateway/internal/quota/budget.go`（535 行）：`BudgetRule` L27、`BudgetConfig` L40（`Defaults` / `Tenants` / `Departments` / `Users`）、`selectBudgetRule` L218 **互斥**选一条（user > dept > tenant > defaults；`defaults` 记在 `tenant` 维度、key 为租户 id，L234–L239）、`budgetPeriodKey` L244、`CheckBudget` L270（文件账本，锁 / 写失败放行）、`SettleBudget` L341、`RollbackBudget` L363、文件读写 L407–L512。
- `tracker.go`（572 行）：`GATEWAY_BUDGET_CONFIG_FILE` L90、`GATEWAY_BUDGET_USAGE_FILE` L94、`GATEWAY_REMOTE_BUDGET_CONFIG_URL` L109；远程快照为进程级单份，不带租户头。智能体月度配额 `cfg.Agents`、`RequestContext.AgentID` 必须保留（主计划 D4）。
- `check_request.go`（324 行）、`ledger.go`（401 行）、`remaining.go`（294 行）、`token_window.go`（73 行）。
- `internal/server/budget_integration.go`（120 行）：调用 `CheckBudget` / `SettleBudget` / `RollbackBudget`。
- `internal/gatewayinternal/http.go` 只有 `HTTPGet(url)`（L21），无自定义头版本。
- `internal/database`：`Open(cfg)`（`handle.go` L17）、`Rebind`、`IsMissingRelation`，网关审计已用它连库。
- 来源（`$DELIVERY_REPO`）：`apps/gateway/internal/quota/budget.go`（`selectPersonalBudgetRules` L273–L319、`selectBudgetTargets` L337–L385、`loadBudgetConfigForTenant` L130–L191、`CheckBudget` L475–L563）、`budget_database.go`（334 行，`checkBudgetDatabase` L44–L133、`finishBudgetDatabase` L231–L305）、`member_spending.go`、`budget_test.go`、`budget_database_test.go`、`internal/server/budget_integration.go`；迁移 `packages/db-schema/drizzle/0073_gateway_budget_usage.sql`、`drizzle-mysql/0047_gateway_budget_usage.sql`；schema `src/schema/gateway-budget.ts`、`src/mysql-schema/gateway-budget.ts`。相关提交 `f825bc97`、`1de19c06`、`4550c22e`、`a093bcc4`、`82c74afe`。

## 配置契约（v2，B9a 与 B9b 共用，不得各自发挥）

管理台发布、网关读取的 JSON：

```jsonc
{
  "version": 2,
  "updatedAt": "2026-10-20T00:00:00.000Z",
  "companyLimits": { "tokens": 0, "costUsd": 0 },      // 公司月度硬顶；0 = 不限；强制 block
  "defaults": { /* BudgetRule */ },                     // 每人默认（个人层兜底）
  "tenants": { "<tenantId>": { /* BudgetRule */ } },    // 组织共享上限；强制 block
  "departments": { "<deptId>": { /* BudgetRule */ } },  // 部门共享上限；强制 block
  "groups": { "<groupId>": { /* BudgetRule */ } },      // 用户组每人上限（个人层）
  "users": { "<userId>": { /* BudgetRule */ } },        // 个人特例（个人层）
  "userGroups": { "<userId>": ["<groupId>"] }           // 仅网关快照里有，由管理台按 IAM 成员关系生成
}
```

`BudgetRule = { unit: "cost_usd" | "tokens", period: "day" | "week" | "month", limit: number, warnThresholdPct?: number, action: "block" | "warn" | "fallback", fallbackModel?: string }`；`limit <= 0` 视为未设置。

**旧配置（没有 `version` 字段）兼容**（主计划 D3）：把旧 `defaults` 当作 `tenants[<当前租户>]`（组织共享上限）读取，个人层 `defaults` 视为未设置；`tenants` / `departments` / `users` 含义不变。

## 改动

### 1. 迁移（PG `0059` / MySQL `0033`）

- 新文件 `packages/db-schema/drizzle/0059_gateway_budget_ledger.sql`、`drizzle-mysql/0033_gateway_budget_ledger.sql`：照搬交付仓 `0073` / `0047` 的两张表：
  - `gateway_budget_usage`：`tenant_id`、`dimension`（`company|tenant|dept|user`）、`dimension_key`、`period`、`unit`（`tokens|cost_usd`）、`used_value numeric(38,18)`、`updated_at`；主键 `(tenant_id, dimension, dimension_key, period, unit)`。
  - `gateway_budget_reservations`：`receipt_id varchar(32)` 主键、`tenant_id`、`state`（`reserved|settled|rolled_back`）、`lines_json`、`actual_tokens`、`actual_cost_usd`、`created_at`、`updated_at`。
- Drizzle：`src/schema/gateway-budget.ts`、`src/mysql-schema/gateway-budget.ts`，两个 `index.ts` 导出。
- 同步 journal 与两份测试的计数 / 清单（B8 已把 PG 推到 58 条、MySQL 33 条、表数 69；本计划再各 +1、表数 +2 → 71。**以实际文件为准**，与 B8 结果对齐）。

### 2. 配置读取（`quota/budget.go`、`tracker.go`）

- `BudgetConfig` 增加 `Version int`、`CompanyLimits CompanyMonthlyLimits`（`Tokens int64`、`CostUSD float64`）、`Groups map[string]BudgetRule`、`UserGroups map[string][]string`；`loadErr` 用于标记读取失败。
- `normalizeBudgetConfig`：`period` 接受 `week`；无 `Version` 时按「旧配置兼容」转换。
- 远程读取：`gatewayinternal` 新增 `HTTPGetWithHeaders(url string, headers map[string]string)`；网关请求快照时带 `X-AgenticX-Tenant-Id: <租户>` 与 `Authorization: Bearer <GATEWAY_INTERNAL_TOKEN>`（沿用现有内部鉴权方式），按租户缓存 10 秒。读取失败：数据库模式 → 本次请求拒绝（`StorageError`）；文件模式 → 沿用现有放行并打 warn 日志（主计划 D1）。

### 3. 目标选择（替换互斥选择）

- 新函数 `selectBudgetTargets(cfg, ctx) []budgetTarget`（照搬交付仓 L337–L385 思路）：依次产出
  1. `companyLimits.tokens > 0` → dimension `company`、unit `tokens`、period `month`、action `block`
  2. `companyLimits.costUsd > 0` → 同上，unit `cost_usd`
  3. `tenants[tenantId]` → dimension `tenant`，action 强制 `block`
  4. `departments[deptId]` → dimension `dept`，action 强制 `block`
  5. 个人层 `selectPersonalBudgetRules`（照搬 L273–L319）：`users[userId]` > `userGroups[userId]` 对应 `groups` 中同 unit + period 取 limit 最小者（action 强制 `block`）> `defaults` → dimension `user`、key 为 `userId`；个人层 action 用规则自身（默认 `warn`）
- 旧 `selectBudgetRule` 删除或仅保留给测试过渡；`RequestContext` 若缺 `DeptID` / `UserID` 字段，从现有身份字段取，不新增鉴权逻辑。

### 4. 预留、结算、退款

- `BudgetDecision` 增加 `Receipt *BudgetReceipt`（`ID string`、`Lines []budgetReservationLine{Dimension, Key, Period, Unit, Reserved float64}`）。
- `CheckBudget(ctx, tokens, costUSD)`：对所有目标计算本次增量；任一目标 `used + delta > limit` 且 action 为 `block` → 拒绝（已预留的同次其他行不提交）；`warn` 目标超阈值 → 允许并带告警；`fallback` 沿用现有降级模型逻辑。
- **数据库模式**（`GATEWAY_BUDGET_BACKEND=database`，且 `internal/database` 能打开连接）：照搬 `checkBudgetDatabase`：目标按 `dimension|key|unit|period` 排序后逐行 `INSERT ... ON CONFLICT DO NOTHING`（MySQL 用 `INSERT IGNORE`）+ `SELECT ... FOR UPDATE`，判断后更新 `used_value`，插入 `gateway_budget_reservations(state='reserved', lines_json)`，同一事务提交。提交确认丢失时按收据退款一次。账本表不存在（`IsMissingRelation`）→ 拒绝并在日志提示需要迁移。
- **文件模式**（默认）：沿用现有文件账本与锁，但按多目标逐行累加；收据只在内存中携带行信息，不落盘。
- `SettleBudget(receipt, actualTokens, actualCost)` / `RollbackBudget(receipt)`：按收据行计算差额；数据库模式下按 `receipt_id` `FOR UPDATE`，`reserved → settled|rolled_back`，重复调用不重复记账（照搬 `finishBudgetDatabase`）。
- `server/budget_integration.go`：把收据从准入传到结算 / 回滚；上游失败回滚，成功按实际用量结算；回滚失败重试至多 2 次并记日志。

### 5. 余额读取

- `remaining.go`：部门 / 组织 / 公司剩余额度在数据库模式下读 `gateway_budget_usage`；文件模式读文件账本。只改预算相关读取，不动月度 Token 配额读取。

### 6. 保持不变

- 智能体月度配额（`cfg.Agents`）、RPM / TPM / 并发、请求次数、Token 窗口（默认关）、`poolScope` 共享月池、`gateway_budget_alerts` 告警写入。

## 剥离

交付仓预算文档里的双副本主机、机房对账步骤；「有 `DATABASE_URL` 就强制数据库账本」的判断（主仓只认显式 `GATEWAY_BUDGET_BACKEND=database`）；交付仓 Turn 宽限租约与 Token 窗口默认开启。

## In scope / Out of scope

- In：迁移与 schema、v2 读取与旧配置兼容、分层目标、双模式预留 / 结算 / 退款、收据、远程快照带租户头、余额读取。
- Out：管理台编辑与快照生成（B9b）；搜索 / 研究次数（B10）；组织与成员页展示（B12）。

## 验收

- AC-1：`quota/budget_test.go` 扩充（用例从交付仓 `budget_test.go` 摘取并适配）：
  - 公司硬顶、组织、部门、个人四层同时生效，任一 `block` 层超限即拒绝。
  - 个人层优先级：个人特例 > 组最严 > 默认；多组同周期取最严。
  - 旧配置（无 `version`）的 `defaults` 作为组织共享上限生效，个人层无默认。
  - `week` 周期 key 为 ISO 周。
  - 智能体月度配额用例保持通过。
- AC-2：新增 `quota/budget_database_test.go`：用 `DATABASE_URL` 可用时跑（不可用时 `t.Skip` 并说明），覆盖：同一事务多行预留；超限不留半截；收据结算幂等、重复回滚不重复记账；账本表缺失时拒绝。另加不依赖真实库的单测覆盖排序与 SQL 生成（参照交付仓写法）。
- AC-3：`server` 包里预算接线测试：上游失败回滚、成功结算、收据贯通。
- AC-4：`pnpm -C enterprise/packages/db-schema test`；`cd enterprise/apps/gateway && go test ./internal/quota/... ./internal/server/... ./internal/gatewayinternal/...`；`go test ./...` 不新增失败包。
- AC-5（验收方手工）：本机以 `GATEWAY_BUDGET_BACKEND=database` 启动网关并迁移；在管理台（B9b 完成后）设部门共享上限 1000 Token / 日，用该部门两个账号交替请求，累计超限后两人都被拦，库里 `gateway_budget_usage` 对应行累计正确；不设该变量重启，行为与改动前一致。

## 验收记录

- 2026-10-20 Opus 5.5 复核：AC-1–AC-3 `go test ./internal/quota/ ./internal/server/ ./internal/gatewayinternal/` 在干净环境下全部 ok；AC-4 `db-schema` 16/16，`go test ./...` 无新增失败包（`server` 包里 `TestNew_DisabledParentPolicyPackIsNotInheritedByChildPack` 只在加载了本地 `.env.local` 的终端里失败，原因是测试读到本地管理台地址去拉真实策略快照，清空环境变量后通过，与本计划无关）。
- 真实库：本地开发库为 MySQL，`db:migrate` 成功应用 `0033_gateway_budget_ledger`；`TestBudgetDatabaseURLReceiptLifecycle` 用 MySQL 连接跑通（预留、超限拒绝、结算、重复结算 / 回滚不重复记账）。实施方另在本机 PostgreSQL 上跑通同一用例。
- 与计划的差异（实施方说明，验收认可）：旧的个人月度 Token 配额与部门 Token 窗口不并入预算账本，仍走原计数器；无收据调用方保留原 `SettleBudget` / `RollbackBudget`；远程快照 404 视为空配置；公司月度硬顶 80% 发预警。
- AC-5 手工：待 B9b 完成后联调。
