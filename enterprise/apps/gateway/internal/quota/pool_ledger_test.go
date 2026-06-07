package quota

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func writePoolQuotaConfig(t *testing.T, dir string, deptID string, monthly int64) string {
	t.Helper()
	cfgPath := filepath.Join(dir, "quotas.json")
	body := `{"defaults":{"role":{},"model":{}},"users":{},"departments":{"` + deptID + `":{"monthlyTokens":` + strconv.FormatInt(monthly, 10) + `,"poolScope":"dept","action":"block"}}}`
	if err := os.WriteFile(cfgPath, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return cfgPath
}

func TestSharedPoolDeptBlocksSecondMember(t *testing.T) {
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

	d1 := tracker.CheckAndAddContext(ctx1, 600_000, LedgerEventReserve)
	if !d1.Allowed {
		t.Fatalf("first member denied: %+v", d1)
	}
	d2 := tracker.CheckAndAddContext(ctx2, 600_000, LedgerEventReserve)
	if d2.Allowed {
		t.Fatalf("expected shared pool block for second member, got %+v", d2)
	}
}

func TestSharedPoolRefundRestoresCapacity(t *testing.T) {
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
	if ok := tracker.RollbackContext(ctx1, 600_000); !ok {
		t.Fatalf("rollback failed")
	}
	if d := tracker.CheckAndAddContext(ctx2, 600_000, LedgerEventReserve); !d.Allowed {
		t.Fatalf("expected second member allowed after refund, got %+v", d)
	}
}

func TestPoolScopeOffKeepsPerUserBehavior(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	body := `{"defaults":{"role":{},"model":{}},"users":{},"departments":{"dept-a":{"monthlyTokens":1000000,"poolScope":"dept","action":"block"}}}`
	if err := os.WriteFile(cfgPath, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	usagePath := filepath.Join(dir, "usage.json")
	tracker := NewTracker(cfgPath, usagePath, nil)

	ctx1 := RequestContext{TenantID: "tenant-1", UserID: "u1", DeptID: "dept-a", Role: "staff", Model: "m"}
	ctx2 := RequestContext{TenantID: "tenant-1", UserID: "u2", DeptID: "dept-a", Role: "staff", Model: "m"}

	if d := tracker.CheckAndAddContext(ctx1, 600_000, LedgerEventReserve); !d.Allowed {
		t.Fatalf("u1 denied: %+v", d)
	}
	if d := tracker.CheckAndAddContext(ctx2, 600_000, LedgerEventReserve); !d.Allowed {
		t.Fatalf("expected per-user counters when pool off, got %+v", d)
	}
}

func TestTwoTrackersShareLocalPoolUsage(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := writePoolQuotaConfig(t, dir, "dept-a", 1_000_000)
	poolUsagePath := filepath.Join(dir, "pool-usage.json")
	usagePath := filepath.Join(dir, "usage.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", poolUsagePath)

	first := NewTracker(cfgPath, usagePath, nil)
	second := NewTracker(cfgPath, usagePath, nil)
	ctx1 := RequestContext{TenantID: "tenant-1", UserID: "u1", DeptID: "dept-a", Role: "staff", Model: "m"}
	ctx2 := RequestContext{TenantID: "tenant-1", UserID: "u2", DeptID: "dept-a", Role: "staff", Model: "m"}

	if d := first.CheckAndAddContext(ctx1, 700_000, LedgerEventReserve); !d.Allowed {
		t.Fatalf("first tracker reserve denied: %+v", d)
	}
	d2 := second.CheckAndAddContext(ctx2, 300_000, LedgerEventReserve)
	if !d2.Allowed {
		t.Fatalf("expected second tracker to share pool headroom, got %+v", d2)
	}
	if d2.UsedBefore != 700_000 || d2.UsedAfter != 1_000_000 {
		t.Fatalf("unexpected shared pool counters: %+v", d2)
	}
}
