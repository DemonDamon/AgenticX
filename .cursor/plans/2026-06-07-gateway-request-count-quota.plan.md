---
name: Gateway 请求次数配额维度（Coding Plan「每 N 时段请求数」）
overview: 为网关配额新增「请求次数」维度（每日/每周/每月请求数上限），对齐运营商 Coding Plan 的请求计数口径，与现有 Token / RPM / 并发维度并存。独立扩展限流/计数，不依赖共享池 plan。
todos:
  - id: t1-rule-fields
    content: Rule 新增 requestsPerDay/Week/Month 字段与 sanitize 校验
    status: completed
  - id: t2-counter
    content: quota 新增请求次数窗口计数（复用 RateLimiter 或周期计数），按 rateKey 多维
    status: completed
  - id: t3-enforce
    content: check_request 在 RPM/TPM 同层插入请求次数校验，命中按 action block/warn
    status: completed
  - id: t4-admin
    content: token-quota 配置与配额页支持请求次数维度编辑
    status: completed
  - id: t5-smoke
    content: 冒烟覆盖日/周/月请求数拦截、跨窗口重置、与 token 配额并存
    status: completed
isProject: false
---

# Gateway 请求次数配额维度

**Plan-Id**: 2026-06-07-gateway-request-count-quota
**Plan-File**: `.cursor/plans/2026-06-07-gateway-request-count-quota.plan.md`
**Owner**: Damon
**Made-with**: Damon Li
**依赖**: 无（独立扩展 quota；可与共享池 plan 任意顺序）
**调研依据**: `new-api_agenticx_gap_analysis.md`（G-E5）；`AgenticX-Token-Plan-对标方案.md` G-2

## 背景 / 现状（已直读核验）

- Enterprise 配额以 **Token / RPM / 并发** 为主（`quota/check_request.go`），**无**「每 N 小时/周/月请求次数」维度（G-E5）。
- 运营商 Coding Plan 常以「请求次数」售卖（高频小请求场景），客户可能要求对齐该口径。
- 现有 `RateLimiter` 已支持滑动/窗口限流（RPM），可复用其窗口机制扩展为日/周/月请求计数。

**目标**：新增请求计数维度，与现有维度并存，**不替换** token 计量。

## 需求

- FR-1: `quota.Rule` 新增 `RequestsPerDay`、`RequestsPerWeek`、`RequestsPerMonth`（int，0=不限）。
- FR-2: 计数键复用 `rateKey`（pat→user→dept→tenant 优先），窗口分别为自然日/自然周(ISO)/自然月（UTC）。
- FR-3: 在 `check_request.go` 的请求前链路（与 RPM/TPM/并发同层）插入请求次数校验；命中上限按 `Rule.Action`：`block` 拦截、`warn` 放行+告警头。
- FR-4: 计数后端策略与 token 月度一致：优先 PG/Redis（若 Plan A 已落地可复用其计数表，新增 `dimension` 区分），无则进程内/本地文件回落；总开关 `GATEWAY_REQUEST_COUNT_QUOTA`（off 默认）。
- FR-5: admin 配额页与 token-quota 配置 JSON 支持编辑请求次数维度。
- NFR-1: 未配置请求次数时零行为变化。
- NFR-2: 请求计数在**请求进入时 +1**（非完成时），避免长请求绕过；失败是否回退由 `action` 决定（block 模式建议进入即计数，warn 模式可不回退）。
- NFR-3: 多副本下若启用 PG/Redis 后端，计数一致（与 G-E4 同理）。
- AC-1: 配 `requestsPerDay=100, action=block`，第 101 个请求当天被拦截，次日恢复。
- AC-2: 同时配 token 月度与请求次数，两者独立生效，任一超限即拦截。
- AC-3: `warn` 动作下超限请求放行并带 `X-AgenticX-Quota-Warn: requests` 头。
- AC-4: 未配请求次数的规则行为与改动前一致。

## 改动范围（严格）

### 修改
1. `enterprise/apps/gateway/internal/quota/tracker.go`：`Rule` 增 3 字段 + `sanitizeRule`/`sanitizeRuleExtended` 校验（负值归零）。
2. `enterprise/apps/gateway/internal/quota/check_request.go`：`CheckRequest` 内新增请求次数校验段（RPM 段之后）；新增 `requestWindowKey(kind, ctx, period)`。
3. `enterprise/apps/gateway/internal/quota/`：新增 `request_count.go`（窗口计数实现；若 Plan A 已落地优先复用其 PG 计数，加 `dimension='requests:day'` 等）。
4. `enterprise/apps/admin-console/src/lib/token-quota-store.ts` + `src/app/metering/quota/page.tsx`：请求次数维度编辑。

### 不动
- token 月度/共享池计量（独立维度）；TPM/并发；策略、计价、审计。
- `agenticx/` Python SDK、Desktop。

## 关键数据结构

```go
// Rule 扩展
RequestsPerDay   int `json:"requestsPerDay,omitempty"`
RequestsPerWeek  int `json:"requestsPerWeek,omitempty"`
RequestsPerMonth int `json:"requestsPerMonth,omitempty"`
```

窗口键示例：`requests::day::<rateKey>::2026-06-07`。

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/quota/... -run RequestCount -count=1`（AC-1/2/3/4）。
2. 跨窗口：mock 时间到次日/次周/次月验证重置。
3. `GATEWAY_REQUEST_COUNT_QUOTA=off` 回归既有 quota 测试全绿。
4. admin typecheck：`pnpm -C enterprise exec turbo run typecheck --filter=admin-console`。

## 回滚

- `GATEWAY_REQUEST_COUNT_QUOTA=off`（默认）停用；删除配置中请求次数字段即恢复。
- 与 token 配额解耦，回滚不影响既有计量。
