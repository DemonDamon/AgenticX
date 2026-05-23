package quota

import (
	"fmt"
	"os"
	"strings"
	"sync"
)

var rateLimiterOnce sync.Once
var sharedRateLimiter *RateLimiter

func sharedLimiter() *RateLimiter {
	rateLimiterOnce.Do(func() {
		sharedRateLimiter = NewRateLimiter()
		if os.Getenv("GATEWAY_REDIS_URL") == "" && os.Getenv("REDIS_URL") == "" {
			fmt.Println("quota: redis disabled, falling back to in-process limiter")
		}
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
	Allowed     bool
	Warn        bool
	Kind        string
	Rule        Rule
	Used        int64
	Limit       int64
	Description string
	Headers     map[string]string
}

func (t *Tracker) CheckRequest(ctx RequestContext, tokens int64) CheckResult {
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

	monthly := t.CheckAndAdd(ctx.UserID, ctx.DeptID, ctx.Role, ctx.Model, tokens)
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

	return CheckResult{Allowed: true, Rule: rule, Description: "ok"}
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
	return r
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
