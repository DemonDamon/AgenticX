---
name: Enterprise 额度控制 —— 日/周/月多周期配额（对齐 Trae 体验）
overview: 在现有「月 Token + RPM/TPM/并发 + 日/周/月请求次数」配额体系上，补齐 Token 维度的日/周硬顶、预算周期加「周」、以及前台用户可见的日/周/月剩余额度展示，对齐客户提出的 Trae 式「日、周、月额度控制」体验。
todos:
  - id: t1-budget-week
    content: Phase 1：BudgetRule 周期增加 week（gateway budget.go + admin 页面 + i18n）
    status: completed
  - id: t2-token-window-rule
    content: Phase 1：Rule 新增 dailyTokens/weeklyTokens 字段 + sanitize
    status: completed
  - id: t3-token-window-enforce
    content: Phase 1：新增 token_window.go 日/周 Token 窗口校验，接入 check_request.go
    status: completed
  - id: t4-admin-quota-ui
    content: Phase 1：admin token-quota-store.ts + metering/quota/page.tsx 支持编辑 dailyTokens/weeklyTokens
    status: completed
  - id: t5-smoke-gateway
    content: Phase 1：gateway quota 包冒烟测试覆盖日/周 Token 拦截与预算周维度
    status: completed
  - id: t6-remaining-window
    content: Phase 2：quota-remaining.ts + Go remaining.go 支持按 day/week/month 读取剩余
    status: completed
  - id: t7-portal-summary-api
    content: Phase 2：/api/workspace/quota/summary 返回 daily/weekly/monthly 三段
    status: completed
  - id: t8-quota-card-ui
    content: Phase 2：QuotaCard.tsx 展示日/周/月三条进度条 + 重置时间
    status: completed
  - id: t9-deploy-doc
    content: Phase 1：补充部署文档，说明 GATEWAY_REQUEST_COUNT_QUOTA / GATEWAY_TOKEN_WINDOW_QUOTA 生产启用步骤
    status: completed
isProject: false
---

# Enterprise 额度控制 —— 日/周/月多周期配额（对齐 Trae 体验）

**Planned-with**: Claude Sonnet 5 (thinking)
**Suggested-Impl-Model**: gpt-5.3-codex（Go 网关后端实施为主，跨栈一致性要求高）；Phase 2 纯前端展示部分可用 composer-2.5-fast 独立完成
**Plan-Id**: 2026-07-07-enterprise-quota-daily-weekly-monthly
**Plan-File**: `.cursor/plans/2026-07-07-enterprise-quota-daily-weekly-monthly.plan.md`

## 背景 / 客户诉求（已直读核验）

客户在额度控制页看到当前实现后提出：「参考 Trae 的做法，设置个日、周、月的额度控制，可以吗？」

**现状核验结论**（对照 `enterprise/apps/gateway/internal/quota/`）：

| 维度 | 现状 | 差距 |
|---|---|---|
| 请求次数（日/周/月） | ✅ 已实现：`Rule.RequestsPerDay/Week/Month`（`check_request.go` L242-270, `request_count.go`），受 `GATEWAY_REQUEST_COUNT_QUOTA` 开关控制，默认 **off** | 需生产环境显式打开并补文档 |
| Token 硬顶 | ✅ 仅 `Rule.MonthlyTokens`（月度） | ❌ **无日/周 Token 硬顶** —— 这是客户对标 Trae「今日额度用完」最直接感知的维度，必须补 |
| 预算（成本/Token） | ✅ `BudgetRule.Period` 仅 `day \| month`（`budget.go` L20-22, L187-192） | ❌ **无「周」预算周期** |
| 前台用户可见剩余额度 | ✅ `QuotaCard.tsx` 展示**月度** Token 剩余（`/api/workspace/quota/summary`） | ❌ **无日/周维度展示**，用户看不到「今天还剩多少」 |
| 管理台配置 UI | ✅ `metering/quota/page.tsx` 已有日/周/月**请求次数**输入框 | ❌ 无日/周 **Token** 输入框 |

**根因**：Token 是最重的计量维度（客户最关心的资源消耗单位），但历史上只做了月度 token 硬顶 + 请求次数的日/周/月维度，两者未对齐。Trae 客户心智里的「额度」= Token/调用配额，因此「日、周、月」首先要落在 **Token** 维度，而不仅是请求次数。

