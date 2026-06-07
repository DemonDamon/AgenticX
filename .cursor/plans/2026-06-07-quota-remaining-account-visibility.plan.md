---
name: 配额剩余额度账户语义与前后台可视化（remaining 查询）
overview: 在共享池账本之上提供「剩余额度」语义与查询接口，admin-console 与 web-portal 展示按租户/部门/用户/API Key 的「本月已用 / 上限 / 剩余」，对齐运营商 Token Plan 的额度可视化表述。仅做读取与展示，不引入计费/出账。
todos:
  - id: t1-remaining-core
    content: gateway/quota 增加 Remaining 计算（上限来自配置规则，已用来自共享池或 user 计数）
    status: completed
  - id: t2-admin-usage-api
    content: admin 新增 GET /api/metering/quota/usage 返回各 scope 的 used/limit/remaining
    status: completed
  - id: t3-admin-ui
    content: admin 配额页与共享池开关旁展示池/成员已用与剩余进度条
    status: completed
  - id: t4-portal-api
    content: web-portal 新增 GET /api/workspace/quota/summary 返回当前用户与其部门的剩余额度
    status: completed
  - id: t5-portal-ui
    content: web-portal 工作区新增「额度卡片」（本月已用/上限/剩余，Kimi 式空态）
    status: completed
  - id: t6-smoke
    content: 冒烟覆盖 remaining 计算（含未配额=无限）、scope 权限校验、portal 用户只见自己与本部门
    status: completed
isProject: false
---

# 配额剩余额度账户语义与前后台可视化

**Plan-Id**: 2026-06-07-quota-remaining-account-visibility
**Plan-File**: `.cursor/plans/2026-06-07-quota-remaining-account-visibility.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**依赖**: 2026-06-07-gateway-shared-quota-pool-ledger（共享池账本）
**调研依据**: `new-api_agenticx_gap_analysis.md`（G-E2，F1/F9/F10）

## 背景 / 现状（已直读核验）

- new-api 有 `User.Quota` / `Token.RemainQuota` 的「剩余额度」账户模型；Enterprise **只有历史用量统计**，**无** remaining 语义、无 portal 配额页（F9/F10，glob 0 命中）。
- 配额上限存在于 PG 整包 JSON（`enterprise_runtime_token_quotas.config`），已用存在于共享池账本（Plan A）或 user 月度计数。
- 客户 Token Plan 文档要求「用量明细 / 额度分配」可对客展示（`AgenticX-Token-Plan-对标方案.md` 第四节）。

**目标**：用「上限 − 已用 = 剩余」组合出账户语义并可视化，**不新建余额表**（remaining 为派生值，避免与账本双写不一致）。

## 需求

- FR-1: gateway/quota 暴露 `Remaining(ctx) -> {scope, used, limit, remaining, period}`；上限取 `selectRule`/`selectRuleExtended` 命中规则的 `MonthlyTokens`，已用取对应计数源（共享池或 user）。未配额→`limit=0` 表示「无限制」（remaining 返回 `null`/`unlimited`）。
- FR-2: admin `GET /api/metering/quota/usage?scope=tenant|dept|user|pat&id=<id>` 返回 used/limit/remaining（`metering:read` scope）。数据直读 PG `gateway_quota_pool_usage`（共享池）或 user 月度计数镜像 + 配置上限。
- FR-3: admin 配额页在「共享池」开关旁展示池或成员已用/上限进度条（补齐 Plan A t5 的占位）。
- FR-4: web-portal `GET /api/workspace/quota/summary` 返回**当前登录用户**与**其所属部门**的 used/limit/remaining（仅本人 + 本部门，按 JWT claims 鉴权，禁止越权查他人）。
- FR-5: web-portal 工作区新增「额度卡片」：本月已用 / 上限 / 剩余 + 进度条；无配额时展示「不限额」；空态对齐 Kimi 式（无数据不显示二级动作）。
- NFR-1: 纯读取，无写路径；不得在查询时触发计数变更。
- NFR-2: remaining 为派生计算，**不落新表**，保证与账本单一事实源一致。
- AC-1: dept-A 池上限 1M、已用 600k，admin usage API 返回 remaining=400k。
- AC-2: 未配额的用户，portal summary 返回 `unlimited`，卡片显示「不限额」。
- AC-3: portal 用户 A 调 summary 只能拿到自己与本部门数据；构造越权 id 参数被忽略/拒绝。
- AC-4: 共享池模式下，部门两成员看到的「部门剩余」一致（同一池）。

## 改动范围（严格）

### 新增
1. `enterprise/apps/gateway/internal/quota/remaining.go`：`func (t *Tracker) Remaining(ctx RequestContext) RemainingResult`。
2. `enterprise/apps/admin-console/src/app/api/metering/quota/usage/route.ts`：GET，`metering:read`。
3. `enterprise/apps/web-portal/src/app/api/workspace/quota/summary/route.ts`：GET，JWT 鉴权。
4. `enterprise/apps/web-portal/src/app/(workspace)/.../QuotaCard.tsx`（按现有 workspace 组件目录约定放置）。

### 修改
5. `enterprise/apps/admin-console/src/app/metering/quota/page.tsx`：进度条展示（消费 t2 接口）。
6. 若 gateway 需对外暴露 used 给 admin：优先 admin 直读 PG（不经 gateway）。若必须经 gateway，新增 internal 只读端点 `/internal/quota-usage`（Bearer），否则不加。

### 不动
- 计数写路径（Plan A 负责）；计价、策略、审计。
- 任何余额/账户持久化表（remaining 为派生值）。

## 关键数据结构

```go
type RemainingResult struct {
    Scope     string // tenant|dept|user|pat
    ScopeID   string
    Period    string // YYYY-MM
    Used      int64
    Limit     int64  // 0 = unlimited
    Remaining *int64 // nil = unlimited
}
```

```jsonc
// GET /api/workspace/quota/summary -> data
{
  "user":  { "used": 120000, "limit": 500000, "remaining": 380000, "period": "2026-06" },
  "dept":  { "used": 600000, "limit": 1000000, "remaining": 400000, "shared": true },
  "unlimited": false
}
```

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/quota/... -run Remaining -count=1`。
2. admin：`pnpm -C enterprise exec turbo run typecheck --filter=admin-console`；本地配额配 dept 池后调 usage API 核对 AC-1。
3. portal：`pnpm -C enterprise exec turbo run typecheck --filter=web-portal`；登录用户调 summary 验 AC-2/3/4，越权 id 用例必须失败。
4. 视觉：portal 工作区额度卡片在 dark/light 下展示正常（参考 Kimi 空态）。

## 回滚

- 删除新增 route/组件即回退；无写路径、无新表，回滚零数据风险。
- Plan A 关闭（`GATEWAY_QUOTA_POOL=off`）时，本 plan 退化为展示 user 维度月度用量与上限（仍可用）。
