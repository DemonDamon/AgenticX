package quota

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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

func TestMain(m *testing.M) {
	_ = os.Unsetenv("GATEWAY_BUDGET_BACKEND")
	_ = os.Unsetenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL")
	os.Exit(m.Run())
}

func TestBudgetWeekPeriodKeyUsesISOWeek(t *testing.T) {
	at := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	if got := budgetPeriodKey(BudgetPeriodWeek, at); got != "2020-W01" {
		t.Fatalf("ISO week key=%s", got)
	}
}

func TestLayeredBudgetsRejectWhenAnyHardCapIsExceeded(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Version:       2,
		CompanyLimits: CompanyMonthlyLimits{Tokens: 1000},
		Tenants: map[string]BudgetRule{
			"t1": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 400, Action: ActionWarn},
		},
		Departments: map[string]BudgetRule{
			"d1": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 200, Action: ActionWarn},
		},
		Users: map[string]BudgetRule{
			"alice": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 80, WarnThresholdPct: 50, Action: ActionWarn},
		},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath
	alice := RequestContext{TenantID: "t1", DeptID: "d1", UserID: "alice"}

	first := tracker.CheckBudget(alice, 70, 0)
	if !first.Allowed || !first.Warn || first.Receipt == nil || len(first.Receipt.Lines) != 4 {
		t.Fatalf("expected four-layer reserve with personal warn: %+v", first)
	}
	if used := budgetUsageByDimension(t, tracker); !budgetUsageEquals(used, map[string]float64{"company": 70, "tenant": 70, "dept": 70, "user": 70}) {
		t.Fatalf("reserved usage=%v", used)
	}

	blocked := tracker.CheckBudget(alice, 150, 0)
	if blocked.Allowed || !blocked.Blocked || blocked.Dimension != "dept" || blocked.Receipt != nil {
		t.Fatalf("department hard cap should reject without a receipt: %+v", blocked)
	}
	if used := budgetUsageByDimension(t, tracker); !budgetUsageEquals(used, map[string]float64{"company": 70, "tenant": 70, "dept": 70, "user": 70}) {
		t.Fatalf("rejected request changed usage=%v", used)
	}

	bob := RequestContext{TenantID: "t1", DeptID: "d1", UserID: "bob"}
	if shared := tracker.CheckBudget(bob, 140, 0); shared.Allowed || shared.Dimension != "dept" {
		t.Fatalf("shared department cap should block the other member: %+v", shared)
	}
}

func TestPersonalBudgetPrecedenceAndMultipleGroups(t *testing.T) {
	cfg := normalizeBudgetConfig(BudgetConfig{
		Version:  2,
		Defaults: BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 50, Action: ActionBlock},
		Users: map[string]BudgetRule{
			"special": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 500, Action: ActionBlock},
		},
		Groups: map[string]BudgetRule{
			"wide":  {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 100, Action: ActionWarn},
			"tight": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 200, Action: ActionBlock},
			"daily": {Unit: BudgetUnitTokens, Period: BudgetPeriodDay, Limit: 20, Action: ActionBlock},
			"cost":  {Unit: BudgetUnitCostUSD, Period: BudgetPeriodMonth, Limit: 4, Action: ActionBlock},
		},
		UserGroups: map[string][]string{
			"special": {"wide", "tight"},
			"member":  {"wide", "tight", "daily", "cost"},
		},
	})
	if rules := selectPersonalBudgetRules(cfg, RequestContext{UserID: "special"}); len(rules) != 1 || rules[0].Limit != 500 {
		t.Fatalf("explicit personal exception must outrank groups: %+v", rules)
	}
	if rules := selectPersonalBudgetRules(cfg, RequestContext{UserID: "ordinary"}); len(rules) != 1 || rules[0].Limit != 50 {
		t.Fatalf("unassigned member should inherit default: %+v", rules)
	}
	rules := selectPersonalBudgetRules(cfg, RequestContext{UserID: "member"})
	if len(rules) != 3 {
		t.Fatalf("different group windows must all apply: %+v", rules)
	}
	limits := map[string]float64{}
	for _, rule := range rules {
		limits[rule.Unit+"/"+rule.Period] = rule.Limit
		if rule.Action != ActionBlock {
			t.Fatalf("group cap must block: %+v", rule)
		}
	}
	if limits["tokens/month"] != 100 || limits["tokens/day"] != 20 || limits["cost_usd/month"] != 4 {
		t.Fatalf("overlapping groups did not choose the strictest monthly cap: %+v", limits)
	}
}

