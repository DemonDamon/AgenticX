---
name: Gateway 共享 Token 池配额与跨副本账本（部门/租户池硬限流）
overview: 为网关配额引入「共享池」语义与 PG 账本，使部门/租户可共享一份月度 Token 额度并在多副本网关间一致硬限流，补齐对标运营商 Token Plan「团队池」的核心缺口。不改动现有 RPM/TPM/并发限流与 user 维度旧行为。
todos:
  - id: t1-schema
    content: 新增 PG 表 gateway_quota_pool_usage（原子计数）与 gateway_quota_ledger（append-only 流水），生成 drizzle 迁移
    status: completed
  - id: t2-pool-counter
    content: gateway 新增 quota/ledger.go，定义 PoolCounter 接口 + PGPoolCounter + LocalPoolCounter（回落现状）
    status: completed
  - id: t3-rule-pool-scope
    content: Rule 增加 PoolScope 字段；CheckAndAdd/Rollback 在命中共享池时按 pool key 计数，否则走 user 旧路径
    status: completed
  - id: t4-billing-wire
    content: billing.Service.ReserveContext/Settle 透传 pool 维度到 PoolCounter；失败 Refund 写 ledger
    status: completed
  - id: t5-admin-config
    content: token-quota 配置 JSON 支持 poolScope；admin 配额页可为部门/租户设「共享池」并显示池用量
    status: completed
  - id: t6-smoke
    content: 冒烟测试覆盖共享池累计、超池拦截、并发无超扣、Refund 恢复、回落 local 后端
    status: completed
isProject: false
---

# Gateway 共享 Token 池配额与跨副本账本

**Plan-Id**: 2026-06-07-gateway-shared-quota-pool-ledger
**Plan-File**: `.cursor/plans/2026-06-07-gateway-shared-quota-pool-ledger.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**调研依据**: `research/codedeepresearch/new-api/new-api_proposal.md`、`new-api_agenticx_gap_analysis.md`（G-E3 / G-E4，F1–F6）

## 背景 / 现状（已直读核验）

- `enterprise/apps/gateway/internal/quota/tracker.go:114-187` 的月度 Token 累计键为 `cacheKey(userID, month)`（L442），**与 dept/tenant 无关**。
- `selectRule`（`tracker.go:340-355`）可命中 dept 规则，但只是把同一 limit 套到**每个成员各自计数**，**没有「部门共享一份额度」语义**。
- 用量持久化为单机 JSON 文件 `../../.runtime/gateway/quota-usage.json`（`tracker.go:110-112`）+ flock，多副本各算各的（G-E4）。
- `billing.Service.Reserve/Settle/Rollback`（`billing/service.go:43-90`）均以 `userID` 调 tracker。
- 配额配置为 PG 单行整包 JSON `enterprise_runtime_token_quotas.config`（`runtime-config.ts:60-65`）。
- RPM/TPM/并发**已**多维（`check_request.go:233-244` `rateKey` pat→user→dept→tenant），**本 plan 不动**。

**目标**：新增「共享池」语义 + PG 账本，使「部门/租户一个月共 N tokens 全员分用」可硬限流，且多副本一致。

## 需求

- FR-1: `quota.Rule` 新增可选字段 `PoolScope`（取值 `""`|`dept`|`tenant`）。为空时保持现有 user 维度行为（零回归）。
- FR-2: 当命中规则 `PoolScope != ""` 时，月度 Token 累计改用 **pool key** = `tenant_id:scope_type:scope_id:month`（dept→deptId，tenant→tenantId），实现成员共享。
- FR-3: 新增 `PoolCounter` 抽象，两实现：
  - `PGPoolCounter`：以 `gateway_quota_pool_usage` 做原子 `INSERT ... ON CONFLICT DO UPDATE SET used_total = used_total + :delta RETURNING used_total` 作为单一事实源；每次 reserve/settle/refund 追加 `gateway_quota_ledger` 流水。
  - `LocalPoolCounter`：复用现有 JSON 文件逻辑，供无 PG 的 dev/单机回落。
- FR-4: 后端选择由环境变量控制：`GATEWAY_QUOTA_POOL_BACKEND`（`local`默认 | `pg`）；总开关 `GATEWAY_QUOTA_POOL`（`off`默认 | `on`）。`off` 时完全等价现状。
- FR-5: `billing.Service` 的 Reserve/Settle/Rollback 在共享池模式下作用于 pool key（经 `RequestContext` 已含 tenant/dept/user/pat，无需改签名外新增参数）。
- FR-6: admin 配额配置 JSON 允许在 `departments[*]` / 顶层 tenant 默认项写 `poolScope`；admin 配额页展示「共享池」开关与当前池已用/上限。
- NFR-1: PG 计数走单条原子 upsert，避免读改写竞态；P95 配额检查延迟增量 < 8ms（单 region）。
- NFR-2: PG 不可用时按 `Rule.Action` 决策：`block` 模式 fail-closed（拒绝并返回明确错误），非 block fail-open；与现有 `CheckAndAdd` 行为一致（`tracker.go:122-133,162-176`）。
- NFR-3: `GATEWAY_QUOTA_POOL=off` 时不得新增任何 PG 访问或行为变化。
- AC-1: dept-A 配 `poolScope=dept, monthlyTokens=1,000,000`；两个成员各消耗 600k，第二人第二次请求被拦截（池已满），证明共享。
- AC-2: 同场景 `GATEWAY_QUOTA_POOL_BACKEND=pg`，两个网关副本各发请求，池累计 = 两副本之和，超池一致拦截。
- AC-3: 请求失败触发 Refund，pool used 回退，后续请求恢复放行；ledger 出现 reserve+refund 两条流水。
- AC-4: `poolScope` 未配置的规则行为与改动前逐字节一致（回归用例对比）。

## 改动范围（严格，遵守 no-scope-creep）

### 新增
1. `enterprise/packages/db-schema/src/schema/quota-pool.ts`
   - `gatewayQuotaPoolUsage`：PK(`tenant_id`,`scope_type`,`scope_id`,`period`)，列 `used_total bigint`、`updated_at`。
   - `gatewayQuotaLedger`：`id`、`tenant_id`、`scope_type`、`scope_id`、`period`、`event`(reserve|settle|refund)、`delta_tokens bigint`、`request_id`、`created_at`；索引(`tenant_id`,`scope_type`,`scope_id`,`period`)。
   - 在 `db-schema/src/schema/index.ts` 导出。
2. `enterprise/apps/gateway/internal/quota/ledger.go`
   - `type PoolCounter interface { Add(poolKey PoolKey, delta int64) (int64, error); Current(poolKey PoolKey) (int64, error) }`
   - `PGPoolCounter`（用现有 gateway DB 连接/`gatewayinternal` 风格）与 `LocalPoolCounter`（包装现有 JSON 读写）。
   - `poolKeyFor(rule Rule, ctx RequestContext, month string) (PoolKey, bool)`。

### 修改
3. `enterprise/apps/gateway/internal/quota/tracker.go`
   - `Rule` 增 `PoolScope string \`json:"poolScope,omitempty"\``（含 `sanitizeRule` 白名单校验：仅 `dept`/`tenant`）。
   - `CheckAndAdd` / `Rollback`：命中共享池则走 `PoolCounter`，否则保持现有 userID 路径不变。
   - `Tracker` 持有 `poolCounter PoolCounter` + 开关字段，`NewTracker` 按 env 初始化。
