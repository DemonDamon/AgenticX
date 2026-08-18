package quota

// RollbackRequest releases a failed chat request from every calendar token
// window which was reserved by CheckRequest. Rate/concurrency counters retain
// their existing semantics and are handled separately.
func (t *Tracker) RollbackRequest(ctx RequestContext, reserved int64) bool {
	if t == nil || reserved <= 0 {
		return true
	}
	t.rollbackTokenWindowUsage(ctx, reserved)
	return t.RollbackContext(ctx, reserved)
}

// ReconcileRequestUsage replaces a chat request's estimate with provider usage.
// The consumed usage is always recorded, even when final settlement is the
// point that crosses a hard limit; the bounded TurnID lease can then let only
// this authenticated top-level task finish within its TTL/call/token bounds.
func (t *Tracker) ReconcileRequestUsage(ctx RequestContext, reserved, actual int64) Decision {
	delta := actual - reserved
	if t == nil || delta == 0 {
		return Decision{Allowed: true}
	}
	if delta < 0 {
		t.rollbackTokenWindowUsage(ctx, -delta)
		t.RollbackContext(ctx, -delta)
		return Decision{Allowed: true}
	}

	t.settleTokenWindowUsage(ctx, delta)
	decision := t.CheckAndAddContext(ctx, delta, LedgerEventSettle)
	if decision.Allowed {
		return decision
	}
	usedAfter, ok := t.AddUsageContext(ctx, delta)
	decision.UsedAfter = usedAfter
	decision.ExceededBy = max64(usedAfter-decision.Rule.MonthlyTokens, 0)
	decision.Description = "quota usage settled after hard limit"
	decision.Allowed = ok
	return decision
}