## 目标（分两个阶段，可独立验收）

- **Phase 1（后端可验证，1 个迭代）**：Token 维度补齐日/周硬顶；预算维度补「周」周期；管理台可配置；生产文档补开关说明。
- **Phase 2（前台产品化，依赖 Phase 1 数据落地后）**：用户能在 web-portal 看到「今日 / 本周 / 本月」三条用量进度条与重置时间。

---

## Phase 1：网关 Token 日/周硬顶 + 预算周维度

### FR-1：`quota.Rule` 新增 `DailyTokens` / `WeeklyTokens`

**文件**：`enterprise/apps/gateway/internal/quota/tracker.go`

在 `Rule` struct（约 L27-38）中，`MonthlyTokens` 字段旁新增：

```go
type Rule struct {
	MonthlyTokens      int64  `json:"monthlyTokens"`
	DailyTokens        int64  `json:"dailyTokens,omitempty"`
	WeeklyTokens       int64  `json:"weeklyTokens,omitempty"`
	TPM                int    `json:"tpm,omitempty"`
	// ... 其余字段不变
}
```

在 `check_request.go` 的 `sanitizeRuleExtended`（约 L216-240）中新增负值归零：

```go
func sanitizeRuleExtended(in Rule) Rule {
	r := sanitizeRule(in)
	if r.DailyTokens < 0 {
		r.DailyTokens = 0
	}
	if r.WeeklyTokens < 0 {
		r.WeeklyTokens = 0
	}
	// ... 其余不变
}
```

**AC-1**：`go test ./internal/quota/... -run TestSanitizeRuleExtended` 或新增用例验证负值归零、未配置时字段为 0。

### FR-2：新增 Token 日/周窗口校验（复用 `PoolCounter`）

**新文件**：`enterprise/apps/gateway/internal/quota/token_window.go`

设计要点：
- 复用现成的 `t.poolCounter`（`ledger.go` 定义的 `PoolCounter` 接口，`Add`/`Current` 对任意 delta 通用，不局限于 +1），新增两个 `ScopeType` 常量 `tok_day` / `tok_week`。
- 周期串复用 `request_count.go` 已有的 `requestWindowPeriod(kind, now)`（day→`2006-01-02`，week→ISO `2026-W28`）。
- **简化边界（写入 NFR，避免过度设计）**：日/周 Token 窗口按「请求进入时的估算 tokens 直接计数，不做完成后 settle 回填」——与现有 `RequestCountCounter` 的近似策略一致，允许轻微高估，不与月度的 reserve/settle 精确记账体系耦合，从而**不触碰** `server.go` 里复杂的 settle/rollback 链路（no-scope-creep）。

```go
package quota

import (
	"fmt"
	"os"
	"strings"
)

const (
	tokenScopeDay  = "tok_day"
	tokenScopeWeek = "tok_week"
)

func tokenWindowFeatureEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("GATEWAY_TOKEN_WINDOW_QUOTA")), "on")
}

func tokenWindowPoolKey(kind string, ctx RequestContext, period string) PoolKey {
	scopeType := tokenScopeDay
	if strings.EqualFold(kind, "week") {
		scopeType = tokenScopeWeek
	}
	tenantID := strings.TrimSpace(ctx.TenantID)
	if tenantID == "" {
		tenantID = "default"
	}
	identity := strings.TrimPrefix(rateKey("tok", ctx), "tok::")
	return PoolKey{TenantID: tenantID, ScopeType: scopeType, ScopeID: identity, Period: period}
}

// checkTokenWindowLimits enforces day/week token ceilings; approximate (no settle-back).
func (t *Tracker) checkTokenWindowLimits(ctx RequestContext, rule Rule, tokens int64) (CheckResult, bool) {
	if t == nil || t.poolCounter == nil || !tokenWindowFeatureEnabled() || tokens <= 0 {
		return CheckResult{}, false
	}
	checks := []struct {
		kind  string
		limit int64
	}{
		{"day", rule.DailyTokens},
		{"week", rule.WeeklyTokens},
	}
	now := requestCountNow()
	for _, c := range checks {
		if c.limit <= 0 {
			continue
		}
		period := requestWindowPeriod(c.kind, now)
		key := tokenWindowPoolKey(c.kind, ctx, period)
		current, err := t.poolCounter.Current(key)
		if err != nil && rule.Action == ActionBlock {
			return blockedResult("token_"+c.kind, rule, current, c.limit), true
		}
		if current+tokens > c.limit {
			if rule.Action == ActionBlock {
				return blockedResult("token_"+c.kind, rule, current, c.limit), true
			}
			// warn：仍放行，但记账，避免无限透支
			_, _ = t.poolCounter.Add(key, tokens, LedgerEventReserve, "")
			return warnResult("token_"+c.kind, rule), true
		}
		if _, addErr := t.poolCounter.Add(key, tokens, LedgerEventReserve, ""); addErr != nil && rule.Action == ActionBlock {
			return blockedResult("token_"+c.kind, rule, current, c.limit), true
		}
	}
	return CheckResult{}, false
}
```

