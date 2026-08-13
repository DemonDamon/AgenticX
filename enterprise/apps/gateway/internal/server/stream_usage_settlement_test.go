package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

type capturingUsageSink struct {
	records []metering.UsageRecord
}

func (s *capturingUsageSink) ReportAsync(record metering.UsageRecord) {
	s.records = append(s.records, record)
}

func TestSettleInterruptedStreamUsageRecordsPartialUsageAndSettlesBudget(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")

	dir := t.TempDir()
	quotaConfigPath := filepath.Join(dir, "quotas.json")
	quotaUsagePath := filepath.Join(dir, "quota-usage.json")
	budgetConfigPath := filepath.Join(dir, "budgets.json")
	budgetUsagePath := filepath.Join(dir, "budget-usage.json")

	if err := os.WriteFile(
		quotaConfigPath,
		[]byte(`{"defaults":{"role":{"staff":{"monthlyTokens":10000,"action":"block"}},"model":{}},"users":{},"departments":{}}`),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		budgetConfigPath,
		[]byte(`{"defaults":{},"tenants":{},"departments":{},"users":{"user-a":{"unit":"tokens","period":"month","limit":10000,"action":"block"}}}`),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", budgetConfigPath)
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", budgetUsagePath)

	tracker := quota.NewTracker(quotaConfigPath, quotaUsagePath, nil)
	qctx := quota.RequestContext{
		TenantID: "tenant-a",
		UserID:   "user-a",
		Role:     "staff",
		Model:    "model-a",
	}
	check := tracker.CheckRequest(qctx, 100, 0)
	if !check.Allowed || check.BudgetReservedTokens != 100 {
		t.Fatalf("unexpected reservation: %+v", check)
	}

	sink := &capturingUsageSink{}
	srv := &Server{
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		quotaTracker: tracker,
		metering:     sink,
	}
	srv.settleInterruptedStreamUsage(
		requestIdentity{TenantID: "tenant-a", UserID: "user-a"},
		routing.Decision{Provider: "provider-a", Model: "model-a", Route: "third-party"},
		100,
		25,
		100,
		check,
		qctx,
	)

	if len(sink.records) != 1 {
		t.Fatalf("metering records=%d want=1", len(sink.records))
	}
	got := sink.records[0]
	if got.InputTokens != 100 || got.OutputTokens != 25 || got.TotalTokens != 125 {
		t.Fatalf("partial usage=%+v", got)
	}

	raw, err := os.ReadFile(budgetUsagePath)
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Used float64 `json:"used"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Used != 125 {
		t.Fatalf("budget usage=%s want one row with used=125", raw)
	}
	remaining := tracker.Remaining(qctx)
	if remaining.Used != 125 {
		t.Fatalf("monthly quota used=%d want=125", remaining.Used)
	}
}
