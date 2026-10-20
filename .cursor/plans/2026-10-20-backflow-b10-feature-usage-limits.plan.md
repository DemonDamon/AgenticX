# 能力回流 B10：联网搜索与深度研究的次数上限

Planned-with: Opus 5.5
Suggested-Impl-Model: Grok 4.7
Acceptance-Model: Opus 5.5
Parent: `.cursor/plans/2026-10-20-enterprise-capability-backflow.plan.md`
Depends-on: B9b（`packages/config/src/index.ts` 归属顺序 B9b → B10）；迁移编号接在 B9a 之后

## 目标

管理员能给联网搜索（按实际调用搜索服务的次数计）与深度研究（按发起的研究次数计）设日 / 周 / 月次数上限，分三层同时生效：

- 个人层：个人特例 > 所在用户组里最严的一条 > 按角色的默认 > 全员默认；
- 部门共享：部门内所有人合计；
- 公司共享：全公司合计。

任何一层用完，本次搜索或研究被拒，员工看到清楚的提示；计数存储不可读时拒绝（不能让一个人无限用掉共享额度）。能力包仍决定「能不能用」，本计划只管「能用几次」。

## 现状（已核实）

- 搜索唯一入口：`enterprise/apps/web-portal/src/lib/web-search/providers.ts` L282 `executeWebSearch`。联网搜索 `lib/web-search/tool-loop.ts` L782、深度研究 `lib/deep-research/orchestrator.ts` L754 都通过 `deps.executeSearch ?? executeWebSearch` 调用（可注入）。
- 车道入口：`src/app/api/chat/completions/route.ts` 深度研究 L232、联网搜索 L280。
- 研究建 run：`lib/deep-research/run-store.ts` 内存实现 `create` L225、SQL 实现 `create` L362。
- 能力授权：`lib/capability-packs-reader.ts` L248 `isPlatformFeatureAllowedForUser`（已在 completions 使用，保留）。
- 额度配置存储：管理台 `enterprise_runtime_token_quotas`（`GET/PUT /api/metering/quota`，无 `featureUsage` 字段）。
- 用户组成员：`enterprise_user_groups` / `_members`（主仓已有）；角色码可从现有用户信息读取。
- 无计数表、无 `/api/workspace/feature-usage`、`packages/config` 无次数解析。
- 来源（`$DELIVERY_REPO`）：`packages/config/src/feature-usage-limits.ts`（`resolveFeatureUsageLimits` L193–L227、`resolveFeatureUsagePolicies` L230–L243、`FEATURE_USAGE_ROLE_PRECEDENCE`、`FEATURE_USAGE_FALLBACK_ROLE`）及测试；门户 `apps/web-portal/src/lib/feature-usage/{gate,counters,config-reader,errors,subject}.ts`、`src/lib/use-feature-usage.ts`、`src/app/api/workspace/feature-usage/route.ts`、`src/components/FeatureUsageNotice.tsx` 及测试；管理台 `src/app/api/metering/quota/route.ts`（`featureUsage` 校验）、`src/app/api/metering/feature-usage/route.ts`；迁移 `drizzle/0071_enterprise_feature_usage_daily.sql` + `0074_feature_usage_shared.sql`、MySQL `0045` + `0048`；schema `src/schema/feature-usage.ts`。提交 `7c8250ee`、`edd83fab`、`71eb6d0b`。

## 配置契约（存在 `enterprise_runtime_token_quotas.config.featureUsage`）

```jsonc
"featureUsage": {
  "search_provider_calls": {
    "defaults": { "role": { "<roleCode>": { "day": 0, "week": 0, "month": 0 } } },
    "groups": { "<groupId>": { "day": 0, "week": 0, "month": 0 } },
    "users": { "<userId>": { "day": 0, "week": 0, "month": 0 } },
    "departments": { "<deptId>": { "day": 0, "week": 0, "month": 0 } },
    "company": { "day": 0, "week": 0, "month": 0 }
  },
  "deep_research_runs": { /* 同上 */ }
}
```

数值为正整数才生效，`0` 或缺省 = 该窗口不限。结构以交付仓 `feature-usage-limits.ts` 的类型为准；若与上面有出入，以交付仓为准并在本文件「验收记录」注明。

