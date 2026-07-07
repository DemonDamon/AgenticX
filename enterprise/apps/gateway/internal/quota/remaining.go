package quota

import (
	"fmt"
	"strings"
	"time"
)

type QuotaWindow string

const (
	QuotaWindowDay   QuotaWindow = "day"
	QuotaWindowWeek  QuotaWindow = "week"
	QuotaWindowMonth QuotaWindow = "month"
)

// RemainingResult is a read-only derived view: limit - used = remaining.
type RemainingResult struct {
	Scope     string `json:"scope"`
	ScopeID   string `json:"scopeId"`
	Period    string `json:"period"`
	Used      int64  `json:"used"`
	Limit     int64  `json:"limit"`
	Remaining *int64 `json:"remaining,omitempty"`
	Unlimited bool   `json:"unlimited"`
	Shared    bool   `json:"shared,omitempty"`
}

// Remaining returns quota headroom for the rule that would apply to ctx (selectRuleExtended).
func (t *Tracker) Remaining(ctx RequestContext) RemainingResult {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.remainingLocked(ctx)
}

// RemainingForWindow returns remaining usage for day/week/month token windows.
func (t *Tracker) RemainingForWindow(ctx RequestContext, window QuotaWindow) RemainingResult {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.remainingForWindowLocked(ctx, window)
}

// RemainingForScope resolves limit/used for an explicit admin scope (tenant|dept|user|pat).
func (t *Tracker) RemainingForScope(scope, scopeID, tenantID string, ctx RequestContext) RemainingResult {
	t.mu.Lock()
	defer t.mu.Unlock()
	period := time.Now().UTC().Format("2006-01")
	cfg := t.loadConfig()
	rule, resolvedScope, resolvedID := ruleForScope(cfg, scope, scopeID, tenantID, ctx)
	queryCtx := ctx
	queryCtx.TenantID = tenantID
	if resolvedScope == "dept" {
		queryCtx.DeptID = resolvedID
	}
	if resolvedScope == "user" {
		queryCtx.UserID = resolvedID
	}
	if resolvedScope == "pat" {
		queryCtx.APITokenID = resolvedID
	}
	return t.remainingWithRule(rule, queryCtx, period, resolvedScope, resolvedID)
}

func (t *Tracker) remainingLocked(ctx RequestContext) RemainingResult {
	period := time.Now().UTC().Format("2006-01")
	cfg := t.loadConfig()
	rule := selectRuleExtended(cfg, ctx)
	scope, scopeID := scopeFromRule(rule, ctx)
	return t.remainingWithRule(rule, ctx, period, scope, scopeID)
}

func (t *Tracker) remainingForWindowLocked(ctx RequestContext, window QuotaWindow) RemainingResult {
	cfg := t.loadConfig()
	rule := selectRuleExtended(cfg, ctx)
	period := periodForWindow(window, time.Now().UTC())
	limit := limitForWindow(rule, window)
	base := RemainingResult{
		Scope:   scopeFromWindowCtx(ctx),
		ScopeID: scopeIDFromWindowCtx(ctx),
		Period:  period,
	}
	if limit <= 0 {
		base.Unlimited = true
		base.Limit = 0
		base.Remaining = nil
		base.Used = t.readWindowUsed(window, ctx, period, rule)
		return base
	}
	used := t.readWindowUsed(window, ctx, period, rule)
	base.Used = used
	base.Limit = limit
	rem := limit - used
	if rem < 0 {
		rem = 0
	}
	base.Remaining = &rem
	return base
}

func (t *Tracker) remainingWithRule(rule Rule, ctx RequestContext, period, scope, scopeID string) RemainingResult {
	base := RemainingResult{
		Scope:   scope,
		ScopeID: scopeID,
		Period:  period,
	}
	if rule.MonthlyTokens <= 0 {
		base.Unlimited = true
		base.Limit = 0
		base.Remaining = nil
		base.Used = t.readUsedForRule(rule, ctx, period)
		return base
	}
	used := t.readUsedForRule(rule, ctx, period)
	base.Used = used
	base.Limit = rule.MonthlyTokens
	base.Shared = strings.TrimSpace(rule.PoolScope) != "" && t.poolCounter != nil
	rem := rule.MonthlyTokens - used
	if rem < 0 {
		rem = 0
	}
	base.Remaining = &rem
	return base
}

func (t *Tracker) readUsedForRule(rule Rule, ctx RequestContext, period string) int64 {
	if poolKey, ok := poolKeyFor(rule, ctx, period); ok && t.poolCounter != nil {
		used, err := t.poolCounter.Current(poolKey)
		if err != nil {
			return 0
		}
		return used
	}
	userID := strings.TrimSpace(ctx.UserID)
	if userID == "" {
		return 0
	}
	return t.currentUserUsedLocked(userID, period)
}