func TestGroupLowestLimitBlocksWhenItsStoredActionWarns(t *testing.T) {
	dir := t.TempDir()
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Version: 2,
		Groups: map[string]BudgetRule{
			"small": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 100, Action: ActionWarn},
			"large": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 200, Action: ActionBlock},
		},
		UserGroups: map[string][]string{"u1": {"small", "large"}},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = filepath.Join(dir, "budget-usage.json")
	decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "u1"}, 101, 0)
	if decision.Allowed || !decision.Blocked || decision.Limit != 100 || decision.Dimension != "user" {
		t.Fatalf("strictest group must block at 100: %+v", decision)
	}
}

func TestLegacyDefaultsBecomeOrganizationSharedCap(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Defaults: BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 100, Action: ActionWarn},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath
	alice := RequestContext{TenantID: "t1", UserID: "alice"}
	bob := RequestContext{TenantID: "t1", UserID: "bob"}
	if decision := tracker.CheckBudget(alice, 60, 0); !decision.Allowed || decision.Dimension == "user" {
		t.Fatalf("legacy default should reserve the organization cap: %+v", decision)
	}
	if decision := tracker.CheckBudget(bob, 50, 0); decision.Allowed || decision.Dimension != "tenant" || !decision.Blocked {
		t.Fatalf("legacy default must be a shared organization cap: %+v", decision)
	}
	used := budgetUsageByDimension(t, tracker)
	if !budgetUsageEquals(used, map[string]float64{"tenant": 60}) {
		t.Fatalf("personal layer must stay unset: %+v", used)
	}
}

func TestV2DefaultsArePerUser(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Version:  2,
		Defaults: BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 100, Action: ActionBlock},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath
	if decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "alice"}, 60, 0); !decision.Allowed {
		t.Fatalf("alice: %+v", decision)
	}
	if decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "bob"}, 60, 0); !decision.Allowed {
		t.Fatalf("bob: %+v", decision)
	}
	raw := tracker.readBudgetUsageLocked()
	if len(raw) != 2 {
		t.Fatalf("expected two personal rows: %+v", raw)
	}
	for _, row := range raw {
		if row.Dimension != "user" || row.Used != 60 {
			t.Fatalf("unexpected personal row: %+v", row)
		}
	}
}

func TestCompanyTokenAndCostLimitsCoexist(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{CompanyLimits: CompanyMonthlyLimits{Tokens: 100, CostUSD: 10}})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath
	ctx := RequestContext{TenantID: "t1", UserID: "u1"}
	first := tracker.CheckBudget(ctx, 60, 4)
	if !first.Allowed || first.Receipt == nil || len(first.Receipt.Lines) != 2 {
		t.Fatalf("expected both company limits to reserve: %+v", first)
	}
	if blocked := tracker.CheckBudget(ctx, 41, 1); blocked.Allowed || blocked.Unit != BudgetUnitTokens {
		t.Fatalf("expected token hard limit to block: %+v", blocked)
	}
	if blocked := tracker.CheckBudget(ctx, 40, 7); blocked.Allowed || blocked.Unit != BudgetUnitCostUSD {
		t.Fatalf("expected cost hard limit to block: %+v", blocked)
	}
	if err := tracker.SettleBudgetReceipt(first.Receipt, 50, 3); err != nil {
		t.Fatal(err)
	}
	for _, row := range tracker.readBudgetUsageLocked() {
		switch row.Unit {
		case BudgetUnitTokens:
			if row.Used != 50 || row.Dimension != "company" {
				t.Fatalf("token settlement: %+v", row)
			}
		case BudgetUnitCostUSD:
			if row.Used != 3 || row.Dimension != "company" {
				t.Fatalf("cost settlement: %+v", row)
			}
		default:
			t.Fatalf("unexpected row: %+v", row)
		}
	}
	second := tracker.CheckBudget(ctx, 10, 1)
	if !second.Allowed || second.Receipt == nil {
		t.Fatalf("second reserve: %+v", second)
	}
	if err := tracker.RollbackBudgetReceipt(second.Receipt); err != nil {
		t.Fatal(err)
	}
	if err := tracker.RollbackBudgetReceipt(second.Receipt); err != nil {
		t.Fatal(err)
	}
	for _, row := range tracker.readBudgetUsageLocked() {
		switch row.Unit {
		case BudgetUnitTokens:
			if row.Used != 50 {
				t.Fatalf("duplicate rollback changed tokens: %+v", row)
			}
		case BudgetUnitCostUSD:
			if row.Used != 3 {
				t.Fatalf("duplicate rollback changed cost: %+v", row)
			}
		}
	}
}