**接入点**：`check_request.go` 的 `CheckRequest` 方法，在 `checkRequestCountLimits` 调用之后（约 L60-62）新增：

```go
	if result, ok := t.checkRequestCountLimits(ctx, rule); ok {
		return result
	}

	if result, ok := t.checkTokenWindowLimits(ctx, rule, tokens); ok {
		return result
	}
```

**AC-2**：新增 `enterprise/apps/gateway/internal/quota/token_window_test.go`：
- 配 `dailyTokens=1000, action=block`，累计消耗超过 1000 后下一次请求被拦截（`CheckResult.Allowed=false`, `Kind="token_day"`）。
- 次日（mock `requestCountNow`）后额度恢复。
- `weeklyTokens` 与 `dailyTokens` 同时配置时互相独立生效，任一超限即拦截。
- 未配置 `dailyTokens`/`weeklyTokens` 时行为与改动前一致（`token_window_test.go` 对比 baseline）。
- `GATEWAY_TOKEN_WINDOW_QUOTA` 未设置（默认 off）时，函数直接返回 `(CheckResult{}, false)`，即使配了 `dailyTokens` 也不生效——与 `GATEWAY_REQUEST_COUNT_QUOTA` 的默认关闭策略保持一致，避免默认行为变化。

### FR-3：`BudgetRule.Period` 增加 `week`

**文件**：`enterprise/apps/gateway/internal/quota/budget.go`

L20-22 新增常量：

```go
const (
	BudgetUnitCostUSD = "cost_usd"
	BudgetUnitTokens  = "tokens"

	BudgetPeriodDay   = "day"
	BudgetPeriodWeek  = "week"
	BudgetPeriodMonth = "month"
)
```

`sanitizeBudgetRule`（L179-212）中周期校验从二选一改为三选一：

```go
	period := strings.ToLower(strings.TrimSpace(r.Period))
	switch period {
	case BudgetPeriodDay:
		r.Period = BudgetPeriodDay
	case BudgetPeriodWeek:
		r.Period = BudgetPeriodWeek
	default:
		r.Period = BudgetPeriodMonth
	}
```

`budgetPeriodKey`（L240-245）新增周分支（复用 ISO 周格式，与 `request_count.go` 的 `requestWindowPeriod` 保持一致的周表示，避免同仓库出现两套周编号）：

```go
func budgetPeriodKey(period string, at time.Time) string {
	switch period {
	case BudgetPeriodDay:
		return at.UTC().Format("2006-01-02")
	case BudgetPeriodWeek:
		year, week := at.UTC().ISOWeek()
		return fmt.Sprintf("%d-W%02d", year, week)
	default:
		return at.UTC().Format("2006-01")
	}
}
```

**AC-3**：`enterprise/apps/gateway/internal/quota/budget_test.go` 新增用例：`period=week` 的预算在同一 ISO 周内累计生效，跨周重置；`period` 非法值时归一化为 `month`（保持向后兼容默认值不变）。

### FR-4：Admin 管理台 UI 支持编辑

**文件 1**：`enterprise/apps/admin-console/src/lib/token-quota-store.ts`

