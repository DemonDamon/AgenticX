package quota

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRollbackUsesSharedUsageFileAsSourceOfTruth(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "usage.json")
	cfg := `{"defaults":{"role":{"staff":{"monthlyTokens":1000,"action":"block"}},"model":{}},"users":{},"departments":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	first := NewTracker(cfgPath, usagePath)
	second := NewTracker(cfgPath, usagePath)

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
