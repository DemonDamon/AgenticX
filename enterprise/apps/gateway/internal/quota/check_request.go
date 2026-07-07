package quota

import (
	"fmt"
	"strings"
	"sync"
)

var rateLimiterOnce sync.Once
var sharedRateLimiter *RateLimiter

func sharedLimiter() *RateLimiter {
	rateLimiterOnce.Do(func() {
		sharedRateLimiter = buildSharedRateLimiter()
	})
	return sharedRateLimiter
}

// RequestContext carries identity dimensions for quota evaluation.
type RequestContext struct {
	TenantID   string
	UserID     string
	DeptID     string
	APITokenID string
	Role       string
	Model      string
}

// CheckResult aggregates quota decision across dimensions.
type CheckResult struct {
	Allowed              bool
	Warn                 bool
	Kind                 string
	Rule                 Rule
	Used                 int64
	Limit                int64
	Description          string
	Headers              map[string]string
	FallbackModel        string
	BudgetReservedTokens int64
	BudgetReservedCost   float64
}

func (t *Tracker) CheckRequest(ctx RequestContext, tokens int64, costUSD float64) CheckResult {
	cfg := t.loadConfig()
	rule := selectRuleExtended(cfg, ctx)
	lim := sharedLimiter()

	if rule.RPM > 0 {
		key := rateKey("rpm", ctx)
		ok, used := lim.AllowRPM(key, rule.RPM)
		if !ok {
			if rule.Action == ActionBlock {
				return blockedResult("rpm", rule, int64(used), int64(rule.RPM))
			}
			return warnResult("rpm", rule)
		}
	}

	if result, ok := t.checkRequestCountLimits(ctx, rule); ok {
		return result
	}

	if result, ok := t.checkTokenWindowLimits(ctx, rule, tokens); ok {
		return result
	}

	if rule.TPM > 0 {
		key := rateKey("tpm", ctx)
		add := max64(tokens, 1)
		ok, used := lim.AllowTPM(key, rule.TPM, add)
		if !ok {
			if rule.Action == ActionBlock {
				return blockedResult("tpm", rule, used, int64(rule.TPM))
			}
			return warnResult("tpm", rule)
		}
	}

	if rule.MaxConcurrency > 0 {
		key := rateKey("concurrency", ctx)
		ok, used := lim.AcquireConcurrency(key, rule.MaxConcurrency)
		if !ok {
			if rule.Action == ActionBlock {
				return blockedResult("concurrency", rule, int64(used), int64(rule.MaxConcurrency))
			}
			return warnResult("concurrency", rule)
		}
	}

	monthly := t.CheckAndAddContext(ctx, tokens, LedgerEventReserve)
	if !monthly.Allowed {
		t.ReleaseConcurrency(ctx)
		return CheckResult{
			Allowed:     false,
			Kind:        "monthly",
			Rule:        monthly.Rule,
			Used:        monthly.UsedAfter,
			Limit:       monthly.Rule.MonthlyTokens,
			Description: "policy:quota:monthly_exceeded",
			Headers: map[string]string{
				"X-AgenticX-Quota-Used":  fmt.Sprintf("%d", monthly.UsedAfter),
				"X-AgenticX-Quota-Limit": fmt.Sprintf("%d", monthly.Rule.MonthlyTokens),
			},
		}
	}
	if monthly.Rule.Action == ActionWarn && monthly.ExceededBy > 0 {
		return CheckResult{
			Allowed:     true,
			Warn:        true,
			Kind:        "monthly",
			Rule:        monthly.Rule,
			Description: "policy:quota:monthly_warn",
			Headers:     map[string]string{"X-AgenticX-Quota-Warn": "monthly"},
		}
	}

	budget := t.CheckBudget(ctx, tokens, costUSD)
	if !budget.Allowed {
		t.ReleaseConcurrency(ctx)
		return budgetDecisionToCheckResult(budget)
	}
	if budget.Warn || budget.FallbackModel != "" {
		result := CheckResult{
			Allowed:              true,
			Warn:                 budget.Warn,
			Kind:                 "budget",
			Description:          budget.Description,
			Headers:              map[string]string{},
			FallbackModel:        budget.FallbackModel,
			BudgetReservedTokens: budget.ReservedTokens,
			BudgetReservedCost:   budget.ReservedCost,
		}
		if budget.Warn {
			result.Headers["X-AgenticX-Budget-Warn"] = budget.Description
		}
		if budget.Limit > 0 {
			result.Headers["X-AgenticX-Budget-Used"] = fmt.Sprintf("%.6f", budget.Used)
			result.Headers["X-AgenticX-Budget-Limit"] = fmt.Sprintf("%.6f", budget.Limit)
		}
		return result
	}

	return CheckResult{
		Allowed:              true,
		Rule:                 rule,
		Description:          "ok",
		BudgetReservedTokens: budget.ReservedTokens,
		BudgetReservedCost:   budget.ReservedCost,
	}
}

