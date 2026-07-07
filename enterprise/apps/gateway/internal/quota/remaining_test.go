package quota

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestRemainingUnlimitedWhenNoQuota(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	if err := os.WriteFile(cfgPath, []byte(`{"defaults":{"role":{},"model":{}},"users":{},"departments":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, filepath.Join(dir, "usage.json"), nil)
	result := tracker.Remaining(RequestContext{UserID: "u1", DeptID: "d1", Role: "staff"})
	if !result.Unlimited {
		t.Fatalf("expected unlimited, got %+v", result)
	}
	if result.Remaining != nil {
		t.Fatalf("expected nil remaining, got %v", *result.Remaining)
	}
}

func TestRemainingUserScope(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	body := `{"defaults":{"role":{"staff":{"monthlyTokens":500000,"action":"block"}},"model":{}},"users":{},"departments":{}}`
	if err := os.WriteFile(cfgPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	usagePath := filepath.Join(dir, "usage.json")
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{UserID: "u1", DeptID: "d1", Role: "staff", Model: "m"}
	if d := tracker.CheckAndAddContext(ctx, 120_000, LedgerEventReserve); !d.Allowed {
		t.Fatalf("reserve denied: %+v", d)
	}
	result := tracker.Remaining(ctx)
	if result.Unlimited || result.Limit != 500_000 {
		t.Fatalf("unexpected limit: %+v", result)
	}
	if result.Used != 120_000 {
		t.Fatalf("used=%d want 120000", result.Used)
	}
	if result.Remaining == nil || *result.Remaining != 380_000 {
		t.Fatalf("remaining=%v want 380000", result.Remaining)
	}
}

func TestRemainingSharedPoolDept(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := writePoolQuotaConfig(t, dir, "dept-a", 1_000_000)
	poolUsagePath := filepath.Join(dir, "pool-usage.json")
	usagePath := filepath.Join(dir, "usage.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", poolUsagePath)

	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx1 := RequestContext{TenantID: "tenant-1", UserID: "u1", DeptID: "dept-a", Role: "staff", Model: "m"}
	ctx2 := RequestContext{TenantID: "tenant-1", UserID: "u2", DeptID: "dept-a", Role: "staff", Model: "m"}
	if d := tracker.CheckAndAddContext(ctx1, 600_000, LedgerEventReserve); !d.Allowed {
		t.Fatalf("reserve denied: %+v", d)
	}
	r1 := tracker.RemainingForScope("dept", "dept-a", "tenant-1", ctx1)
	r2 := tracker.Remaining(ctx2)
	if r1.Used != 600_000 || r1.Limit != 1_000_000 {
		t.Fatalf("admin dept view: %+v", r1)
	}
	if r1.Remaining == nil || *r1.Remaining != 400_000 {
		t.Fatalf("remaining=%v want 400000", r1.Remaining)
	}
	if !r1.Shared {
		t.Fatalf("expected shared pool flag")
	}
	if r2.Scope != "dept" || r2.Used != 600_000 {
		t.Fatalf("member dept remaining mismatch: %+v", r2)
	}
	if r2.Remaining == nil || *r2.Remaining != 400_000 {
		t.Fatalf("member remaining=%v want 400000", r2.Remaining)
	}
}

func TestRemainingForScopePat(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	body := `{"defaults":{"role":{},"model":{}},"users":{},"departments":{},"apiTokens":{"pat-1":{"monthlyTokens":` + strconv.Itoa(200_000) + `,"action":"block"}}}`
	if err := os.WriteFile(cfgPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	usagePath := filepath.Join(dir, "usage.json")
	month := time.Now().UTC().Format("2006-01")
	usageBody := `[{"user_id":"u1","month":"` + month + `","used_total":50000}]`
	if err := os.WriteFile(usagePath, []byte(usageBody), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{UserID: "u1", APITokenID: "pat-1", Role: "staff"}
	result := tracker.RemainingForScope("pat", "pat-1", "t1", ctx)
	if result.Limit != 200_000 || result.Used != 50_000 {
		t.Fatalf("pat scope: %+v", result)
	}
}

func TestRemainingForWindowDayAndWeek(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "usage.json")
	cfg := `{"defaults":{"role":{"staff":{"monthlyTokens":1000,"dailyTokens":100,"weeklyTokens":300,"action":"block"}},"model":{}},"users":{},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	poolUsagePath := filepath.Join(dir, "pool-usage.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", poolUsagePath)
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}

	day := tracker.RemainingForWindow(ctx, QuotaWindowDay)
	if day.Limit != 100 || day.Used != 0 {
		t.Fatalf("unexpected day remaining: %+v", day)
	}
	week := tracker.RemainingForWindow(ctx, QuotaWindowWeek)
	if week.Limit != 300 || week.Used != 0 {
		t.Fatalf("unexpected week remaining: %+v", week)
	}
}
