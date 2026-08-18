package quota

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestReservationReceiptSettlesAdmissionWindowsAcrossCalendarBoundary(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quota.json")
	usagePath := filepath.Join(dir, "usage.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	if err := os.WriteFile(cfgPath, []byte(`{
  "defaults":{"role":{},"model":{}},
  "users":{"u1":{"monthlyTokens":1000,"dailyTokens":1000,"weeklyTokens":1000,"action":"block"}},
  "departments":{},"apiTokens":{}
}`), 0o600); err != nil {
		t.Fatal(err)
	}

	originalNow := requestCountNow
	t.Cleanup(func() { requestCountNow = originalNow })
	admittedAt := time.Date(2026, 8, 31, 23, 59, 0, 0, time.UTC)
	requestCountNow = func() time.Time { return admittedAt }
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "tenant-1", UserID: "u1", Role: "staff", TurnID: "turn-boundary"}
	check := tracker.CheckRequest(ctx, 100, 0)
	if !check.Allowed || check.Reservation == nil {
		t.Fatalf("admission failed: %+v", check)
	}

	// Cross both the day and month boundary, and replace the live rule. A
	// recomputing settlement would write September and the new limits instead.
	requestCountNow = func() time.Time { return time.Date(2026, 9, 1, 0, 1, 0, 0, time.UTC) }
	if err := os.WriteFile(cfgPath, []byte(`{
  "defaults":{"role":{},"model":{}},
  "users":{"u1":{"monthlyTokens":999999,"dailyTokens":999999,"weeklyTokens":999999,"action":"warn"}},
  "departments":{},"apiTokens":{}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := tracker.SettleReservation(check.Reservation, 40, 0); err != nil {
		t.Fatalf("settle receipt: %v", err)
	}

	assertCounterUsed(t, tracker.tokenWindowCounter, tokenWindowPoolKey("day", ctx, "2026-08-31"), 40)
	assertCounterUsed(t, tracker.tokenWindowCounter, tokenWindowPoolKey("day", ctx, "2026-09-01"), 0)
	assertCounterUsed(t, tracker.tokenWindowCounter, tokenWindowPoolKey("month", ctx, "2026-08"), 40)
	assertCounterUsed(t, tracker.tokenWindowCounter, tokenWindowPoolKey("month", ctx, "2026-09"), 0)
}

func TestReservationReceiptRollbackIsExactAndIdempotent(t *testing.T) {
	tracker, ctx := newTurnGraceTestTracker(t, 1000)
	check := tracker.CheckRequest(ctx, 200, 0)
	if !check.Allowed || check.Reservation == nil {
		t.Fatalf("admission failed: %+v", check)
	}
	if err := tracker.RollbackReservation(check.Reservation); err != nil {
		t.Fatal(err)
	}
	if err := tracker.RollbackReservation(check.Reservation); err != nil {
		t.Fatalf("duplicate rollback must be idempotent: %v", err)
	}
	period := requestWindowPeriod("day", requestCountNow().UTC())
	assertCounterUsed(t, tracker.tokenWindowCounter, tokenWindowPoolKey("day", ctx, period), 0)
}

func TestBudgetReceiptSettlesTheAdmissionPeriod(t *testing.T) {
	dir := t.TempDir()
	budgetCfg := filepath.Join(dir, "budgets.json")
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", budgetCfg)
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(dir, "budget-usage.json"))
	if err := os.WriteFile(budgetCfg, []byte(`{
  "defaults":{},
  "tenants":{},"departments":{},
  "users":{"u1":{"unit":"tokens","period":"day","limit":1000,"warnThresholdPct":80,"action":"block"}}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	originalNow := budgetUsageNow
	t.Cleanup(func() { budgetUsageNow = originalNow })
	budgetUsageNow = func() time.Time { return time.Date(2026, 8, 31, 23, 59, 0, 0, time.UTC) }
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	ctx := RequestContext{TenantID: "tenant-1", UserID: "u1"}
	decision := tracker.CheckBudget(ctx, 100, 0)
	if !decision.Allowed || decision.reservation == nil {
		t.Fatalf("budget admission failed: %+v", decision)
	}

	budgetUsageNow = func() time.Time { return time.Date(2026, 9, 1, 0, 1, 0, 0, time.UTC) }
	if err := tracker.settleBudgetReceipt(decision.reservation, 100, 0, 40, 0); err != nil {
		t.Fatal(err)
	}
	rule := BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodDay}
	if got := tracker.readBudgetUsedLocked(rule, "user", "u1", "2026-08-31"); got != 40 {
		t.Fatalf("admission period usage=%v want=40", got)
	}
	if got := tracker.readBudgetUsedLocked(rule, "user", "u1", "2026-09-01"); got != 0 {
		t.Fatalf("completion period was incorrectly charged: %v", got)
	}
}

func TestSettlementDoesNotConsumeTurnGraceAdmissionCalls(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pool.json")
	counter := &LocalPoolCounter{usagePath: path, usageCache: map[string]int64{}}
	key := PoolKey{TenantID: "tenant-1", ScopeType: tokenScopeDay, ScopeID: "user::u1", Period: "2026-08-18"}
	leaseID := "lease-test"
	if _, err := counter.ReserveWithTurnGrace(key, 80, 100, 0, LedgerEventReserve, leaseID); err != nil {
		t.Fatal(err)
	}
	if result, err := counter.ReserveWithTurnGrace(key, 30, 100, 0, LedgerEventReserve, leaseID); err != nil || !result.Grace {
		t.Fatalf("crossing reserve failed result=%+v err=%v", result, err)
	}
	if result, err := counter.ReserveWithTurnGrace(key, 5, 100, 0, LedgerEventSettle, leaseID); err != nil || !result.Allowed {
		t.Fatalf("settle delta failed result=%+v err=%v", result, err)
	}
	rows := counter.readUsage()
	if len(rows) != 1 {
		t.Fatalf("rows=%d", len(rows))
	}
	if calls := rows[0].Leases[leaseID].Calls; calls != 1 {
		t.Fatalf("settlement consumed grace call budget: got %d want 1", calls)
	}
}

func TestAuthoritativeCounterMutationNeverFallsBackToLocal(t *testing.T) {
	primary := &erroringPoolCounter{err: errors.New("database unavailable")}
	fallback := &erroringPoolCounter{}
	counter := &fallbackPoolCounter{primary: primary, fallback: fallback}
	key := PoolKey{TenantID: "tenant-1", ScopeType: tokenScopeDay, ScopeID: "user::u1", Period: "2026-08-18"}

	if _, err := counter.Add(key, -10, LedgerEventRefund, ""); err == nil {
		t.Fatal("database mutation failure must propagate")
	}
	if fallback.addCalls != 0 {
		t.Fatalf("refund silently fell back to local counter: calls=%d", fallback.addCalls)
	}
	if _, err := counter.HasRequest(key, "lease-test"); err == nil {
		t.Fatal("database lease lookup failure must propagate")
	}
	if fallback.hasRequestCalls != 0 {
		t.Fatalf("lease lookup silently fell back locally: calls=%d", fallback.hasRequestCalls)
	}
	if _, err := counter.Current(key); err == nil {
		t.Fatal("database current failure must propagate")
	}
	if fallback.currentCalls != 0 {
		t.Fatalf("current silently returned a stale local value: calls=%d", fallback.currentCalls)
	}
}

func TestExplicitDatabaseBackendWithoutDatabaseFailsClosed(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "postgresql")
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	key := PoolKey{TenantID: "tenant-1", ScopeType: tokenScopeDay, ScopeID: "user::u1", Period: "2026-08-18"}
	for name, counter := range map[string]PoolCounter{
		"token-window": newTokenWindowCounter(nil, filepath.Join(t.TempDir(), "window.json")),
		"shared-pool":  newPoolCounter(nil, filepath.Join(t.TempDir(), "pool.json")),
	} {
		if _, err := counter.Add(key, 1, LedgerEventReserve, ""); err == nil {
			t.Fatalf("%s accepted a host-local mutation without its configured database", name)
		}
	}
}

func TestReceiptPropagatesAuthoritativeRefundFailureWithoutLocalMutation(t *testing.T) {
	primary := &erroringPoolCounter{err: errors.New("database unavailable")}
	fallback := &erroringPoolCounter{}
	tracker := &Tracker{tokenWindowCounter: &fallbackPoolCounter{primary: primary, fallback: fallback}}
	key := PoolKey{TenantID: "tenant-1", ScopeType: tokenScopeDay, ScopeID: "user::u1", Period: "2026-08-18"}
	receipt := newReservationReceipt(100, 0)
	receipt.addWindow(counterReservation{kind: counterTokenWindow, key: key, reserved: 100})

	if err := tracker.RollbackReservation(receipt); err == nil {
		t.Fatal("refund failure must be visible to the caller")
	}
	if fallback.addCalls != 0 {
		t.Fatalf("receipt refund silently mutated local fallback: calls=%d", fallback.addCalls)
	}
}

func TestTokenWindowAdmissionPropagatesAuthoritativeAddFailure(t *testing.T) {
	primary := &erroringPoolCounter{err: errors.New("database unavailable")}
	fallback := &erroringPoolCounter{}
	tracker := &Tracker{tokenWindowCounter: &fallbackPoolCounter{primary: primary, fallback: fallback}}
	receipt := newReservationReceipt(100, 0)
	result, handled := tracker.checkTokenWindowLimits(
		RequestContext{TenantID: "tenant-1", UserID: "u1", TurnID: "turn-1"},
		Rule{DailyTokens: 1000, Action: ActionWarn},
		100,
		receipt,
	)
	if !handled || result.Allowed || result.Kind != "quota_unavailable" {
		t.Fatalf("authoritative add error was not propagated: %+v handled=%v", result, handled)
	}
	if result.Headers["X-AgenticX-Quota-Retryable"] != "true" {
		t.Fatalf("missing retryable marker: %+v", result.Headers)
	}
	if fallback.addCalls != 0 {
		t.Fatalf("admission silently fell back to local counter: calls=%d", fallback.addCalls)
	}
}

func TestConcurrentReceiptSettlementMirrorsAuthoritativeMonthlyUsage(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quota.json")
	usagePath := filepath.Join(dir, "usage.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	if err := os.WriteFile(cfgPath, []byte(`{
  "defaults":{"role":{},"model":{}},
  "users":{"u1":{"monthlyTokens":10000,"action":"block"}},
  "departments":{},"apiTokens":{}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	base := RequestContext{TenantID: "tenant-1", UserID: "u1", Role: "staff"}
	checks := make([]CheckResult, 2)
	for index := range checks {
		ctx := base
		ctx.TurnID = fmt.Sprintf("turn-%d", index)
		checks[index] = tracker.CheckRequest(ctx, 100, 0)
		if !checks[index].Allowed || checks[index].Reservation == nil {
			t.Fatalf("admission %d failed: %+v", index, checks[index])
		}
	}

	actual := []int64{40, 60}
	var wg sync.WaitGroup
	errs := make(chan error, len(checks))
	for index := range checks {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			errs <- tracker.SettleReservation(checks[index].Reservation, actual[index], 0)
		}(index)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}

	period := requestWindowPeriod("month", requestCountNow().UTC())
	assertCounterUsed(t, tracker.tokenWindowCounter, tokenWindowPoolKey("month", base, period), 100)
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var rows []usageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].UsedTotal != 100 {
		t.Fatalf("compatibility mirror is stale: %s", raw)
	}
}

func TestConcurrencyReleaseOwnershipTransfersOnlyAfterSuccessfulAdmission(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quota.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	if err := os.WriteFile(cfgPath, []byte(`{
  "defaults":{"role":{},"model":{}},
  "users":{"concurrency-owner":{"monthlyTokens":0,"maxConcurrency":1,"action":"block"}},
  "departments":{},"apiTokens":{}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, filepath.Join(dir, "usage.json"), nil)
	ctx := RequestContext{TenantID: "tenant-concurrency-owner", UserID: "concurrency-owner", Role: "staff", TurnID: "turn-a"}
	first := tracker.CheckRequest(ctx, 1, 0)
	if !first.Allowed || !first.ConcurrencyAcquired {
		t.Fatalf("successful admission did not transfer release ownership: %+v", first)
	}
	ctx.TurnID = "turn-b"
	blocked := tracker.CheckRequest(ctx, 1, 0)
	if blocked.Allowed || blocked.ConcurrencyAcquired || blocked.Kind != "concurrency" {
		t.Fatalf("rejected admission incorrectly owns a release: %+v", blocked)
	}
	ctx.TurnID = "turn-c"
	stillBlocked := tracker.CheckRequest(ctx, 1, 0)
	if stillBlocked.Allowed {
		t.Fatalf("a rejected admission released another request's slot: %+v", stillBlocked)
	}
	tracker.ReleaseConcurrency(ctx)
	ctx.TurnID = "turn-d"
	afterRelease := tracker.CheckRequest(ctx, 1, 0)
	if !afterRelease.Allowed || !afterRelease.ConcurrencyAcquired {
		t.Fatalf("exactly one release did not reopen the slot: %+v", afterRelease)
	}
	tracker.ReleaseConcurrency(ctx)
}

func assertCounterUsed(t *testing.T, counter PoolCounter, key PoolKey, want int64) {
	t.Helper()
	got, err := counter.Current(key)
	if err != nil {
		t.Fatalf("current %s: %v", key.cacheKey(), err)
	}
	if got != want {
		t.Fatalf("current %s=%d want=%d", key.cacheKey(), got, want)
	}
}

type erroringPoolCounter struct {
	err             error
	addCalls        int
	currentCalls    int
	hasRequestCalls int
}

func (c *erroringPoolCounter) Add(PoolKey, int64, string, string) (int64, error) {
	c.addCalls++
	return 0, c.err
}

func (c *erroringPoolCounter) Current(PoolKey) (int64, error) {
	c.currentCalls++
	return 0, c.err
}

func (c *erroringPoolCounter) HasRequest(PoolKey, string) (bool, error) {
	c.hasRequestCalls++
	return false, c.err
}

func (c *erroringPoolCounter) ReserveWithTurnGrace(PoolKey, int64, int64, int64, string, string) (TurnGraceReservation, error) {
	return TurnGraceReservation{}, fmt.Errorf("reserve: %w", c.err)
}