// CheckMCPToolCall enforces per-minute MCP tool invocation limits.
func (t *Tracker) CheckMCPToolCall(ctx RequestContext, serverName string, overrideLimit int) CheckResult {
	cfg := t.loadConfig()
	rule := selectRuleExtended(cfg, ctx)
	limit := rule.ToolCallsPerMinute
	if overrideLimit > 0 {
		limit = overrideLimit
	}
	if limit <= 0 {
		limit = 60
	}
	lim := sharedLimiter()
	key := rateKey("mcp_tool", ctx) + "::" + strings.TrimSpace(serverName)
	ok, used := lim.AllowRPM(key, limit)
	if !ok {
		if rule.Action == ActionBlock || rule.Action == "" {
			return CheckResult{
				Allowed:     false,
				Kind:        "mcp_tool",
				Rule:        rule,
				Description: "mcp:rate_limited",
				Used:        int64(used),
				Limit:       int64(limit),
				Headers: map[string]string{
					"X-AgenticX-Quota-Used":  fmt.Sprintf("%d", used),
					"X-AgenticX-Quota-Limit": fmt.Sprintf("%d", limit),
				},
			}
		}
		return warnResult("mcp_tool", rule)
	}
	return CheckResult{Allowed: true, Rule: rule, Description: "ok"}
}

func (t *Tracker) ReleaseConcurrency(ctx RequestContext) {
	cfg := t.loadConfig()
	rule := selectRuleExtended(cfg, ctx)
	if rule.MaxConcurrency <= 0 {
		return
	}
	sharedLimiter().ReleaseConcurrency(rateKey("concurrency", ctx))
}

func selectRuleExtended(cfg Config, ctx RequestContext) Rule {
	if ctx.APITokenID != "" {
		if v, ok := cfg.APITokens[ctx.APITokenID]; ok {
			return sanitizeRuleExtended(v)
		}
	}
	if v, ok := cfg.Users[ctx.UserID]; ok {
		return sanitizeRuleExtended(v)
	}
	if v, ok := cfg.Departments[ctx.DeptID]; ok {
		return sanitizeRuleExtended(v)
	}
	if v, ok := cfg.Defaults.Model[ctx.Model]; ok {
		return sanitizeRuleExtended(v)
	}
	if v, ok := cfg.Defaults.Role[ctx.Role]; ok {
		return sanitizeRuleExtended(v)
	}
	if v, ok := cfg.Defaults.Role["staff"]; ok {
		return sanitizeRuleExtended(v)
	}
	return Rule{}
}

func sanitizeRuleExtended(in Rule) Rule {
	r := sanitizeRule(in)
	if r.DailyTokens < 0 {
		r.DailyTokens = 0
	}
	if r.WeeklyTokens < 0 {
		r.WeeklyTokens = 0
	}
	if r.TPM < 0 {
		r.TPM = 0
	}
	if r.RPM < 0 {
		r.RPM = 0
	}
	if r.MaxConcurrency < 0 {
		r.MaxConcurrency = 0
	}
	if r.ToolCallsPerMinute < 0 {
		r.ToolCallsPerMinute = 0
	}
	if r.RequestsPerDay < 0 {
		r.RequestsPerDay = 0
	}
	if r.RequestsPerWeek < 0 {
		r.RequestsPerWeek = 0
	}
	if r.RequestsPerMonth < 0 {
		r.RequestsPerMonth = 0
	}
	return r
}

func (t *Tracker) checkRequestCountLimits(ctx RequestContext, rule Rule) (CheckResult, bool) {
	if t == nil || t.requestCounter == nil || !requestCountFeatureEnabled() {
		return CheckResult{}, false
	}
	checks := []struct {
		kind  string
		limit int
	}{
		{"day", rule.RequestsPerDay},
		{"week", rule.RequestsPerWeek},
		{"month", rule.RequestsPerMonth},
	}
	for _, c := range checks {
		if c.limit <= 0 {
			continue
		}
		ok, used, err := t.requestCounter.Increment(ctx, c.kind, c.limit)
		if err != nil && rule.Action == ActionBlock {
			return blockedResult("requests", rule, used, int64(c.limit)), true
		}
		if !ok {
			kind := "requests"
			if rule.Action == ActionBlock {
				return blockedResult(kind, rule, used, int64(c.limit)), true
			}
			return warnResult(kind, rule), true
		}
	}
	return CheckResult{}, false
}

func rateKey(kind string, ctx RequestContext) string {
	if ctx.APITokenID != "" {
		return kind + "::pat::" + ctx.APITokenID
	}
	if ctx.UserID != "" {
		return kind + "::user::" + ctx.UserID
	}
	if ctx.DeptID != "" {
		return kind + "::dept::" + ctx.DeptID
	}
	return kind + "::tenant::" + ctx.TenantID
}

func blockedResult(kind string, rule Rule, used, limit int64) CheckResult {
	return CheckResult{
		Allowed:     false,
		Kind:        kind,
		Rule:        rule,
		Description: fmt.Sprintf("policy:quota:%s_exceeded", kind),
		Used:        used,
		Limit:       limit,
		Headers: map[string]string{
			"X-AgenticX-Quota-Used":  fmt.Sprintf("%d", used),
			"X-AgenticX-Quota-Limit": fmt.Sprintf("%d", limit),
		},
	}
}

func warnResult(kind string, rule Rule) CheckResult {
	return CheckResult{
		Allowed:     true,
		Warn:        true,
		Kind:        kind,
		Rule:        rule,
		Description: fmt.Sprintf("policy:quota:%s_warn", kind),
		Headers:     map[string]string{"X-AgenticX-Quota-Warn": kind},
	}
}