4. `enterprise/apps/gateway/internal/billing/service.go`
   - `ReserveContext`/`Settle`/`Rollback` 在共享池模式下传递 pool 维度（通过 `RequestContext`，必要时把 Settle/Rollback 签名从 `userID` 改为 `RequestContext` 重载，保留旧方法 wrapper 防破坏调用方）。
5. `enterprise/apps/admin-console/src/lib/token-quota-store.ts` + `src/app/metering/quota/page.tsx`
   - 配置 schema 允许 `poolScope`；页面部门行增「共享池」开关与池用量只读展示（读 t7 of Plan B 之前可先用占位「-」，池用量精确展示归 Plan B）。

### 不动
- RPM/TPM/并发限流（`check_request.go` rateKey 逻辑）。
- 策略引擎、JWT/PAT、计价计算、审计链。
- `agenticx/` Python SDK、Machi Desktop（本 plan 与之无关）。

## 关键数据结构

```go
// ledger.go
type PoolKey struct {
    TenantID, ScopeType, ScopeID, Period string // ScopeType: dept|tenant
}
```

```sql
-- gateway_quota_pool_usage 原子累计
INSERT INTO gateway_quota_pool_usage (tenant_id, scope_type, scope_id, period, used_total, updated_at)
VALUES ($1,$2,$3,$4,$5, now())
ON CONFLICT (tenant_id, scope_type, scope_id, period)
DO UPDATE SET used_total = gateway_quota_pool_usage.used_total + EXCLUDED.used_total, updated_at = now()
RETURNING used_total;
```

## 验证步骤

1. 迁移：`pnpm -C enterprise db:generate && pnpm -C enterprise db:migrate`（本地需先 `start-dev-with-infra.sh` 起 PG）。
2. 单测：`cd enterprise/apps/gateway && go test ./internal/quota/... ./internal/billing/... -count=1`（AC-1/3/4 + fail-closed/fail-open）。
3. 集成（PG）：起两个 gateway 进程指向同一 PG，脚本并发打满 dept 池验证 AC-2，SQL 查 `gateway_quota_pool_usage` 与 `gateway_quota_ledger` 对账。
4. 回归：`GATEWAY_QUOTA_POOL=off` 跑既有 quota 测试全绿。
5. admin typecheck：`pnpm -C enterprise exec turbo run typecheck --filter=admin-console`。

## 回滚

- `GATEWAY_QUOTA_POOL=off`（默认）即停用全部新逻辑，回到 user 维度旧行为。
- `GATEWAY_QUOTA_POOL_BACKEND=local` 可在保留共享池语义的同时退回单机文件。
- 新表为附加，不改既有表结构；删除配置中的 `poolScope` 即恢复每成员限额。

## 与后续 plan 的接口约定

- Plan B（剩余可视化）读取 `gateway_quota_pool_usage` + 配置上限计算 remaining，**不重复造计数**。
- Plan C（套餐 SKU）发布快照时把套餐额度落为某 scope 的 `poolScope`+`monthlyTokens`，复用本 plan enforcement。
