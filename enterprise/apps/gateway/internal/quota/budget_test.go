package quota

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeBudgetConfig(t *testing.T, dir string, cfg BudgetConfig) string {
	t.Helper()
	path := filepath.Join(dir, "budgets.json")
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal budget config: %v", err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write budget config: %v", err)
	}
	return path
}

func TestBudgetWarnAtThreshold(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Users: map[string]BudgetRule{
			"u1": {
				Unit:             BudgetUnitCostUSD,
				Period:           BudgetPeriodDay,
				Limit:            10,
				WarnThresholdPct: 80,
				Action:           ActionWarn,
			},
		},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath

	var alerts []BudgetAlertRecord
	tracker.SetBudgetAlertSink(func(r BudgetAlertRecord) { alerts = append(alerts, r) })

	ctx := RequestContext{TenantID: "t1", UserID: "u1"}
	if d := tracker.CheckBudget(ctx, 100, 8.5); !d.Allowed || !d.Warn {
		t.Fatalf("expected warn pass-through, got %+v", d)
	}
	if len(alerts) != 1 || alerts[0].AlertType != "warn" {
		t.Fatalf("expected one warn alert, got %+v", alerts)
	}

	if d := tracker.CheckBudget(ctx, 100, 0.5); !d.Allowed {
		t.Fatalf("second request should pass: %+v", d)
	}
}

func TestBudgetBlockAtHardLimit(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Users: map[string]BudgetRule{
			"u1": {
				Unit:   BudgetUnitCostUSD,
				Period: BudgetPeriodDay,
				Limit:  5,
				Action: ActionBlock,
			},
		},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath

	ctx := RequestContext{TenantID: "t1", UserID: "u1"}
	if d := tracker.CheckBudget(ctx, 100, 4); !d.Allowed {
		t.Fatalf("first request should pass: %+v", d)
	}
	if d := tracker.CheckBudget(ctx, 100, 2); d.Allowed {
		t.Fatalf("expected block, got %+v", d)
	}
}

func TestBudgetPeriodReset(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Users: map[string]BudgetRule{
			"u1": {
				Unit:   BudgetUnitTokens,
				Period: BudgetPeriodDay,
				Limit:  100,
				Action: ActionBlock,
			},
		},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath

	ctx := RequestContext{TenantID: "t1", UserID: "u1"}
	today := time.Now().UTC().Format("2006-01-02")
	rows := []budgetUsageRow{{Dimension: "user", Key: "u1", Period: today, Unit: BudgetUnitTokens, Used: 100}}
	if !tracker.writeBudgetUsage(rows) {
		t.Fatalf("seed usage failed")
	}
	if d := tracker.CheckBudget(ctx, 10, 0); d.Allowed {
		t.Fatalf("expected block on same day, got %+v", d)
	}

	yesterday := time.Now().UTC().Add(-24 * time.Hour).Format("2006-01-02")
	rows[0].Period = yesterday
	if !tracker.writeBudgetUsage(rows) {
		t.Fatalf("rewrite usage failed")
	}
	if d := tracker.CheckBudget(ctx, 10, 0); !d.Allowed {
		t.Fatalf("expected pass on new day period key, got %+v", d)
	}
}

func TestCheckRequestBudgetIntegration(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Users: map[string]BudgetRule{
			"u1": {
				Unit:   BudgetUnitCostUSD,
				Period: BudgetPeriodDay,
				Limit:  1,
				Action: ActionBlock,
			},
		},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = filepath.Join(dir, "budget-usage.json")

	ctx := RequestContext{TenantID: "t1", UserID: "u1", Role: "staff"}
	check := tracker.CheckRequest(ctx, 100, 0.5)
	if !check.Allowed {
		t.Fatalf("expected allowed check: %+v", check)
	}
	check2 := tracker.CheckRequest(ctx, 100, 0.6)
	if check2.Allowed {
		t.Fatalf("expected budget block via CheckRequest: %+v", check2)
	}
}

func TestBudgetWeekPeriodReset(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Users: map[string]BudgetRule{
			"u1": {
				Unit:   BudgetUnitTokens,
				Period: BudgetPeriodWeek,
				Limit:  100,
				Action: ActionBlock,
			},
		},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath

	ctx := RequestContext{TenantID: "t1", UserID: "u1"}
	year, week := time.Now().UTC().ISOWeek()
	thisWeek := fmt.Sprintf("%d-W%02d", year, week)
	rows := []budgetUsageRow{{Dimension: "user", Key: "u1", Period: thisWeek, Unit: BudgetUnitTokens, Used: 100}}
	if !tracker.writeBudgetUsage(rows) {
		t.Fatalf("seed usage failed")
	}
	if d := tracker.CheckBudget(ctx, 10, 0); d.Allowed {
		t.Fatalf("expected block in same week, got %+v", d)
	}

	lastWeekTime := time.Now().UTC().AddDate(0, 0, -7)
	lastYear, lastWeek := lastWeekTime.ISOWeek()
	rows[0].Period = fmt.Sprintf("%d-W%02d", lastYear, lastWeek)
	if !tracker.writeBudgetUsage(rows) {
		t.Fatalf("rewrite usage failed")
	}
	if d := tracker.CheckBudget(ctx, 10, 0); !d.Allowed {
		t.Fatalf("expected pass on new week period key, got %+v", d)
	}
}

func TestSanitizeBudgetRuleWeek(t *testing.T) {
	r := sanitizeBudgetRule(BudgetRule{
		Unit:   BudgetUnitTokens,
		Period: BudgetPeriodWeek,
		Limit:  10,
		Action: ActionWarn,
	})
	if r.Period != BudgetPeriodWeek {
		t.Fatalf("expected week period, got %+v", r)
	}
}
