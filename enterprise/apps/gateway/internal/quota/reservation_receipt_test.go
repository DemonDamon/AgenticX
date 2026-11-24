package quota

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func receiptTracker(t *testing.T, rule Rule) (*Tracker, RequestContext) {
	t.Helper()
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "off")
	t.Setenv("GATEWAY_BUDGET_BACKEND", "")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", "")
	d := t.TempDir()
	cfg := filepath.Join(d, "quotas.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(d, "pool.json"))
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(d, "budgets-usage.json"))
	bp := filepath.Join(d, "budgets.json")
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", bp)
	if err := os.WriteFile(bp, []byte(`{"version":2}`), 0600); err != nil {
		t.Fatal(err)
	}
	receiptWriteRule(t, cfg, rule)
	return NewTracker(cfg, filepath.Join(d, "usage.json"), nil), RequestContext{TenantID: "receipt-tenant", UserID: "receipt-user", Role: "staff", Model: "m"}
}
func receiptWriteRule(t *testing.T, path string, rule Rule) {
	t.Helper()
	cfg := Config{Users: map[string]Rule{"receipt-user": rule}}
	b, _ := json.Marshal(cfg)
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
}
func receiptUsed(t *testing.T, tr *Tracker, key PoolKey) int64 {
	t.Helper()
	got, err := tr.poolCounter.Current(key)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func TestReservationLaterWindowDenialRefundsEarlierWindow(t *testing.T) {
	tr, ctx := receiptTracker(t, Rule{DailyTokens: 200, WeeklyTokens: 150, Action: ActionBlock})
	first := tr.CheckRequest(ctx, 90, 0)
	if !first.Allowed {
		t.Fatal(first)
	}
	second := tr.CheckRequest(ctx, 70, 0)
	if second.Allowed || second.Kind != "token_week" {
		t.Fatal(second)
	}
	for _, line := range first.Reservation.Lines {
		if got := receiptUsed(t, tr, line.Key); got != 90 {
			t.Fatalf("%s=%d want90", line.Kind, got)
		}
	}
}
func TestReservationBudgetDenialRefundsTokensButNotRequests(t *testing.T) {
	tr, ctx := receiptTracker(t, Rule{MonthlyTokens: 1000, DailyTokens: 1000, WeeklyTokens: 1000, RequestsPerDay: 10, Action: ActionBlock})
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "on")
	if err := os.WriteFile(tr.budgetCfgPath, []byte(`{"version":2,"users":{"receipt-user":{"unit":"tokens","period":"month","limit":20,"action":"block"}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	denied := tr.CheckRequest(ctx, 30, 0)
	if denied.Allowed || denied.Kind != "budget" {
		t.Fatal(denied)
	}
	for _, line := range denied.Reservation.Lines {
		if line.Kind == "monthly_user" {
			continue
		}
		if got := receiptUsed(t, tr, line.Key); got != 0 {
			t.Fatalf("%s=%d", line.Kind, got)
		}
	}
	if got := tr.Remaining(ctx).Used; got != 0 {
		t.Fatalf("monthly=%d", got)
	}
	key := requestWindowKey("day", ctx, requestWindowPeriod("day", requestCountNow()))
	if got := tr.requestCounter.local[key]; got != 1 {
		t.Fatalf("request count=%d want1", got)
	}
}
func TestReservationImmutableRowsAndConcurrentTerminal(t *testing.T) {
	tr, ctx := receiptTracker(t, Rule{MonthlyTokens: 1000, DailyTokens: 1000, WeeklyTokens: 1000, Action: ActionBlock})
	oldNow := requestCountNow
	t.Cleanup(func() { requestCountNow = oldNow })
	requestCountNow = func() time.Time { return time.Date(2026, 1, 31, 23, 59, 0, 0, time.UTC) }
	check := tr.CheckRequest(ctx, 100, 0)
	if !check.Allowed {
		t.Fatal(check)
	}
	receiptWriteRule(t, tr.cfgPath, Rule{MonthlyTokens: 1, PoolScope: PoolScopeTenant, Action: ActionBlock})
	requestCountNow = func() time.Time { return time.Date(2026, 2, 1, 0, 1, 0, 0, time.UTC) }
	var wg sync.WaitGroup
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := tr.FinishReservation(check.Reservation, 25, 0); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if err := tr.FinishReservation(check.Reservation, 0, 0); err != nil {
		t.Fatal(err)
	}
	for _, line := range check.Reservation.Lines {
		if line.Kind == "monthly_user" {
			if line.Period != "2026-01" {
				t.Fatal(line)
			}
			continue
		}
		if got := receiptUsed(t, tr, line.Key); got != 25 {
			t.Fatalf("%s=%d want25", line.Kind, got)
		}
	}
	raw, _ := os.ReadFile(tr.usagePath)
	var rows []usageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Month != "2026-01" || rows[0].UsedTotal != 25 {
		t.Fatalf("monthly rows=%s", raw)
	}
}
func TestReservationZeroUsageAndCapturedConcurrencyRelease(t *testing.T) {
	tr, ctx := receiptTracker(t, Rule{MonthlyTokens: 1000, DailyTokens: 1000, MaxConcurrency: 1, Action: ActionBlock})
	check := tr.CheckRequest(ctx, 100, 0)
	if !check.Allowed {
		t.Fatal(check)
	}
	denied := tr.CheckRequest(ctx, 1, 0)
	if denied.Allowed || denied.Kind != "concurrency" {
		t.Fatal(denied)
	}
	// A denied request must not release the first request's slot.
	again := tr.CheckRequest(ctx, 1, 0)
	if again.Allowed {
		t.Fatal("denied request released another owner's slot")
	}
	receiptWriteRule(t, tr.cfgPath, Rule{})
	if err := tr.FinishReservation(check.Reservation, 0, 0); err != nil {
		t.Fatal(err)
	}
	tr.ReleaseReservation(check.Reservation)
	tr.ReleaseReservation(check.Reservation)
	lim := sharedLimiter()
	lim.mu.Lock()
	cur := lim.concurrency[rateKey("concurrency", ctx)]
	lim.mu.Unlock()
	if cur != 0 {
		t.Fatalf("slot leaked=%d", cur)
	}
	for _, line := range check.Reservation.Lines {
		if line.Kind != "monthly_user" && receiptUsed(t, tr, line.Key) != 0 {
			t.Fatal("window not refunded")
		}
	}
}

type receiptFaultCounter struct {
	base    PoolCounter
	failKey string
	failed  bool
	calls   map[string]int
}

func (c *receiptFaultCounter) Current(k PoolKey) (int64, error) { return c.base.Current(k) }
func (c *receiptFaultCounter) Add(k PoolKey, d int64, e, id string) (int64, error) {
	c.calls[k.cacheKey()]++
	if k.cacheKey() == c.failKey && !c.failed {
		c.failed = true
		return 0, errors.New("synthetic unavailable")
	}
	return c.base.Add(k, d, e, id)
}
func TestReservationRetriesOnlyIncompleteOriginalOutcome(t *testing.T) {
	tr, ctx := receiptTracker(t, Rule{DailyTokens: 1000, WeeklyTokens: 1000, Action: ActionBlock})
	check := tr.CheckRequest(ctx, 100, 0)
	if !check.Allowed {
		t.Fatal(check)
	}
	fault := &receiptFaultCounter{base: tr.poolCounter, failKey: check.Reservation.Lines[1].Key.cacheKey(), calls: map[string]int{}}
	tr.poolCounter = fault
	if err := tr.FinishReservation(check.Reservation, 25, 0); err == nil {
		t.Fatal("expected storage failure")
	}
	if err := tr.FinishReservation(check.Reservation, 0, 0); err != nil {
		t.Fatal(err)
	}
	for i, line := range check.Reservation.Lines {
		if got := receiptUsed(t, tr, line.Key); got != 25 {
			t.Fatalf("%s=%d want25", line.Kind, got)
		}
		want := i + 1
		if fault.calls[line.Key.cacheKey()] != want {
			t.Fatalf("line%d writes=%d", i, fault.calls[line.Key.cacheKey()])
		}
	}
}
func TestReservationConfiguredDatabaseDoesNotFallback(t *testing.T) {
	tr, ctx := receiptTracker(t, Rule{DailyTokens: 1000, Action: ActionBlock})
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "pg")
	broken := NewTracker(tr.cfgPath, tr.usagePath, nil)
	check := broken.CheckRequest(ctx, 10, 0)
	if check.Allowed || !check.StorageError {
		t.Fatalf("expected storage refusal: %+v", check)
	}
	if _, err := os.Stat(tr.poolUsagePath); !os.IsNotExist(err) {
		t.Fatalf("unexpected local fallback file: %v", err)
	}
}

func TestReservationRequestDatabaseDoesNotFallback(t *testing.T) {
	tr, ctx := receiptTracker(t, Rule{RequestsPerDay: 1000, Action: ActionWarn})
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "on")
	t.Setenv("GATEWAY_REQUEST_COUNT_BACKEND", "pg")
	broken := NewTracker(tr.cfgPath, tr.usagePath, nil)
	check := broken.CheckRequest(ctx, 10, 0)
	if check.Allowed || !check.StorageError {
		t.Fatalf("expected request storage refusal: %+v", check)
	}
	if len(broken.requestCounter.local) != 0 {
		t.Fatal("database failure populated local request counter")
	}
}
