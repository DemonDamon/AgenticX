package quota

// Day/week token windows count per request identity (see rateKey), not rule.PoolScope shared pools.
// Dept/tenant poolScope does not change tok_day/tok_week keys.

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	tokenScopeDay   = "tok_day"
	tokenScopeWeek  = "tok_week"
	tokenScopeMonth = "tok_month"
)

func turnGraceLeaseID(ctx RequestContext) string {
	turnID := normalizedRequestID(ctx.TurnID)
	if turnID == "" {
		return ""
	}
	principal := "tenant:" + strings.TrimSpace(ctx.TenantID)
	if userID := strings.TrimSpace(ctx.UserID); userID != "" {
		principal += "|user:" + userID
	}
	if tokenID := strings.TrimSpace(ctx.APITokenID); tokenID != "" {
		principal += "|pat:" + tokenID
	} else if userID := strings.TrimSpace(ctx.UserID); userID == "" {
		if deptID := strings.TrimSpace(ctx.DeptID); deptID != "" {
			principal += "|dept:" + deptID
		}
	}
	sum := sha256.Sum256([]byte(principal + "|turn:" + turnID))
	return "lease-" + hex.EncodeToString(sum[:])
}

func tokenWindowFeatureEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_TOKEN_WINDOW_QUOTA"))) {
	case "off", "false", "0":
		return false
	default:
		return true
	}
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

// checkTokenWindowLimits records day/week usage and optionally enforces the
// configured ceilings. A non-empty TurnID can claim a bounded lease when it
// first crosses a hard ceiling; only later gateway calls from the same
// authenticated principal and top-level turn may use that lease, subject to
// its TTL, call count and token-overage bounds. A different turn is blocked.
//
// Database-backed counters persist the grace marker in the existing
// gateway_quota_ledger.request_id column. The raw client id is never stored.
// The local counter persists the same lease in its locked JSON file; it is not
// a cross-host fallback.
func (t *Tracker) checkTokenWindowLimits(ctx RequestContext, rule Rule, tokens int64, receipt *ReservationReceipt) (CheckResult, bool) {
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
	now := requestCountNow().UTC()
	var warning CheckResult
	for _, c := range checks {
		period := requestWindowPeriod(c.kind, now)
		key := tokenWindowPoolKey(c.kind, ctx, period)
		if enforce && c.limit > 0 && rule.Action == ActionBlock {
			reservation, reserveErr := t.tokenWindowCounter.ReserveWithTurnGrace(
				key,
				tokens,
				c.limit,
				0,
				LedgerEventReserve,
				turnGraceLeaseID(ctx),
			)
			if reserveErr != nil {
				return quotaStorageUnavailableResult("token_"+c.kind, period, reserveErr), true
			}
			if !reservation.Allowed {
				return blockedWindowResult("token_"+c.kind, rule, reservation.UsedBefore, c.limit, period, now), true
			}
			if reservation.Grace {
				warning = graceWindowResult("token_"+c.kind, rule, reservation.UsedAfter, c.limit, period, now)
			}
			receipt.addWindow(counterReservation{
				kind: counterTokenWindow, key: key, ctx: ctx, rule: rule,
				period: period, reserved: tokens, leaseID: turnGraceLeaseID(ctx),
			})
			continue
		}

		usedAfter, addErr := t.tokenWindowCounter.Add(key, tokens, LedgerEventReserve, "")
		if addErr != nil {
			return quotaStorageUnavailableResult("token_"+c.kind, period, addErr), true
		}
		if enforce && c.limit > 0 && rule.Action != ActionBlock && usedAfter > c.limit {
			warning = warnWindowResult("token_"+c.kind, rule, usedAfter, c.limit, period, now)
		}
		receipt.addWindow(counterReservation{
			kind: counterTokenWindow, key: key, ctx: ctx, rule: rule,
			period: period, reserved: tokens, leaseID: turnGraceLeaseID(ctx),
		})
	}
	if warning.Warn {
		return warning, true
	}
	return CheckResult{}, false
}

func quotaStorageUnavailableResult(sourceKind, period string, err error) CheckResult {
	description := "quota counter unavailable"
	if err != nil {
		description = fmt.Sprintf("quota counter unavailable: %v", err)
	}
	return CheckResult{
		Allowed:     false,
		Kind:        "quota_unavailable",
		Period:      period,
		Description: description,
		Headers: map[string]string{
			"Retry-After":                    "1",
			"X-AgenticX-Quota-Retryable":     "true",
			"X-AgenticX-Quota-Source-Window": sourceKind,
		},
	}
}

