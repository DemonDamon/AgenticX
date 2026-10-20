# 能力回流 B9b：管理台分层预算配置与网关快照

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: —
Sibling: B9a（网关侧；配置契约见 B9a「配置契约（v2）」一节，本计划严格按该契约读写）

## 目标

管理员能在管理台设置公司月度硬顶、组织共享上限、部门共享上限、每人默认上限，并保存为 v2 配置；两人同时编辑时后保存的一方得到冲突提示而不是静默覆盖；网关拉取的快照里带上用户组规则与成员归属。用户组上限与个人特例的编辑入口放在「组织与成员」页（B12），本计划只在接口层支持。

## 现状（已核实）

- 存储：`enterprise/apps/admin-console/src/lib/budget-store.ts`（方言分发）→ `lib/db-stores/postgresql/budget-store.ts`（128 行）与 `lib/db-stores/mysql/budget-store.ts`。类型 `BudgetRule.period` 只有 `day | month`；`BudgetConfig` 只有 `defaults / tenants / departments / users`；`normalizeBudget` 每次保存把 `updatedAt` 重置为当前时间；`buildBudgetSnapshotForGateway()` 直接返回配置；租户取 `DEFAULT_TENANT_ID`。
- 接口：`src/app/api/metering/budget/route.ts`（39 行，`GET` 返回 `{budget}`，`?view=alerts`；`PUT` 整包保存，无冲突检测）；`src/app/api/internal/budget-snapshot/route.ts`（内部鉴权，无租户头）。
- 界面：`src/app/metering/quota/page.tsx`（833 行）里的预算区（类型 L80–L118，`BudgetRuleEditor` L304，状态 L380–L408）按「默认 / 部门 / 用户」三段编辑，周期只有日 / 月。
- 用户组：表与接口已存在（`/api/admin/user-groups`，组成员在 `enterprise_user_groups` / `_members`）。
- 共享配置包：`enterprise/packages/config/src/index.ts` 没有预算解析函数。
- 来源（`$DELIVERY_REPO`）：`apps/admin-console/src/lib/db-stores/budget-config.ts`（类型、`budgetGatewaySnapshot`、规范化）、`src/app/api/metering/budget/route.ts`（含 `expectedUpdatedAt` 冲突 409）、`src/app/api/internal/budget-snapshot/route.ts`（租户头）、`src/components/CompanyMonthlyLimitsCard.tsx`、`src/lib/company-monthly-limits.ts`；`packages/config/src/member-spending-limit.ts`（`memberSpendingRules` L26–L48）及测试。交付仓 `BudgetConfig` 里的 `sessionTokenLimits` / `desktopCapabilityPolicy` **不搬**（主仓桌面策略是独立表）。

## 改动

### 1. 共享解析（`packages/config`）

- 新文件 `src/member-spending-limit.ts`（+ `__tests__/member-spending-limit.test.ts`）：照搬 `memberSpendingRules`，按 B9a 契约解析一个成员的个人层生效规则（个人特例 > 组最严 > 每人默认），返回 `{ rules, source: "user" | "group" | "default" | "none" }`。供 B12 展示「生效额度」与来源。
- `src/index.ts` 导出。

### 2. 存储（`lib/db-stores/{postgresql,mysql}/budget-store.ts`）

- 类型改为 B9a 契约：加 `version: 2`、`companyLimits`、`groups`；`period` 加 `week`。两种方言实现保持一致。
- `normalizeBudget`：
  - 无 `version` 的旧配置 → 按 D3 转换：旧 `defaults`（`limit > 0`）移到 `tenants[<当前租户>]`，`defaults` 置为未设置（`limit: 0`）。
  - `companyLimits` 非负整数 / 非负数；缺省 `{ tokens: 0, costUsd: 0 }`。
  - `tenants` / `departments` 的 `action` 保存为 `block`（D2）。
  - 读出时**不**重置 `updatedAt`（用库里的值），只有保存时更新。
- `setBudgetConfig(input, { expectedUpdatedAt? })`：传了 `expectedUpdatedAt` 且与库中不同 → 抛 `BudgetConflictError`。
- `buildBudgetSnapshotForGateway(tenantId?)`：返回 v2 配置 + `userGroups`（照搬 `budgetGatewaySnapshot`：只为 `groups` 里 `limit > 0` 且仍存在的组生成成员 → 组映射；成员 id 去空格去重排序）。组与成员从现有用户组存储读取。

### 3. 接口

- `api/metering/budget/route.ts` `PUT`：接受 `expectedUpdatedAt`；冲突返回 `409 {code:"40900", message:"预算刚被其他管理员修改，请刷新后重试"}`。允许局部字段（`companyLimits` / `defaults` / `tenants` / `departments` / `groups` / `users`）：服务端读当前配置 → 只替换传入的顶层字段 → 保存。
- `api/internal/budget-snapshot/route.ts`：读 `X-AgenticX-Tenant-Id`，有则用该租户、无则用 `DEFAULT_TENANT_ID`；返回 `buildBudgetSnapshotForGateway(tenantId)`。

