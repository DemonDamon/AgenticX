package quota

// Day/week token windows count per request identity (see rateKey), not rule.PoolScope shared pools.
// Dept/tenant poolScope does not change tok_day/tok_week keys.

import (
	"os"
	"strings"
)

const (
	tokenScopeDay   = "tok_day"
	tokenScopeWeek  = "tok_week"
	tokenScopeMonth = "tok_month"
)

func tokenWindowFeatureEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("GATEWAY_TOKEN_WINDOW_QUOTA")), "on")
}

func tokenWindowPoolKey(kind string, ctx RequestContext, period string) PoolKey {
	scopeType := tokenScopeDay
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "week":
		scopeType = tokenScopeWeek
	case "month":
		scopeType = tokenScopeMonth
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

// checkTokenWindowLimits records day/week usage with approximate counters and
// optionally enforces the configured ceilings. The enforcement feature flag is
// intentionally independent from metering: the portal must still show usage
// when a window is unlimited or hard enforcement is disabled.
func (t *Tracker) checkTokenWindowLimits(ctx RequestContext, rule Rule, tokens int64) (CheckResult, bool) {
	if t == nil || t.tokenWindowCounter == nil || tokens <= 0 {
		return CheckResult{}, false
	}
	enforce := tokenWindowFeatureEnabled()
	checks := []struct {
		kind  string
		limit int64
	}{
		{"day", rule.DailyTokens},
		{"week", rule.WeeklyTokens},
	}
	now := requestCountNow()
	for _, c := range checks {
		period := requestWindowPeriod(c.kind, now)
		key := tokenWindowPoolKey(c.kind, ctx, period)
		if enforce && c.limit > 0 {
			current, err := t.tokenWindowCounter.Current(key)
			if err != nil && rule.Action == ActionBlock {
				return blockedResult("token_"+c.kind, rule, current, c.limit), true
			}
			if current+tokens > c.limit {
				if rule.Action == ActionBlock {
					return blockedResult("token_"+c.kind, rule, current, c.limit), true
				}
				_, _ = t.tokenWindowCounter.Add(key, tokens, LedgerEventReserve, "")
				return warnResult("token_"+c.kind, rule), true
			}
		}
		if _, addErr := t.tokenWindowCounter.Add(key, tokens, LedgerEventReserve, ""); addErr != nil && enforce && c.limit > 0 && rule.Action == ActionBlock {
			current, _ := t.tokenWindowCounter.Current(key)
			return blockedResult("token_"+c.kind, rule, current, c.limit), true
		}
	}
	return CheckResult{}, false
}