func (t *Tracker) rollbackTokenWindowUsage(ctx RequestContext, tokens int64) {
	if t == nil || t.tokenWindowCounter == nil || tokens <= 0 {
		return
	}
	now := requestCountNow().UTC()
	leaseID := turnGraceLeaseID(ctx)
	for _, kind := range []string{"day", "week"} {
		period := requestWindowPeriod(kind, now)
		key := tokenWindowPoolKey(kind, ctx, period)
		_, _ = t.tokenWindowCounter.Add(key, -tokens, LedgerEventRefund, activeTurnMarker(t.tokenWindowCounter, key, leaseID))
	}
}

func activeTurnMarker(counter PoolCounter, key PoolKey, leaseID string) string {
	leaseID = normalizedRequestID(leaseID)
	if counter == nil || leaseID == "" {
		return ""
	}
	active, err := counter.HasRequest(key, leaseID)
	if err != nil || !active {
		return ""
	}
	return leaseID
}

func (t *Tracker) settleTokenWindowUsage(ctx RequestContext, delta int64) {
	if t == nil || t.tokenWindowCounter == nil || delta == 0 {
		return
	}
	if delta < 0 {
		t.rollbackTokenWindowUsage(ctx, -delta)
		return
	}
	cfg := t.loadConfigForTenant(ctx.TenantID)
	rule := selectRuleExtended(cfg, ctx)
	now := requestCountNow().UTC()
	for _, item := range []struct {
		kind  string
		limit int64
	}{
		{kind: "day", limit: rule.DailyTokens},
		{kind: "week", limit: rule.WeeklyTokens},
	} {
		period := requestWindowPeriod(item.kind, now)
		key := tokenWindowPoolKey(item.kind, ctx, period)
		if tokenWindowFeatureEnabled() && item.limit > 0 && rule.Action == ActionBlock {
			reservation, err := t.tokenWindowCounter.ReserveWithTurnGrace(
				key,
				delta,
				item.limit,
				0,
				LedgerEventSettle,
				turnGraceLeaseID(ctx),
			)
			if err == nil && reservation.Allowed {
				continue
			}
			// Provider usage has already been consumed. Record a blocked final
			// delta without granting this turn a grace marker, so its next gateway
			// request remains blocked.
		}
		_, _ = t.tokenWindowCounter.Add(key, delta, LedgerEventSettle, "")
	}
}

func blockedWindowResult(kind string, rule Rule, used, limit int64, period string, now time.Time) CheckResult {
	result := blockedResult(kind, rule, used, limit)
	applyWindowMetadata(&result, kind, period, now)
	return result
}

func warnWindowResult(kind string, rule Rule, used, limit int64, period string, now time.Time) CheckResult {
	result := warnResult(kind, rule)
	result.Used = used
	result.Limit = limit
	applyWindowMetadata(&result, kind, period, now)
	return result
}

func graceWindowResult(kind string, rule Rule, used, limit int64, period string, now time.Time) CheckResult {
	result := warnWindowResult(kind, rule, used, limit, period, now)
	result.Description = "policy:quota:" + kind + "_turn_grace"
	result.Headers["X-AgenticX-Quota-Grace"] = kind
	return result
}

func applyWindowMetadata(result *CheckResult, kind, period string, now time.Time) {
	if result == nil {
		return
	}
	result.Period = period
	result.ResetAt = resetAtForQuotaKind(kind, now).Format(time.RFC3339)
	if result.Headers == nil {
		result.Headers = map[string]string{}
	}
	result.Headers["X-AgenticX-Quota-Period"] = result.Period
	result.Headers["X-AgenticX-Quota-Reset-At"] = result.ResetAt
}

func resetAtForQuotaKind(kind string, now time.Time) time.Time {
	now = now.UTC()
	switch strings.TrimPrefix(strings.TrimSpace(kind), "token_") {
	case "day":
		return time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	case "week":
		daysUntilMonday := (8 - int(now.Weekday())) % 7
		if daysUntilMonday == 0 {
			daysUntilMonday = 7
		}
		return time.Date(now.Year(), now.Month(), now.Day()+daysUntilMonday, 0, 0, 0, 0, time.UTC)
	default:
		return time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	}
}
