---
name: 企业 Token 套餐 SKU 与快照下发（配置型套餐 → 配额映射）
overview: 提供「套餐 SKU 定义 + 绑定（租户/部门/用户）+ 周期滚动」的配置层，发布后映射为共享池配额规则供网关 enforcement，对齐运营商 Token Plan 的档位化售卖表述。本期为「配置型套餐」，不含支付/出账/发票（属另案 G-1）。
todos:
  - id: t1-schema
    content: 新增 enterprise_quota_plans 与 enterprise_quota_plan_assignments 两表 + 迁移
    status: completed
  - id: t2-plan-crud
    content: admin 套餐 SKU CRUD API + 列表/编辑页（名称/月度 Token/RPM/TPM/模型范围/状态）
    status: completed
  - id: t3-assign
    content: 套餐绑定 API（assign 到 tenant/dept/user）+ 绑定管理 UI
    status: completed
  - id: t4-publish-map
    content: 发布时把套餐额度映射写入 token-quota 配置（poolScope+monthlyTokens），复用 Plan A enforcement 与网关快照
    status: completed
  - id: t5-period-rollover
    content: 周期滚动（按绑定 period 重置共享池计数），归档上周期 ledger
    status: completed
  - id: t6-smoke
    content: 冒烟覆盖创建→绑定→发布→网关生效→次周期重置→升档仅新周期生效
    status: completed
isProject: false
---

# 企业 Token 套餐 SKU 与快照下发

**Plan-Id**: 2026-06-07-enterprise-quota-plan-sku-snapshot
**Plan-File**: `.cursor/plans/2026-06-07-enterprise-quota-plan-sku-snapshot.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**依赖**: 2026-06-07-gateway-shared-quota-pool-ledger
**调研依据**: `new-api_proposal.md` P4「套餐即配置」；`AgenticX-Token-Plan-对标方案.md` 方案 A / S-1

## 背景 / 现状（已直读核验）

- new-api 有 Subscription/TopUp/Redemption 等 C 端商业化（`model/subscription.go` 等）；Enterprise **无套餐/订阅/账户表**（F9）。
- Enterprise 已有「整包 JSON 配置 + 网关快照拉取」成熟模式（`enterprise_runtime_*` + `GATEWAY_REMOTE_*`）。
- 客户诉求是「档位化套餐」可对外表述；但**对客出账/发票/支付**明确不在本期（Hechuang G-1）。

**目标**：用「套餐即配置快照」打通 档位定义 → 绑定 → 映射为共享池配额，**不触碰支付**。

## 需求

- FR-1: 套餐 SKU（`enterprise_quota_plans`）字段：`id`、`tenant_id`、`name`、`monthly_tokens`、`rpm`、`tpm`、`max_concurrency`、`models`(jsonb 允许模型白名单)、`period`(month|week)、`status`(draft|active|archived)、审计列。
- FR-2: 绑定（`enterprise_quota_plan_assignments`）：`plan_id`、`scope_type`(tenant|dept|user)、`scope_id`、`period_start`、`period_end`、`status`。
- FR-3: admin 套餐 CRUD + 绑定管理 UI；仅 `metering:manage` 可写，`metering:read` 可读。
- FR-4: **发布映射**：套餐绑定生效时，把该 scope 的额度写入 token-quota 配置 JSON 对应项（dept/tenant→`poolScope`+`monthlyTokens`+RPM/TPM；user→user 规则），由网关现有快照拉取生效。**不新建第二条 enforcement 路径**。
- FR-5: **周期滚动**：到达 `period_end` 时重置该 scope 的共享池计数（清零或起新 period key），归档上周期 `gateway_quota_ledger`；新周期按绑定额度重新计量。
- FR-6: 升档/改绑：仅对**新周期或显式生效时间**生效，不得在周期中途 silently 改变已用/剩余（与 P4 invariant 一致）。
- NFR-1: 套餐表与映射解耦——映射产物仍是既有 token-quota 配置，网关无需感知「套餐」概念。
- NFR-2: 周期滚动为幂等任务（重复执行不重复清零）。
- AC-1: 创建「团队 10M/月」套餐 → 绑定 dept-A → 发布；网关对 dept-A 生效 1,000 万共享池（经 Plan A）。
- AC-2: dept-A 当月用 300 万，次月周期滚动后剩余回到 1,000 万；ledger 出现归档分隔。
- AC-3: 月中把 dept-A 升档到 20M，当月剩余不被立即改写；新周期起按 20M。
- AC-4: draft 状态套餐不进入任何映射；archived 套餐解除绑定。

## 改动范围（严格）

### 新增
1. `enterprise/packages/db-schema/src/schema/quota-plans.ts`：`enterpriseQuotaPlans` + `enterpriseQuotaPlanAssignments`，导出至 `index.ts`。
2. `enterprise/apps/admin-console/src/app/api/metering/plans/route.ts`（列表/创建）+ `plans/[id]/route.ts`（读/改/删）+ `plans/[id]/assign/route.ts`（绑定）+ `plans/[id]/publish/route.ts`（发布映射）。
3. `enterprise/apps/admin-console/src/app/metering/plans/page.tsx`：套餐列表/编辑/绑定 UI。
4. `enterprise/apps/admin-console/src/lib/quota-plans-store.ts`：套餐/绑定 CRUD + 发布映射 + 周期滚动逻辑。
5. 周期滚动触发：复用 enterprise 既有定时/cron 机制（若无则提供手动 `POST /api/metering/plans/rollover` + 文档说明由外部调度调用）。

### 修改
6. `enterprise/apps/admin-console/src/lib/token-quota-store.ts`：暴露「按 scope 写入/移除额度项」的辅助函数供发布映射调用（保持整包 JSON 结构）。

### 不动
- 网关 enforcement（完全复用 Plan A）；计价、策略、审计。
- **不**新增支付/订单/发票/充值/兑换码（G-1，明确排除）。

## 数据流

```
admin 创建套餐(draft) → 绑定 scope → publish
  → quota-plans-store.publishMapping()
      → token-quota-store: 写入 dept/tenant poolScope+monthlyTokens
      → enterprise_runtime_token_quotas.config 更新
  → 网关 GATEWAY_REMOTE_QUOTA_CONFIG_URL 轮询拉取生效
周期滚动(cron/手动) → 重置 pool 计数 + 归档 ledger
```

## 验证步骤

1. 迁移：`pnpm -C enterprise db:generate && pnpm -C enterprise db:migrate`。
2. typecheck：`pnpm -C enterprise exec turbo run typecheck --filter=admin-console`。
3. 端到端：创建→绑定→发布，确认 `enterprise_runtime_token_quotas.config` 出现对应 poolScope；起网关验证 AC-1（结合 Plan A）。
4. 周期滚动：mock period_end，跑 rollover 验 AC-2/3（幂等：重复跑结果一致）。
5. 状态机：draft/active/archived 流转用例（AC-4）。

## 回滚

- 删除套餐绑定 → 调用发布映射的逆操作移除 token-quota 配置项 → 网关恢复无套餐状态。
- 套餐表为附加表，删除不影响既有配额；映射产物可手动在配额页清理。
- 周期滚动失败可重跑（幂等），不产生半重置状态。
