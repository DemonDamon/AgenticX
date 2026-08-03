package quota

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRollbackUsesSharedUsageFileAsSourceOfTruth(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "usage.json")
	cfg := `{"defaults":{"role":{"staff":{"monthlyTokens":1000,"action":"block"}},"model":{}},"users":{},"departments":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	first := NewTracker(cfgPath, usagePath, nil)
	second := NewTracker(cfgPath, usagePath, nil)

	if decision := first.CheckAndAdd("u1", "", "staff", "m", 100); !decision.Allowed {
		t.Fatalf("first reservation denied: %+v", decision)
	}
	if decision := second.CheckAndAdd("u1", "", "staff", "m", 50); !decision.Allowed {
		t.Fatalf("second reservation denied: %+v", decision)
	}
	if ok := first.Rollback("u1", 100); !ok {
		t.Fatalf("rollback failed")
	}

	rows := readUsageRowsForTest(t, usagePath)
	if len(rows) != 1 {
		t.Fatalf("expected one usage row, got %+v", rows)
	}
	if rows[0].UsedTotal != 50 {
		t.Fatalf("expected rollback to preserve other tracker usage 50, got %d", rows[0].UsedTotal)
	}
}

func TestUnlimitedUsageIsPersistedAndReconciled(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "usage.json")
	cfg := `{"defaults":{"role":{"staff":{"monthlyTokens":0,"action":"block"}},"model":{}},"users":{},"departments":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{UserID: "u1", Role: "staff", Model: "m"}
	if decision := tracker.CheckAndAddContext(ctx, 120, LedgerEventReserve); !decision.Allowed || decision.UsedAfter != 120 || decision.ExceededBy != 0 {
		t.Fatalf("unlimited reservation should record without blocking: %+v", decision)
	}
	if ok := tracker.RollbackContext(ctx, 20); !ok {
		t.Fatal("unlimited rollback failed")
	}
	if decision := tracker.CheckAndAddContext(ctx, 25, LedgerEventSettle); !decision.Allowed || decision.UsedAfter != 125 {
		t.Fatalf("unlimited settlement should keep recording usage: %+v", decision)
	}

	rows := readUsageRowsForTest(t, usagePath)
	if len(rows) != 1 || rows[0].UsedTotal != 125 {
		t.Fatalf("usage ledger = %+v, want one row with 125 tokens", rows)
	}
	remaining := tracker.Remaining(ctx)
	if !remaining.Unlimited || remaining.Used != 125 || remaining.Remaining != nil {
		t.Fatalf("unlimited remaining should expose tracked usage: %+v", remaining)
	}
}

func TestMonthlyUserUsageIsMirroredToSharedLedger(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "usage.json")
	poolPath := filepath.Join(dir, "pool-usage.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", poolPath)
	cfg := `{"defaults":{"role":{"staff":{"monthlyTokens":1000,"action":"block"}},"model":{}},"users":{},"departments":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{TenantID: "tenant-1", UserID: "u1", Role: "staff"}
	month := time.Now().UTC().Format("2006-01")

	if decision := tracker.CheckAndAddContext(ctx, 120, LedgerEventReserve); !decision.Allowed {
		t.Fatalf("reserve denied: %+v", decision)
	}
	if rows := readPoolUsageRowsForTest(t, poolPath); len(rows) != 1 || rows[0].ScopeType != tokenScopeMonth || rows[0].ScopeID != "user::u1" || rows[0].Period != month || rows[0].UsedTotal != 120 {
		t.Fatalf("monthly ledger after reserve = %+v", rows)
	}

	if ok := tracker.RollbackContext(ctx, 20); !ok {
		t.Fatal("monthly rollback failed")
	}
	if rows := readPoolUsageRowsForTest(t, poolPath); len(rows) != 1 || rows[0].UsedTotal != 100 {
		t.Fatalf("monthly ledger after rollback = %+v", rows)
	}

	if decision := tracker.CheckAndAddContext(ctx, 25, LedgerEventSettle); !decision.Allowed {
		t.Fatalf("settlement denied: %+v", decision)
	}
	if rows := readPoolUsageRowsForTest(t, poolPath); len(rows) != 1 || rows[0].UsedTotal != 125 {
		t.Fatalf("monthly ledger after settlement = %+v", rows)
	}
}

func readUsageRowsForTest(t *testing.T, path string) []usageRow {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read usage: %v", err)
	}
	var rows []usageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("parse usage: %v", err)
	}
	return rows
}

func readPoolUsageRowsForTest(t *testing.T, path string) []poolUsageRow {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read pool usage: %v", err)
	}
	var rows []poolUsageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("parse pool usage: %v", err)
	}
	return rows
}