`QuotaRule` type（L8-18）新增字段，`normalizeRule`（L48-71）新增归一化：

```ts
export type QuotaRule = {
  monthlyTokens: number;
  dailyTokens?: number;
  weeklyTokens?: number;
  // ... 其余不变
};
```

```ts
function normalizeRule(input: Partial<QuotaRule> | undefined): QuotaRule {
  const dailyTokens = Number(input?.dailyTokens ?? 0);
  const weeklyTokens = Number(input?.weeklyTokens ?? 0);
  // ... 保持既有变量声明
  return {
    monthlyTokens: /* 不变 */,
    dailyTokens: Number.isFinite(dailyTokens) && dailyTokens > 0 ? Math.floor(dailyTokens) : 0,
    weeklyTokens: Number.isFinite(weeklyTokens) && weeklyTokens > 0 ? Math.floor(weeklyTokens) : 0,
    // ... 其余不变
  };
}
```

**文件 2**：`enterprise/apps/admin-console/src/app/metering/quota/page.tsx`

- `QuotaRule` type（L38-48）与 `EMPTY_RULE`（L139-149）同步新增 `dailyTokens`/`weeklyTokens: 0`。
- `RuleEditor` 组件（L194-290）在 `monthlyTokens` 输入框（L216-219）**之后**插入两个同款输入框（复用现有 `Input type="number"` 模式）：

```tsx
      <div className="space-y-1">
        <Label className="text-xs">{tf("dailyTokens")}</Label>
        <Input type="number" value={rule.dailyTokens ?? 0} onChange={(e) => onChange({ dailyTokens: Number(e.target.value || 0) })} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">{tf("weeklyTokens")}</Label>
        <Input type="number" value={rule.weeklyTokens ?? 0} onChange={(e) => onChange({ weeklyTokens: Number(e.target.value || 0) })} />
      </div>
```

  注意：`RuleEditor` 外层 grid 定义为 `grid-cols-[140px_repeat(9,minmax(0,1fr))_auto]`（L214），新增 2 列后需改为 `repeat(11,minmax(0,1fr))`，避免布局挤压。

- `BudgetRuleEditor` 组件（约 L291-350）「周期」`Select`（约 L317-324）新增一项：

```tsx
          <SelectContent>
            <SelectItem value="day">日</SelectItem>
            <SelectItem value="week">周</SelectItem>
            <SelectItem value="month">月</SelectItem>
          </SelectContent>
```

  同步更新 `BudgetRule.period` type（约 L81）：`period: "day" | "week" | "month"`。

**文件 3**：i18n —— `enterprise/apps/admin-console/messages/zh.json` 与 `messages/en.json`

在 `pages.ops.quota.fields`（zh.json L1221 附近，与 `requestsPerDay` 同级）新增：
```json
"dailyTokens": "日 Token 上限",
"weeklyTokens": "周 Token 上限"
```
en.json 对应：
```json
"dailyTokens": "Tokens/day",
"weeklyTokens": "Tokens/week"
```
`period` 字典（zh.json L1245 `"period": { "month": "按月", "week": "按周" }`）已有 `week`，**budget 的 day 缺失需一并确认补齐**（读取该行上下文确认是否需要新增 `"day": "按日"`，若已存在则不动，严格按 no-scope-creep 原则，仅在缺失时新增）。

**AC-4**：`pnpm -C enterprise --filter @agenticx/app-admin-console typecheck` 与 `build` 通过；手动在设置页为某用户配 `dailyTokens=5000`，保存后刷新页面数值保留（PG 落库验证，对齐仓库「不能 mock」硬性要求）。

### FR-5：生产环境启用文档

**文件**：`enterprise/deploy/gateway/hybrid/`（README 或等效部署说明文件，先用 `Glob` 定位该目录下现有 README/说明文档，若不存在则在 `enterprise/apps/gateway/README.md` 追加章节，不新建冗余文档）

补充章节「多周期配额生产启用」，内容：
```
GATEWAY_REQUEST_COUNT_QUOTA=on        # 启用日/周/月请求次数配额
GATEWAY_TOKEN_WINDOW_QUOTA=on         # 启用日/周 Token 硬顶（本次新增）
GATEWAY_REQUEST_COUNT_BACKEND=pg      # 多副本部署建议使用 PG 后端，保证跨实例计数一致
DATABASE_URL=...                      # PG 后端所需
```
并注明：默认关闭是为了保证既有客户升级后零行为变化；首次启用前需与客户确认限额数值。