func TestRemainingBudgetReadsFileLedger(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{
		Version:       2,
		CompanyLimits: CompanyMonthlyLimits{Tokens: 1000},
		Tenants:       map[string]BudgetRule{"t1": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 400, Action: ActionBlock}},
		Departments:   map[string]BudgetRule{"d1": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 200, Action: ActionBlock}},
		Users:         map[string]BudgetRule{"alice": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 80, Action: ActionBlock}},
	})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath
	ctx := RequestContext{TenantID: "t1", DeptID: "d1", UserID: "alice"}
	if decision := tracker.CheckBudget(ctx, 25, 0); !decision.Allowed {
		t.Fatal(decision)
	}
	headroom, err := tracker.RemainingBudget(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(headroom) != 3 {
		t.Fatalf("expected company, organization and department headroom: %+v", headroom)
	}
	for _, item := range headroom {
		if item.Used != 25 {
			t.Fatalf("used=%v on %+v", item.Used, item)
		}
		if item.Dimension == "user" {
			t.Fatalf("personal cap is not part of shared headroom: %+v", item)
		}
	}
}

func TestFileModeCorruptUsageFailsOpen(t *testing.T) {
	dir := t.TempDir()
	usagePath := filepath.Join(dir, "budget-usage.json")
	if err := os.WriteFile(usagePath, []byte("not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfgPath := writeBudgetConfig(t, dir, BudgetConfig{CompanyLimits: CompanyMonthlyLimits{Tokens: 10}})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), usagePath, nil)
	tracker.budgetCfgPath = cfgPath
	tracker.budgetUsagePath = usagePath
	decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "u1"}, 1, 0)
	if !decision.Allowed || decision.StorageError {
		t.Fatalf("file mode should fail open: %+v", decision)
	}
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "not-json" {
		t.Fatalf("fail-open rewrote usage: %s", raw)
	}
}

func TestDatabaseModeRejectsInvalidBudgetFile(t *testing.T) {
	t.Setenv("GATEWAY_BUDGET_BACKEND", "database")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "budgets.json")
	if err := os.WriteFile(cfgPath, []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	tracker.budgetCfgPath = cfgPath
	decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "u1"}, 1, 0)
	if decision.Allowed || !decision.StorageError {
		t.Fatalf("unreadable config must deny in database mode: %+v", decision)
	}
}

func TestRemoteBudgetConfigCarriesTenantHeaderAndCaches(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "internal-secret")
	var hits []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer internal-secret" {
			t.Errorf("authorization=%q", got)
		}
		hits = append(hits, r.Header.Get("X-AgenticX-Tenant-Id"))
		_, _ = w.Write([]byte(`{"version":2}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", server.URL)
	dir := t.TempDir()
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	if cfg := tracker.loadBudgetConfigForTenant("tenant-a"); cfg.Version != 2 || cfg.loadErr != nil {
		t.Fatalf("tenant-a config: %+v err=%v", cfg, cfg.loadErr)
	}
	_ = tracker.loadBudgetConfigForTenant("tenant-a")
	_ = tracker.loadBudgetConfigForTenant("tenant-b")
	if len(hits) != 2 || hits[0] != "tenant-a" || hits[1] != "tenant-b" {
		t.Fatalf("fetches=%v", hits)
	}
}

func TestRemoteBudgetNotFoundIsEmptyConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(server.Close)
	t.Setenv("GATEWAY_BUDGET_BACKEND", "database")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", server.URL)
	dir := t.TempDir()
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "u1"}, 1, 0)
	if !decision.Allowed || decision.StorageError || decision.Description != "no budget" {
		t.Fatalf("missing remote budget should allow: %+v", decision)
	}
}

func TestFileModeAllowsWhenRemoteBudgetConfigUnread(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := server.URL
	server.Close()
	t.Setenv("GATEWAY_BUDGET_BACKEND", "")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", url)
	dir := t.TempDir()
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "u1"}, 1, 0)
	if !decision.Allowed || decision.StorageError {
		t.Fatalf("file mode should fail open: %+v", decision)
	}
}

func TestDatabaseModeRejectsUnreadableRemoteBudgetConfig(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := server.URL
	server.Close()
	t.Setenv("GATEWAY_BUDGET_BACKEND", "database")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", url)
	dir := t.TempDir()
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	decision := tracker.CheckBudget(RequestContext{TenantID: "t1", UserID: "u1"}, 1, 0)
	if decision.Allowed || !decision.StorageError {
		t.Fatalf("database mode must deny when config cannot be read: %+v", decision)
	}
}

func budgetUsageByDimension(t *testing.T, tracker *Tracker) map[string]float64 {
	t.Helper()
	out := map[string]float64{}
	for _, row := range tracker.readBudgetUsageLocked() {
		out[row.Dimension] += row.Used
	}
	return out
}

func budgetUsageEquals(got, want map[string]float64) bool {
	if len(got) != len(want) {
		return false
	}
	for key, value := range want {
		if got[key] != value {
			return false
		}
	}
	return true
}
