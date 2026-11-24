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

// reserveTokenWindowReceipt records successful precharges before checking later windows.
func (t *Tracker) reserveTokenWindowReceipt(ctx RequestContext, rule Rule, tokens int64, receipt *ReservationReceipt) (CheckResult, bool) {
	if t == nil || t.poolCounter == nil || !tokenWindowFeatureEnabled() || tokens <= 0 {
		return CheckResult{}, false
	}
	var warning CheckResult
	for _, c := range []struct {
		kind  string
		limit int64
	}{{"day", rule.DailyTokens}, {"week", rule.WeeklyTokens}} {
		if c.limit <= 0 {
			continue
		}
		period := requestWindowPeriod(c.kind, requestCountNow())
		key := tokenWindowPoolKey(c.kind, ctx, period)
		current, err := t.poolCounter.Current(key)
		if err != nil {
			return CheckResult{Allowed: false, StorageError: true, Kind: "token_" + c.kind, Rule: rule, Description: "quota window storage failed"}, true
		}
		if current+tokens > c.limit {
			if rule.Action == ActionBlock {
				return blockedResult("token_"+c.kind, rule, current, c.limit), true
			}
			warning = warnResult("token_"+c.kind, rule)
		}
		line := ReservationLine{Kind: c.kind, Key: key, Period: period, Rule: rule, Reserved: tokens, ReserveID: receipt.ID + "/reserve/" + c.kind}
		_, databaseCounter := t.poolCounter.(*PGPoolCounter)
		if databaseCounter {
			receipt.Lines = append(receipt.Lines, line)
		}
		if _, err = t.poolCounter.Add(key, tokens, LedgerEventReserve, line.ReserveID); err != nil {
			return CheckResult{Allowed: false, StorageError: true, Kind: "token_" + c.kind, Rule: rule, Description: "quota window storage failed"}, true
		}
		if !databaseCounter {
			receipt.Lines = append(receipt.Lines, line)
		}
	}
	return warning, warning.Warn
}
