---
name: Gateway 成本预算预警与软熔断（异常消耗自动拦截）
overview: 基于现有配额 tracker 扩展「成本/词元预算 + 阈值预警 + 超限软熔断」，按租户/部门/用户维度累计成本，命中预警阈值告警、命中硬上限拦截请求，admin 可配置预算并查看告警。
todos:
  - id: t1-budget-model
    content: 定义预算配置结构（维度/周期/预警阈值/硬上限/动作）与 PG 表
    status: completed
  - id: t2-cost-accumulate
    content: tracker 增加按维度成本累计（复用月度计数窗口），读取动态成本
    status: completed
  - id: t3-breaker-enforce
    content: 请求前校验预算，命中预警标记/命中上限按动作 block 或 fallback
    status: completed
  - id: t4-alert-emit
    content: 预警事件写 PG + 审计，admin 展示告警列表
    status: completed
  - id: t5-smoke
    content: 冒烟测试覆盖预警触发、软熔断拦截、恢复三场景
    status: completed
isProject: false
---

# Gateway 成本预算预警与软熔断

**Plan-Id**: 2026-06-05-gateway-cost-budget-alert-circuit-breaker
**Plan-File**: `.cursor/plans/2026-06-05-gateway-cost-budget-alert-circuit-breaker.plan.md`
**Owner**: Damon
**Made-with**: Damon Li

## 背景 / 现状

现有 `enterprise/apps/gateway/internal/quota/tracker.go` 只做 token 配额（TPM/RPM/并发/月度 token），无「成本预算」「异常消耗预警」「超限熔断」。客户要求「成本预警机制（异常消耗自动熔断）」。本 plan 实现**应用层软熔断**（命中预算后按动作拦截/降级），不涉及上游 5xx 级断路器（属可靠性范畴，另案）。

## 需求

- FR-1: 预算按维度配置：租户 / 部门 / 用户；周期：日 / 月。预算单位支持「成本 USD」与「词元数」二选一。
- FR-2: 双阈值：`warn_threshold_pct`（命中→记预警，不拦截）与硬上限（命中→按 `action` 执行 `block` 或 `fallback` 到降级模型）。
- FR-3: 成本累计复用配额窗口计数机制（与月度 token 同一存储路径，避免新建独立计时器）；成本值取动态计价结果（若动态计价 plan 未落地则取基础单价）。
- FR-4: 预警/熔断事件写 PG 告警表并落审计链；admin-console 展示告警列表与当前预算消耗。
- NFR-1: 预算未配置时零行为变化；预算检查失败（存储不可用）须 fail-open，不得误伤正常请求。
- AC-1: 配置用户日预算 + 预警 80%，消耗过 80% 产生一条 warn 事件且请求放行。
- AC-2: 消耗达硬上限后，`action=block` 的请求被拦截并返回预算超限业务错误。
- AC-3: 跨周期（次日/次月）预算自动重置，请求恢复。

## 改动范围（严格）

1. `enterprise/apps/gateway/internal/quota/`
   - 新增 `budget.go`：预算配置结构 + `CheckBudget(identity, costDelta)` → `{ok, warned, action}`。
   - 在 `check_request.go` 请求前链路插入预算校验（与现有 TPM/RPM/并发同层），命中上限按动作处理。
   - 成本累计写入复用月度计数存储（Redis 或进程内回落，与现状一致）。
2. `enterprise/apps/gateway/internal/metering/reporter.go`
   - usage 上报后回写实际成本到预算累计（与配额计数同时机）。
3. `enterprise/apps/admin-console/`
   - 新增 PG 表 `enterprise_runtime_budgets` + `gateway_budget_alerts`（随 `packages/db-schema` 迁移）。
   - 预算配置 API + 快照（对齐 `token-quota-store.ts` 模式）；网关经 `GATEWAY_REMOTE_*` 拉取。
   - 「额度控制」页增加预算编辑区块 + 告警列表只读视图。
4. 审计：预警/熔断事件经现有 `audit/writer.go` 落链（动作如 `budget.warn` / `budget.block`）。

不动：现有 TPM/RPM/并发/月度 token 语义、策略引擎、JWT、计价计算本身（仅消费其结果）。

## 验证步骤

1. `go test ./internal/quota/...`（AC-1/2/3 单测，含 fail-open）。
2. 本地配预算并发请求触发 warn → 查 `gateway_budget_alerts` 与审计链。
3. 压过硬上限确认 block，跨周期 mock 时间确认重置。

## 回滚

- 预算检查为可选链路，删除配置即停用；fail-open 设计保证回滚/故障时不影响主流量。
