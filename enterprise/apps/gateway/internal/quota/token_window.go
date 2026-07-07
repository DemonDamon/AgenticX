package quota

// Day/week token windows count per request identity (see rateKey), not rule.PoolScope shared pools.
// Dept/tenant poolScope does not change tok_day/tok_week keys.

import (
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
	return PoolKey{
		TenantID:  tenantID,
		ScopeType: scopeType,
		ScopeID:   identity,
		Period:    period,
	}
}

// checkTokenWindowLimits enforces day/week token ceilings with approximate counters.
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
			_, _ = t.poolCounter.Add(key, tokens, LedgerEventReserve, "")
			return warnResult("token_"+c.kind, rule), true
		}
		if _, addErr := t.poolCounter.Add(key, tokens, LedgerEventReserve, ""); addErr != nil && rule.Action == ActionBlock {
			return blockedResult("token_"+c.kind, rule, current, c.limit), true
		}
	}
	return CheckResult{}, false
}