func (t *Tracker) readWindowUsed(window QuotaWindow, ctx RequestContext, period string, rule Rule) int64 {
	switch window {
	case QuotaWindowDay, QuotaWindowWeek:
		if t.poolCounter == nil {
			return 0
		}
		kind := "day"
		if window == QuotaWindowWeek {
			kind = "week"
		}
		key := tokenWindowPoolKey(kind, ctx, period)
		used, err := t.poolCounter.Current(key)
		if err != nil {
			return 0
		}
		return used
	default:
		return t.readUsedForRule(rule, ctx, period)
	}
}

func limitForWindow(rule Rule, window QuotaWindow) int64 {
	switch window {
	case QuotaWindowDay:
		return rule.DailyTokens
	case QuotaWindowWeek:
		return rule.WeeklyTokens
	default:
		return rule.MonthlyTokens
	}
}

func periodForWindow(window QuotaWindow, now time.Time) string {
	switch window {
	case QuotaWindowDay:
		return now.UTC().Format("2006-01-02")
	case QuotaWindowWeek:
		year, week := now.UTC().ISOWeek()
		return fmt.Sprintf("%d-W%02d", year, week)
	default:
		return now.UTC().Format("2006-01")
	}
}

func scopeFromWindowCtx(ctx RequestContext) string {
	if strings.TrimSpace(ctx.APITokenID) != "" {
		return "pat"
	}
	if strings.TrimSpace(ctx.UserID) != "" {
		return "user"
	}
	if strings.TrimSpace(ctx.DeptID) != "" {
		return "dept"
	}
	return "tenant"
}

func scopeIDFromWindowCtx(ctx RequestContext) string {
	if strings.TrimSpace(ctx.APITokenID) != "" {
		return strings.TrimSpace(ctx.APITokenID)
	}
	if strings.TrimSpace(ctx.UserID) != "" {
		return strings.TrimSpace(ctx.UserID)
	}
	if strings.TrimSpace(ctx.DeptID) != "" {
		return strings.TrimSpace(ctx.DeptID)
	}
	return strings.TrimSpace(ctx.TenantID)
}

func (t *Tracker) currentUserUsedLocked(userID, period string) int64 {
	key := cacheKey(userID, period)
	if cached, ok := t.usageCache[key]; ok {
		return cached
	}
	rows := t.readUsage()
	for _, row := range rows {
		if row.UserID == userID && row.Month == period {
			return row.UsedTotal
		}
	}
	return 0
}

func ruleForScope(cfg Config, scope, scopeID, tenantID string, ctx RequestContext) (Rule, string, string) {
	scope = strings.TrimSpace(scope)
	scopeID = strings.TrimSpace(scopeID)
	switch scope {
	case "pat":
		if v, ok := cfg.APITokens[scopeID]; ok {
			return sanitizeRuleExtended(v), "pat", scopeID
		}
		return Rule{}, "pat", scopeID
	case "user":
		if v, ok := cfg.Users[scopeID]; ok {
			return sanitizeRuleExtended(v), "user", scopeID
		}
		fallback := RequestContext{
			TenantID: tenantID,
			UserID:   scopeID,
			DeptID:   ctx.DeptID,
			Role:     ctx.Role,
			Model:    ctx.Model,
		}
		return selectRuleExtended(cfg, fallback), "user", scopeID
	case "dept":
		if v, ok := cfg.Departments[scopeID]; ok {
			return sanitizeRuleExtended(v), "dept", scopeID
		}
		return Rule{}, "dept", scopeID
	case "tenant":
		if rule, ok := findTenantPoolRule(cfg); ok {
			return rule, "tenant", tenantID
		}
		return Rule{}, "tenant", tenantID
	default:
		return Rule{}, scope, scopeID
	}
}

func findTenantPoolRule(cfg Config) (Rule, bool) {
	for _, rule := range cfg.Defaults.Role {
		if strings.TrimSpace(rule.PoolScope) == PoolScopeTenant && rule.MonthlyTokens > 0 {
			return sanitizeRuleExtended(rule), true
		}
	}
	for _, rule := range cfg.Departments {
		if strings.TrimSpace(rule.PoolScope) == PoolScopeTenant && rule.MonthlyTokens > 0 {
			return sanitizeRuleExtended(rule), true
		}
	}
	for _, rule := range cfg.Users {
		if strings.TrimSpace(rule.PoolScope) == PoolScopeTenant && rule.MonthlyTokens > 0 {
			return sanitizeRuleExtended(rule), true
		}
	}
	return Rule{}, false
}

func scopeFromRule(rule Rule, ctx RequestContext) (string, string) {
	poolScope := strings.TrimSpace(rule.PoolScope)
	if poolScope == PoolScopeTenant {
		return "tenant", strings.TrimSpace(ctx.TenantID)
	}
	if poolScope == PoolScopeDept {
		return "dept", strings.TrimSpace(ctx.DeptID)
	}
	if ctx.APITokenID != "" {
		return "pat", strings.TrimSpace(ctx.APITokenID)
	}
	if ctx.UserID != "" {
		return "user", strings.TrimSpace(ctx.UserID)
	}
	return "user", strings.TrimSpace(ctx.UserID)
}