**AC-5**：文档 diff 可读，包含以上 4 个环境变量及其含义、默认值、多副本注意事项。

---

## Phase 2：前台日/周/月剩余额度展示（依赖 Phase 1 数据落地）

> Phase 2 在 Phase 1 合并并在生产/预发打开 `GATEWAY_TOKEN_WINDOW_QUOTA=on` 积累至少 1 天数据后再排期，避免展示无意义的全零数据。

### FR-6：`quota-remaining.ts` 支持按周期读取

**文件**：`enterprise/packages/iam-core/src/quota-remaining.ts`

新增 `readPoolUsed` 的周期无关版本（现有函数已按 `period` 参数化，`enterprise/packages/iam-core/src/quota-remaining.ts` L87-114 的 `readPoolUsed(tenantId, scopeType, scopeId, period)` **本身已通用**，无需改造读取逻辑本身）。需要新增的是：

1. `currentPeriod()`（L38-41，当前只返回月字符串）旁新增：
```ts
function currentDayPeriod(): string {
  return new Date().toISOString().slice(0, 10);
}
function currentWeekPeriod(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
```
（与 Go 侧 `time.ISOWeek()` 输出格式对齐，避免前后端周编号不一致——**关键一致性点**，实施时须用 Go 单测输出的真实周号交叉验证 TS 实现，例如同一天两端算出的 `period` 字符串必须相等。）

2. 新增 `getQuotaWindowUsageForScope(input & { window: "day" | "week" | "month" })`，复用 `getQuotaUsageForScope` 逻辑框架，仅替换：
   - `period` 来源改为按 `window` 选择 `currentDayPeriod()` / `currentWeekPeriod()` / `currentPeriod()`；
   - 池读取的 `scopeType`（对应 Go 侧 `tok_day`/`tok_week`/沿用月度既有 `scopeType`）；
   - 限额来源改为 `rule.dailyTokens` / `rule.weeklyTokens` / `rule.monthlyTokens`（`QuotaRuleSnapshot` type，L9-13，需新增 `dailyTokens?`/`weeklyTokens?` 字段并在 `normalizeRule`，L153-163，同步归一化）。

**AC-6**：新增 `enterprise/packages/iam-core/src/__tests__/quota-remaining.test.ts` 用例：对同一用户分别请求 day/week/month 三个窗口，返回的 `used`/`limit`/`remaining` 互不干扰；未配置 `dailyTokens` 时该窗口返回 `unlimited: true`。

### FR-7：`/api/workspace/quota/summary` 返回三段数据

**文件**：`enterprise/apps/web-portal/src/app/api/workspace/quota/summary/route.ts`

在现有月度 `user`/`dept` 查询逻辑基础上，并行调用 FR-6 的 `getQuotaWindowUsageForScope` 三次（day/week/month），响应体新增：
```ts
{
  daily: RemainingSlice & { unlimited: boolean },
  weekly: RemainingSlice & { unlimited: boolean },
  monthly: RemainingSlice & { unlimited: boolean }, // 即原 user 字段，保留向后兼容字段名不删除
}
```
**兼容性要求**：保留原 `user`/`dept` 字段不删除（避免破坏其他已消费该接口的调用方），新增字段并存。

**AC-7**：`enterprise/apps/web-portal/src/app/api/workspace/quota/summary/__tests__/route.test.ts` 新增断言：响应体同时包含 `user`（兼容）与 `daily`/`weekly`/`monthly` 三个新字段；未启用 `GATEWAY_TOKEN_WINDOW_QUOTA` 场景下 `daily`/`weekly` 返回 `unlimited: true`（因为规则里 `dailyTokens`/`weeklyTokens` 未配置，天然回落不限额分支，无需额外开关判断——这是本设计的优点：前端读取侧不依赖网关的功能开关，只依赖规则是否配置了对应字段）。

### FR-8：`QuotaCard.tsx` 展示三条进度条

