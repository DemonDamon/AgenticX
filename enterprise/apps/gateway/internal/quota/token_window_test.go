package quota

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestTokenWindowDayBlock(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":1000,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}

	if r := tracker.CheckRequest(ctx, 400, 0); !r.Allowed {
		t.Fatalf("first request should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 500, 0); !r.Allowed {
		t.Fatalf("second request should pass: %+v", r)
	}
	r3 := tracker.CheckRequest(ctx, 200, 0)
	if r3.Allowed {
		t.Fatalf("third request should block: %+v", r3)
	}
	if r3.Kind != "token_day" {
		t.Fatalf("unexpected kind: %s", r3.Kind)
	}
	if r3.Limit != 1000 {
		t.Fatalf("unexpected limit: %d", r3.Limit)
	}
}

func TestTokenWindowCrossDayReset(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":10,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}

	origNow := requestCountNow
	t.Cleanup(func() { requestCountNow = origNow })

	requestCountNow = func() time.Time {
		return time.Date(2026, 6, 7, 10, 0, 0, 0, time.UTC)
	}
	if r := tracker.CheckRequest(ctx, 10, 0); !r.Allowed {
		t.Fatalf("same-day first should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 1, 0); r.Allowed {
		t.Fatalf("same-day second should block: %+v", r)
	}

	requestCountNow = func() time.Time {
		return time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)
	}
	if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed {
		t.Fatalf("next-day should reset and pass: %+v", r)
	}
}

func TestTokenWindowDayAndWeekIndependent(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":200,"weeklyTokens":150,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}

	origNow := requestCountNow
	t.Cleanup(func() { requestCountNow = origNow })
	requestCountNow = func() time.Time {
		return time.Date(2026, 6, 7, 10, 0, 0, 0, time.UTC)
	}

	if r := tracker.CheckRequest(ctx, 90, 0); !r.Allowed {
		t.Fatalf("first request should pass: %+v", r)
	}
	// daily stays within 200 (90+70), but weekly exceeds 150.
	if r := tracker.CheckRequest(ctx, 70, 0); r.Allowed {
		t.Fatalf("weekly limit should block: %+v", r)
	}
}

func TestTokenWindowFeatureCanBeExplicitlyDisabled(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":1,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}

	for i := 0; i < 3; i++ {
		if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed {
			t.Fatalf("request %d should pass when feature off: %+v", i+1, r)
		}
	}
	if got := tracker.RemainingForWindow(ctx, QuotaWindowDay).Used; got != 3 {
		t.Fatalf("day usage should be recorded when feature is off, got %d", got)
	}
	if got := tracker.RemainingForWindow(ctx, QuotaWindowWeek).Used; got != 3 {
		t.Fatalf("week usage should be recorded when feature is off, got %d", got)
	}
}

func TestTokenWindowEnforcementIsOnByDefault(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":1,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}
	if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed {
		t.Fatalf("within limit should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 1, 0); r.Allowed || r.Kind != "token_day" {
		t.Fatalf("default-on enforcement should block: %+v", r)
	}
}

func TestTokenWindowUsageDoesNotDependOnPoolFeatureOrLimits(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":0,"weeklyTokens":0,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}

	if r := tracker.CheckRequest(ctx, 123, 0); !r.Allowed {
		t.Fatalf("unlimited request should pass: %+v", r)
	}
	day := tracker.RemainingForWindow(ctx, QuotaWindowDay)
	if !day.Unlimited || day.Used != 123 {
		t.Fatalf("unexpected unlimited day usage: %+v", day)
	}
	week := tracker.RemainingForWindow(ctx, QuotaWindowWeek)
	if !week.Unlimited || week.Used != 123 {
		t.Fatalf("unexpected unlimited week usage: %+v", week)
	}
}

func TestTokenWindowHardLimitLetsCurrentTurnFinishThenBlocksNextTurn(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff", TurnID: "turn-a"}

	if r := tracker.CheckRequest(ctx, 80, 0); !r.Allowed {
		t.Fatalf("pre-limit request should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 30, 0); !r.Allowed || !r.Warn || r.Description != "policy:quota:token_day_turn_grace" {
		t.Fatalf("first crossing should use turn grace: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 20, 0); !r.Allowed || !r.Warn {
		t.Fatalf("same turn should continue: %+v", r)
	}

	next := ctx
	next.TurnID = "turn-b"
	blocked := tracker.CheckRequest(next, 1, 0)
	if blocked.Allowed || blocked.Kind != "token_day" {
		t.Fatalf("new turn should block: %+v", blocked)
	}
	if blocked.Period == "" || blocked.ResetAt == "" {
		t.Fatalf("blocked result must retain window metadata: %+v", blocked)
	}
}

func TestMonthlyHardLimitLetsCurrentTurnFinishThenBlocksNextTurn(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff", TurnID: "turn-a"}

	if r := tracker.CheckRequest(ctx, 80, 0); !r.Allowed {
		t.Fatalf("pre-limit request should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 30, 0); !r.Allowed || !r.Warn || r.Description != "policy:quota:monthly_turn_grace" {
		t.Fatalf("monthly crossing should use turn grace: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 20, 0); !r.Allowed || !r.Warn {
		t.Fatalf("same turn should continue: %+v", r)
	}

	next := ctx
	next.TurnID = "turn-b"
	if r := tracker.CheckRequest(next, 1, 0); r.Allowed || r.Kind != "monthly" {
		t.Fatalf("new turn should block on monthly quota: %+v", r)
	}
}

func TestTurnThatExactlyExhaustsWindowCanStillFinish(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff", TurnID: "turn-at-boundary"}
	if r := tracker.CheckRequest(ctx, 100, 0); !r.Allowed || r.Warn {
		t.Fatalf("request reaching the exact limit should pass normally: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed || !r.Warn {
		t.Fatalf("same turn should continue after exactly exhausting the limit: %+v", r)
	}
	next := ctx
	next.TurnID = "next-turn"
	if r := tracker.CheckRequest(next, 1, 0); r.Allowed {
		t.Fatalf("new turn should remain blocked: %+v", r)
	}
}

func TestFinalUsageSettlementCanCrossLimitWithoutInterruptingTurn(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":100,"dailyTokens":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff", TurnID: "turn-a"}

	if r := tracker.CheckRequest(ctx, 90, 0); !r.Allowed {
		t.Fatalf("reservation should pass: %+v", r)
	}
	settled := tracker.ReconcileRequestUsage(ctx, 90, 110)
	if !settled.Allowed {
		t.Fatalf("actual usage settlement should be recorded: %+v", settled)
	}
	if got := tracker.RemainingForWindow(ctx, QuotaWindowDay).Used; got != 110 {
		t.Fatalf("daily actual usage=%d want=110", got)
	}
	if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed {
		t.Fatalf("same turn should continue after settlement crossing: %+v", r)
	}
	next := ctx
	next.TurnID = "turn-b"
	if r := tracker.CheckRequest(next, 1, 0); r.Allowed {
		t.Fatalf("new turn should block after actual usage crossing: %+v", r)
	}
}

func TestFailedCrossingRequestDoesNotLeaveTurnGrace(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":100,"dailyTokens":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff", TurnID: "failed-turn"}
	if r := tracker.CheckRequest(ctx, 80, 0); !r.Allowed {
		t.Fatalf("pre-limit request should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 30, 0); !r.Allowed {
		t.Fatalf("crossing request should receive grace: %+v", r)
	}
	if ok := tracker.RollbackRequest(ctx, 30); !ok {
		t.Fatal("failed request rollback did not persist")
	}
	fill := ctx
	fill.TurnID = "other-turn"
	if r := tracker.CheckRequest(fill, 20, 0); !r.Allowed {
		t.Fatalf("another turn should fill remaining quota: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 1, 0); r.Allowed {
		t.Fatalf("rolled-back crossing must not leave stale grace: %+v", r)
	}
}

func TestRolledBackCrossingCanRetryWithinTheSameBoundedLease(t *testing.T) {
	tracker, ctx := newTurnGraceTestTracker(t, 100)
	if r := tracker.CheckRequest(ctx, 80, 0); !r.Allowed {
		t.Fatalf("seed request should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 30, 0); !r.Allowed || !r.Warn {
		t.Fatalf("crossing should claim grace: %+v", r)
	}
	if ok := tracker.RollbackRequest(ctx, 30); !ok {
		t.Fatal("failed crossing should roll back")
	}
	if r := tracker.CheckRequest(ctx, 30, 0); !r.Allowed || !r.Warn {
		t.Fatalf("same task should be able to retry while below the limit and within its lease: %+v", r)
	}
}

func TestTokenWarningDoesNotBypassHardBudget(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":1,"action":"warn"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	budgetPath := writeBudgetConfig(t, dir, BudgetConfig{Users: map[string]BudgetRule{
		"u1": {Unit: BudgetUnitCostUSD, Period: BudgetPeriodDay, Limit: 0.5, Action: ActionBlock},
	}})
	tracker.budgetCfgPath = budgetPath
	tracker.budgetUsagePath = filepath.Join(dir, "budget-usage.json")

	result := tracker.CheckRequest(RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}, 2, 1)
	if result.Allowed || result.Kind != "budget" {
		t.Fatalf("hard budget must still run after token warning: %+v", result)
	}
	if got := tracker.RemainingForWindow(RequestContext{TenantID: "t1", UserID: "u1"}, QuotaWindowDay).Used; got != 0 {
		t.Fatalf("blocked downstream budget must refund daily reservation, used=%d", got)
	}
}

func TestConcurrentDayCrossingHasSingleTurnGraceOwner(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	first := NewTracker(cfgPath, usagePath, nil)
	// Two local-counter instances share only the locked counter file, matching
	// separate gateway processes on one host.
	second := NewTracker(cfgPath, filepath.Join(dir, "u-second.json"), nil)
	base := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff", TurnID: "seed"}
	if r := first.CheckRequest(base, 80, 0); !r.Allowed {
		t.Fatalf("seed request should pass: %+v", r)
	}

	results := concurrentCrossingResults(first, second, base, 30)
	assertSingleGraceOwner(t, results, "token_day")
	if got := first.RemainingForWindow(base, QuotaWindowDay).Used; got != 110 {
		t.Fatalf("daily usage=%d want=110 after one atomic crossing", got)
	}
}

func TestConcurrentMonthlyUserCrossingHasSingleTurnGraceOwner(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	first := NewTracker(cfgPath, usagePath, nil)
	// Simulate another replica with no shared legacy JSON. Both instances still
	// use the same tok_month counter, which is the hard-limit authority.
	second := NewTracker(cfgPath, filepath.Join(dir, "u-second.json"), nil)
	base := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff", TurnID: "seed"}
	if r := first.CheckRequest(base, 80, 0); !r.Allowed {
		t.Fatalf("seed request should pass: %+v", r)
	}

	results := concurrentCrossingResults(first, second, base, 30)
	assertSingleGraceOwner(t, results, "monthly")
	if got := first.RemainingForWindow(base, QuotaWindowMonth).Used; got != 110 {
		t.Fatalf("monthly usage=%d want=110 after one atomic crossing", got)
	}
}

func TestTurnGraceLeaseBindsClientTurnIDToAuthenticatedPrincipal(t *testing.T) {
	base := RequestContext{TenantID: "tenant-1", UserID: "user-1", APITokenID: "pat-1", TurnID: "raw-client-turn"}
	leaseID := turnGraceLeaseID(base)
	if leaseID == "" || leaseID == base.TurnID {
		t.Fatalf("turn id must be stored as an opaque lease fingerprint, got %q", leaseID)
	}
	if got := turnGraceLeaseID(base); got != leaseID {
		t.Fatalf("same authenticated turn must be stable: got %q want %q", got, leaseID)
	}
	differentUser := base
	differentUser.UserID = "user-2"
	if got := turnGraceLeaseID(differentUser); got == leaseID {
		t.Fatal("same raw turn id must not share a lease across users")
	}
	differentToken := base
	differentToken.APITokenID = "pat-2"
	if got := turnGraceLeaseID(differentToken); got == leaseID {
		t.Fatal("same raw turn id must not share a lease across personal access tokens")
	}
}

func TestReplayedClientTurnIDCannotContinueAfterLeaseExpires(t *testing.T) {
	tracker, ctx := newTurnGraceTestTracker(t, 100)
	now := time.Date(2026, 8, 18, 10, 0, 0, 0, time.UTC)
	originalGraceNow := turnGraceNow
	originalRequestNow := requestCountNow
	turnGraceNow = func() time.Time { return now }
	requestCountNow = func() time.Time { return now }
	t.Cleanup(func() {
		turnGraceNow = originalGraceNow
		requestCountNow = originalRequestNow
	})

	if r := tracker.CheckRequest(ctx, 80, 0); !r.Allowed {
		t.Fatalf("seed request should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 30, 0); !r.Allowed || !r.Warn {
		t.Fatalf("first crossing should claim bounded grace: %+v", r)
	}
	now = now.Add(turnGraceLeaseTTL + time.Second)
	if r := tracker.CheckRequest(ctx, 1, 0); r.Allowed || r.Kind != "token_day" {
		t.Fatalf("replayed raw turn id must block after lease expiry: %+v", r)
	}
}

func TestReplayedClientTurnIDCannotExceedLeaseCallBudget(t *testing.T) {
	tracker, ctx := newTurnGraceTestTracker(t, 100)
	if r := tracker.CheckRequest(ctx, 80, 0); !r.Allowed {
		t.Fatalf("seed request should pass: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 30, 0); !r.Allowed || !r.Warn {
		t.Fatalf("first crossing should claim bounded grace: %+v", r)
	}
	for call := 1; call < turnGraceLeaseMaxCalls; call++ {
		if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed {
			t.Fatalf("grace call %d/%d should pass: %+v", call+1, turnGraceLeaseMaxCalls, r)
		}
	}
	if r := tracker.CheckRequest(ctx, 1, 0); r.Allowed || r.Kind != "token_day" {
		t.Fatalf("replayed raw turn id must block after %d marked calls: %+v", turnGraceLeaseMaxCalls, r)
	}
}

func TestTurnGraceCannotExceedBoundedTokenOverage(t *testing.T) {
	tracker, ctx := newTurnGraceTestTracker(t, 100)
	if r := tracker.CheckRequest(ctx, 80, 0); !r.Allowed {
		t.Fatalf("seed request should pass: %+v", r)
	}
	allowance := turnGraceOverageAllowance(100)
	// This request lands exactly at the permitted aggregate overage.
	if r := tracker.CheckRequest(ctx, allowance+20, 0); !r.Allowed || !r.Warn {
		t.Fatalf("bounded crossing should pass at the allowance: %+v", r)
	}
	if r := tracker.CheckRequest(ctx, 1, 0); r.Allowed || r.Kind != "token_day" {
		t.Fatalf("one token beyond the grace allowance must block: %+v", r)
	}
}

func TestSharedPoolDoesNotReuseRawTurnIDAcrossUsers(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := writePoolQuotaConfig(t, dir, "dept-a", 100)
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	tracker := NewTracker(cfgPath, filepath.Join(dir, "usage.json"), nil)
	first := RequestContext{TenantID: "tenant-1", UserID: "u1", DeptID: "dept-a", Role: "staff", TurnID: "same-raw-header"}
	second := RequestContext{TenantID: "tenant-1", UserID: "u2", DeptID: "dept-a", Role: "staff", TurnID: "same-raw-header"}

	if d := tracker.CheckAndAddContext(first, 80, LedgerEventReserve); !d.Allowed {
		t.Fatalf("seed request should pass: %+v", d)
	}
	if d := tracker.CheckAndAddContext(first, 30, LedgerEventReserve); !d.Allowed || !d.Grace {
		t.Fatalf("first principal should claim grace: %+v", d)
	}
	if d := tracker.CheckAndAddContext(second, 1, LedgerEventReserve); d.Allowed {
		t.Fatalf("same raw turn header from another user must not reuse grace: %+v", d)
	}
}

func newTurnGraceTestTracker(t *testing.T, dailyLimit int64) (*Tracker, RequestContext) {
	t.Helper()
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "q.json")
	usagePath := filepath.Join(dir, "u.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	cfg := fmt.Sprintf(`{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"dailyTokens":%d,"action":"block"}},"departments":{},"apiTokens":{}}`, dailyLimit)
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	return NewTracker(cfgPath, usagePath, nil), RequestContext{
		TenantID: "tenant-1",
		UserID:   "u1",
		Role:     "staff",
		TurnID:   "raw-client-turn",
	}
}

func concurrentCrossingResults(first, second *Tracker, base RequestContext, tokens int64) []CheckResult {
	start := make(chan struct{})
	results := make(chan CheckResult, 2)
	var wg sync.WaitGroup
	for index, tracker := range []*Tracker{first, second} {
		wg.Add(1)
		go func(index int, tracker *Tracker) {
			defer wg.Done()
			ctx := base
			ctx.TurnID = fmt.Sprintf("concurrent-turn-%d", index)
			<-start
			results <- tracker.CheckRequest(ctx, tokens, 0)
		}(index, tracker)
	}
	close(start)
	wg.Wait()
	close(results)
	out := make([]CheckResult, 0, 2)
	for result := range results {
		out = append(out, result)
	}
	return out
}

func assertSingleGraceOwner(t *testing.T, results []CheckResult, blockedKind string) {
	t.Helper()
	allowed := 0
	blocked := 0
	for _, result := range results {
		if result.Allowed {
			allowed++
			if !result.Warn {
				t.Fatalf("crossing owner must expose grace warning: %+v", result)
			}
			continue
		}
		blocked++
		if result.Kind != blockedKind {
			t.Fatalf("blocked kind=%q want=%q: %+v", result.Kind, blockedKind, result)
		}
	}
	if allowed != 1 || blocked != 1 {
		t.Fatalf("atomic crossing allowed=%d blocked=%d results=%+v", allowed, blocked, results)
	}
}