### 4. 界面（`/metering/quota` 预算区，最小改动）

- 「默认」改名「每人默认上限」，说明「没有个人特例或用户组上限的成员使用这条」。
- 新增「公司月度上限」卡片（照搬 `CompanyMonthlyLimitsCard` 的输入：Token 与美元两个数，0 为不限；说明「整个公司每月合计，达到即停止请求」）。
- 新增「组织共享上限」（`tenants[<当前租户>]`）编辑块；「部门」改名「部门共享上限」，说明「部门内所有人合计」；这两段的动作选择固定为「停止请求」且不可改。
- 「用户」改名「个人特例」，保留现有编辑能力。
- 周期下拉加「每周」。
- 保存时带 `expectedUpdatedAt`，收到 409 时用现有 toast 提示并重新加载。
- 不做用户组上限编辑（B12）。

## In scope / Out of scope

- In：`packages/config` 个人层解析、存储 v2 与旧配置转换、冲突检测、快照带租户与用户组、`/metering/quota` 预算区最小改动。
- Out：网关账本（B9a）；组织与成员页上的组 / 个人上限编辑（B12）；次数上限（B10）；`/metering/plans`、`/metering/split`。

## 验收

- AC-1：`packages/config/src/__tests__/member-spending-limit.test.ts`：个人特例优先；多组取最严；无组无特例回落默认；全无为 `none`。
- AC-2：新增 `apps/admin-console/src/lib/__tests__/budget-config-v2.test.ts`：旧配置 `defaults` → `tenants[tid]`；部门 / 组织 action 强制 `block`；`week` 合法；读出不重置 `updatedAt`；快照 `userGroups` 只含有规则的组、去重排序。
- AC-3：扩充 / 新增 `src/app/api/metering/budget/__tests__/route.test.ts`：局部字段更新不清空其他字段；`expectedUpdatedAt` 不一致 → 409；`src/app/api/internal/budget-snapshot/__tests__/route.test.ts`：有 / 无租户头、未授权 401。
- AC-4：`pnpm -C enterprise/packages/config test && typecheck`；`pnpm -C enterprise/apps/admin-console typecheck && test && lint`。
- AC-5（验收方手工）：`/metering/quota` 能设公司月度上限、组织共享、部门共享、每人默认、个人特例，刷新后回显；两个浏览器标签同时改，后保存的出现冲突提示；`curl` 内部快照接口能看到 `version: 2` 与 `userGroups`。

## 验收记录

- 2026-10-20 Opus 5.5 复核（自动部分）：AC-1 / AC-4 配置包 45 项、管理台 53 文件 214 项通过，两端 typecheck 通过，lint 0 error；AC-2 / AC-3 路由与存储用例通过。实施方偏差（个人层来源只用 `user`；旧配置迁移时保留当前租户已有的正数组织上限；用户组规则落库时不改写动作；非法租户头返回 400；快照直读用户组存储）验收认可。
- AC-5 手工（浏览器 + 本地 MySQL）：`/metering/quota` 预算标签显示公司月度、组织共享、部门共享、每人默认、个人特例五块，组织 / 部门动作固定为停止请求；添加部门共享上限（每日 1000 Token）保存后接口回读一致、动作为 `block`；用过期 `expectedUpdatedAt` 保存返回 409「预算刚被其他管理员修改，请刷新后重试」；带租户头拉取内部快照得到 `version: 2` 与该部门规则。
- 与 B9a 联调：网关以 `GATEWAY_BUDGET_BACKEND=database` 启动，同部门成员连续请求，第 5 次返回 `42901 policy:budget:exceeded`；`gateway_budget_usage` 部门行累计 1220 Token（准入按预估、结算按实际，最后一次越过上限属预期），4 张收据为 `settled`，被拒请求未留预留记录。测试规则已撤销。
- 验收中发现并修复的卡点：本地开发与 compose 部署都没有配置 `GATEWAY_REMOTE_BUDGET_CONFIG_URL`，管理台保存的预算到不了网关（原有问题，会让本计划与 B9a 在部署中不生效）。修复：`scripts/bootstrap.sh` 默认生成该地址并写入 `.env.local`；`scripts/start-dev.sh` 对已有 `.env.local` 按模型服务地址推导；`deploy/docker-compose/gateway_test.yml` 两个网关副本增加可选的 `GATEWAY_REMOTE_BUDGET_CONFIG_URL` 与 `GATEWAY_BUDGET_BACKEND`。
- 原有界面问题记入主计划 §8：「每人默认」「个人特例」的动作下拉直接显示英文 `warn`；部门 / 个人需手填 ID（B12 在组织与成员页解决）。
