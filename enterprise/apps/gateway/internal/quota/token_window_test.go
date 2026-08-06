package quota

import (
	"os"
	"path/filepath"
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

func TestTokenWindowFeatureOffByDefault(t *testing.T) {
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