**文件**：`enterprise/apps/web-portal/src/components/QuotaCard.tsx`

- `QuotaSummary` type（L15-19）扩展为包含 `daily`/`weekly`/`monthly` 三个 `RemainingSlice`。
- 复用已有的 `UsageRow` 组件（L27-52，无需改动其实现），在渲染处（原先只渲染 `summary.user` 一行，约 L90+ 需读取完整文件确认精确行号）依次渲染：
```tsx
<UsageRow label="今日" slice={summary.daily} />
<UsageRow label="本周" slice={summary.weekly} />
<UsageRow label="本月" slice={summary.monthly} />
{summary.dept ? <UsageRow label="部门共享池" slice={summary.dept} /> : null}
```
- 全部维度 `unlimited: true` 时（未配置任何日/周/月 Token），保持现状只显示「不限额」提示，不额外堆叠三条空进度条——实施者需读取 `UsageRow` 现有 `unlimited` 分支（L34-43）判断是否已满足此要求，若三条都走 unlimited 分支会显示三次「不限额」文案，产品体验不佳，**需要**在外层加一层判断：若 daily/weekly/monthly 三者全部 `unlimited`，则只渲染一条「不限额」提示，不逐条渲染。

**AC-8**：手动验证：配置某用户 `dailyTokens=1000, monthlyTokens=1000000` 后，web-portal 工作区侧栏 `QuotaCard` 显示两条进度条（今日、本月），周未配置则不单独显示「本周」行或显示为「不限额」（二选一，实施时与产品/客户确认展示口径，不擅自决定，此处先记录为待确认点）。

---

## In Scope / Out of Scope

**In scope**：
- Token 日/周硬顶（网关 + 管理台 + 前台展示）
- 预算周期新增「周」
- 生产启用文档
- 对应冒烟/单元测试

**Out of scope（严格不动，no-scope-creep）**：
- 不改动月度 Token 现有 reserve/settle/rollback 精确记账链路（`server.go` 中 `runChatQuotaGate`、`SettleBudget` 调用点）
- 不改动请求次数配额（`request_count.go`）现有逻辑，仅并列新增 token 窗口
- 不涉及 `agenticx/` Python SDK、Desktop 客户端
- 不做套餐 SKU（`enterprise_quota_plans`）层面的日/周字段扩展（若客户后续要求套餐售卖也带日/周维度，需另立 plan）
- 不改动共享池（dept/tenant pool）与月度池的既有 `ScopeType` 语义，仅新增 `tok_day`/`tok_week` 两个新 ScopeType 值，向后兼容

## 验证步骤

1. `cd enterprise/apps/gateway && go test ./internal/quota/... -run "TokenWindow|Budget" -count=1`（AC-2、AC-3）
2. `cd enterprise/apps/gateway && go build ./...`（确保新文件编译通过）
3. `pnpm -C enterprise --filter @agenticx/iam-core test -- quota-remaining`（AC-6）
4. `pnpm -C enterprise --filter @agenticx/app-web-portal test -- workspace/quota/summary`（AC-7）
5. `pnpm -C enterprise --filter @agenticx/app-admin-console typecheck && pnpm -C enterprise --filter @agenticx/app-admin-console build`（AC-4）
6. 手动冒烟：`enterprise/scripts/start-dev-with-infra.sh` 起中间件，管理台配置某测试用户 `dailyTokens=100`，用 `curl` 连续调用网关 chat completions 接口触发超限，确认返回 `policy:quota:token_day_exceeded`（`GATEWAY_TOKEN_WINDOW_QUOTA=on` 时）。

## 风险与已知限制（如实告知客户）

- 日/周 Token 窗口采用「进入时计数、不精确 settle」策略，可能因并发请求估算 tokens 与实际消耗有出入，导致**轻微**超额（与现有请求次数计数策略一致，非本次引入的新问题）。若客户要求分文不差的精确记账，需要走月度那套 reserve/settle 机制的同等复杂度改造，属于更大范围的独立需求。
- Phase 2 依赖 Phase 1 上线并积累数据后才有意义展示，两个阶段建议分别验收、分别提交（各自 `Plan-Id` 相同，但可拆两次 commit）。