## 改动

### 1. 迁移（PG `0060` / MySQL `0034`）

- 新文件 `drizzle/0060_enterprise_feature_usage.sql`、`drizzle-mysql/0034_enterprise_feature_usage.sql`：一次建两张表（合并交付仓 `0071` + `0074` 的最终形态，不写回填历史的语句）：
  - `enterprise_feature_usage_daily`：`tenant_id`、`feature`、`user_id`、`dept_id`（可空，报表用）、`usage_day`（UTC 日期）、`used int`；主键 `(tenant_id, feature, user_id, usage_day)`。
  - `enterprise_feature_usage_shared_daily`：`tenant_id`、`feature`、`scope`（`company|department`）、`scope_id`、`usage_day`、`used int`；主键 `(tenant_id, feature, scope, scope_id, usage_day)`。
- Schema、两个 `index.ts` 导出、journal、两份迁移测试的计数与清单，以 B9a 完成后的实际数字 +1 / 表数 +2 为准。

### 2. 共享解析（`packages/config`）

- 新文件 `src/feature-usage-limits.ts`（+ test，照搬）：类型 `MeteredFeature = "search_provider_calls" | "deep_research_runs"`、`FeatureUsageConfig`、`FeatureUsagePolicies`、`FeatureUsageState`；`resolveFeatureUsagePolicies(config, subject)` 返回个人层（含来源 `user|group|default`）与部门 / 公司共享层的各窗口上限。`index.ts` 导出。

### 3. 门户计数与准入

- 新目录 `src/lib/feature-usage/`（照搬并适配主仓数据库与用户组读取）：
  - `subject.ts`：从会话取 `tenantId / userId / deptId`，读角色码与用户组 id。
  - `config-reader.ts`：只读 `featureUsage` 命名空间；读失败抛 `FeatureUsageUnavailableError`。
  - `counters.ts`：`reserveFeatureUsage(subject, feature, policies)`：一个事务里按日 / 周 / 月窗口（周、月由日表按日期范围求和）检查个人、部门、公司三层，全部未满才各 +1；PG / MySQL 两套。
  - `gate.ts`：`readFeatureUsageState`（展示用，取剩余最少的窗口）、`admitFeatureUsage`、`researchUsagePolicy`。
  - `errors.ts`：`FeatureUsageLimitError`（用完）、`FeatureUsageUnavailableError`（计数不可读）。抛错而不是返回失败，避免被搜索流程当成「搜索服务故障」而切换服务商。
- **不搬** `search-admission.ts` 里的租户日调用配额（主计划 D9）：搜索准入只做「预检 → 预留」两步。
- 接线（不改 `orchestrator.ts`、`tool-loop.ts`）：在 `completions/route.ts` 构造车道参数时，把 `executeSearch` 注入为带计数的包装：每次真正调用搜索服务前 `admitFeatureUsage` + `reserveFeatureUsage("search_provider_calls")`，失败抛上面的错误；车道把这两种错误转换为给用户的提示（「今天的联网搜索次数已用完」/「暂时无法确认搜索次数，请稍后再试」），不再继续调用搜索。
- 深度研究：`run-store.ts` 的 `create` 增加可选参数 `usage`，SQL 实现里与插入 run 同一事务调用 `reserveFeatureUsage("deep_research_runs")`；内存实现做等价计数。续跑、恢复不传 `usage`，不重复扣。`completions/route.ts` 深度研究车道建 run 时传入。
- 接口 `src/app/api/workspace/feature-usage/route.ts`：返回当前用户两项功能的剩余次数（身份只来自会话）。
- 前端：`src/lib/use-feature-usage.ts`（拉取、用后刷新，不轮询）；`src/components/FeatureUsageNotice.tsx`：搜索用完时在输入区上方显示可关闭提示；深度研究按钮旁显示「本月剩余 N 次」类小标签（有上限时才显示）。文案进 `messages/{zh,en}.json`（定点插入）。

### 4. 管理台接口

