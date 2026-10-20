package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func TestBudgetReceiptSettlesOnSuccessAndRollsBackOnFailure(t *testing.T) {
	t.Setenv("GATEWAY_BUDGET_BACKEND", "")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")

	dir := t.TempDir()
	budgetPath := filepath.Join(dir, "budgets.json")
	usagePath := filepath.Join(dir, "budget-usage.json")
	writeBudget := func(body string) {
		t.Helper()
		if err := os.WriteFile(budgetPath, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeBudget(`{"version":2,"users":{"user-a":{"unit":"tokens","period":"month","limit":10000,"action":"block"}}}`)
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", budgetPath)
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", usagePath)

	tracker := quota.NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "quota-usage.json"), nil)
	qctx := quota.RequestContext{TenantID: "tenant-a", UserID: "user-a", Role: "staff", Model: "model-a"}
	check := tracker.CheckRequest(qctx, 100, 0)
	if !check.Allowed || check.BudgetReceipt == nil || len(check.BudgetReceipt.Lines) == 0 || check.BudgetReservedTokens != 100 {
		t.Fatalf("admission did not return a receipt: %+v", check)
	}

	// Drop the published rule so a settle that re-reads config would miss the reservation.
	writeBudget(`{"version":2}`)
	srv := &Server{
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		quotaTracker: tracker,
		metering:     &capturingUsageSink{},
	}
	srv.reportUsageDetailed(
		requestIdentity{TenantID: "tenant-a", UserID: "user-a"},
		routing.Decision{Provider: "provider-a", Model: "model-a"},
		openai.Usage{PromptTokens: 100, CompletionTokens: 25, TotalTokens: 125},
		&check,
		spanMeta{},
	)
	if got := readBudgetUsed(t, usagePath); got != 125 {
		t.Fatalf("settled usage=%v want 125", got)
	}

	writeBudget(`{"version":2,"users":{"user-a":{"unit":"tokens","period":"month","limit":10000,"action":"block"}}}`)
	failed := tracker.CheckRequest(qctx, 80, 0)
	if !failed.Allowed || failed.BudgetReceipt == nil {
		t.Fatalf("second admission: %+v", failed)
	}
	writeBudget(`{"version":2}`)
	identity := requestIdentity{TenantID: "tenant-a", UserID: "user-a"}
	srv.rollbackBudgetReservation(identity, "model-a", failed)
	srv.rollbackBudgetReservation(identity, "model-a", failed)
	if got := readBudgetUsed(t, usagePath); got != 125 {
		t.Fatalf("rollback usage=%v want 125", got)
	}
}

func readBudgetUsed(t *testing.T, path string) float64 {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Used float64 `json:"used"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	var total float64
	for _, row := range rows {
		total += row.Used
	}
	return total
}