- `src/app/api/metering/quota/route.ts`：`PUT` 接受并校验 `featureUsage`（结构同契约；负数、非整数拒绝 400）；`GET` 原样返回。保存沿用现有 quota 存储，只增加这个命名空间，不改 Token 配额字段。
- 新接口 `src/app/api/metering/feature-usage/route.ts`（`requireAdminScope(["metering:read"])`）：按日期范围、部门、用户聚合两项功能的使用次数，供 B12 展示。
- 编辑界面放 B12（组织与成员页）；本计划在 `/metering/quota` 页**不加**界面。

## In scope / Out of scope

- In：两张计数表、配置解析、门户计数与准入、研究同事务计数、门户剩余次数接口与提示、管理台配置校验与用量查询接口。
- Out：租户日调用配额；搜索服务池 / 每轮调用预算等交付仓搜索栈其他改动；次数上限编辑界面（B12）；桌面端搜索接口。

## 验收

- AC-1：`packages/config/src/__tests__/feature-usage-limits.test.ts`：个人特例 > 组最严 > 角色默认 > 全员默认；部门、公司共享层与个人层并存。
- AC-2：`apps/web-portal/src/lib/feature-usage/__tests__/{gate,counters,subject}.test.ts`：三层任一用完即拒；计数不可读抛 `FeatureUsageUnavailableError`；同一事务内全部 +1 或全部不加；周 / 月窗口按日表求和。
- AC-3：completions 车道测试：搜索次数用完时返回提示且不调用搜索服务；研究次数用完时不建 run；续跑不扣次数。
- AC-4：管理台 `api/metering/quota/__tests__/route.test.ts` 扩充 `featureUsage` 校验；`api/metering/feature-usage/route.test.ts`。
- AC-5：`pnpm -C enterprise/packages/db-schema test`；`pnpm -C enterprise/packages/config test && typecheck`；`pnpm -C enterprise/apps/web-portal typecheck && test`（除基线 10 条外无新增失败）；`pnpm -C enterprise/apps/admin-console typecheck && test`。
- AC-6（验收方手工）：用接口把某员工深度研究设为每日 1 次、所在部门搜索设为每日 3 次；该员工第二次研究被拒并有提示；同部门两人合计第 4 次搜索被拒；`/api/workspace/feature-usage` 返回的剩余次数与实际一致。

## 验收记录

- 2026-10-20 第一次派发的实施代理中途停止且未落代码，已重新派发。
- Opus 5.5 复核（自动部分）：AC-1 配置包 70 条通过；AC-2 / AC-3 / AC-4 门户与管理台相关测试通过（管理台 54 文件 225 条）；AC-5 db-schema 16 条通过（PG 60 条 journal、62 个 SQL、73 张表；MySQL 35 条）；门户类型错误仍为 26 条，`store.ts` 与 `run-store.test.ts` 两条原有错误只是行号下移。
- 验收发现并修复的上线风险：计数表未迁移时，即使没有配置任何上限，每次真实搜索的计数写入失败都会被当作「计数不可读」而拒绝，深度研究的计数写在建 run 事务里，会使研究整体无法发起。新增 `featureUsageCountingRequired`：三层都未配置上限且计数表不存在时跳过计数并告警一次；配置了任一上限或探测本身出错仍拒绝。新增 `counting-required.test.ts`（4 条），并在未迁移的本地 MySQL 上实测搜索计数被跳过。
- AC-6 手工（本地 MySQL，迁移后）：经管理台接口为「平台研发部」设联网搜索每日 3 次；三轮联网对话后个人 / 部门 / 公司三层各记 3 次，门户剩余次数接口显示剩余 0、来源为部门；第 4 轮返回 429「今日联网搜索次数已用完（部门共享上限 3 次），请联系管理员调整」，同会话普通对话仍为 200。测试上限已撤销。
- 与计划的差异（实施方说明，验收认可）：配置字段沿用交付仓的 `searchCallsPerDay` / `deepResearchRunsPerDay` 等扁平写法；路由在进入车道前先做准入（编排器与搜索循环会吞掉内部错误），真正调用搜索前再预留一次；`normalizeQuota` 保存时保留 `featureUsage`，只改 Token 配额不会清掉次数上限。
- 待办：`FeatureUsageNotice` 挂载到 `MachiChatView` 需等 B4 完成该文件改动后补上；预检通过后、调用前被他人用完的竞态，用户看到的是搜索降级而非额度文案（记入主计划 §8）。
