package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/virtualmodel"
)

func TestVirtualQuotaUsesPreferredRealModel(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", "")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_BUDGET_BACKEND", "")
	dir := t.TempDir()
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", filepath.Join(dir, "budgets.json"))
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(dir, "budget-usage.json"))
	quotaPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "quota-usage.json")
	body := `{"defaults":{"role":{"staff":{"monthlyTokens":100000,"action":"block"}},"model":{"real-x":{"monthlyTokens":10,"action":"block"}}},"users":{},"departments":{}}`
	if err := os.WriteFile(quotaPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := quota.NewTracker(quotaPath, usagePath, nil)
	identity := requestIdentity{TenantID: "t1", UserID: "user-a", DepartmentID: "d1"}
	seed := tracker.CheckAndAddContext(quota.RequestContext{
		TenantID: "t1", UserID: "user-a", DeptID: "d1", Role: "staff", Model: "real-x",
	}, 10, quota.LedgerEventReserve)
	if !seed.Allowed || seed.UsedAfter != 10 {
		t.Fatalf("seed = %+v", seed)
	}

	srv := newVirtualQuotaServer(t, tracker)
	admission := srv.admitVirtual("t1", "virt")
	if admission.quotaModel != "real-x" || admission.virtualName != "virt" {
		t.Fatalf("admission = %+v", admission)
	}
	qctx := srv.quotaContext(identity, admission.quotaModel)
	denied := tracker.CheckRequest(qctx, 1, 0)
	if denied.Allowed {
		t.Fatalf("virtual request should hit real-x quota, got %+v", denied)
	}
	if byName := tracker.CheckRequest(srv.quotaContext(identity, "virt"), 1, 0); !byName.Allowed {
		t.Fatal("staff rule would still allow the virtual name; the gate must not use it")
	}
}

func TestVirtualQuotaCountsActualModelWithoutDoubleCharge(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", "")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_BUDGET_BACKEND", "")
	dir := t.TempDir()
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", filepath.Join(dir, "budgets.json"))
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(dir, "budget-usage.json"))
	quotaPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "quota-usage.json")
	body := `{"defaults":{"role":{"staff":{"monthlyTokens":100000,"action":"block"}},"model":{"real-x":{"monthlyTokens":10000,"action":"block"},"real-y":{"monthlyTokens":10000,"action":"block"}}},"users":{},"departments":{}}`
	if err := os.WriteFile(quotaPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := quota.NewTracker(quotaPath, usagePath, nil)
	identity := requestIdentity{TenantID: "t1", UserID: "user-a", DepartmentID: "d1"}
	srv := newVirtualQuotaServer(t, tracker)
	srv.metering = &capturingUsageSink{}
	qctx := srv.quotaContext(identity, "real-x")
	check := tracker.CheckRequest(qctx, 100, 0)
	if !check.Allowed {
		t.Fatalf("pre-check = %+v", check)
	}

	ctx := context.WithValue(context.Background(), relayQuotaKey{}, relayQuotaState{Virtual: true})
	settle := srv.settleRelayQuota(ctx, identity, qctx, 100, 80, "real-x")
	if settle.Actual != 80 {
		t.Fatalf("settle = %+v", settle)
	}
	if got := tracker.Remaining(qctx).Used; got != 80 {
		t.Fatalf("real-x used = %d, want 80", got)
	}
	raw, err := os.ReadFile(usagePath)
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		UserID string `json:"user_id"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].UserID != "user-a" {
		t.Fatalf("usage rows = %+v, want one user row and no virtual-name counter", rows)
	}

	srv.reportUsageDetailed(identity, routing.Decision{Model: "real-x", Provider: "p", Route: "third-party"},
		openai.Usage{PromptTokens: 50, CompletionTokens: 30, TotalTokens: 80}, nil, spanMeta{})
	sink := srv.metering.(*capturingUsageSink)
	if len(sink.records) != 1 || sink.records[0].Model != "real-x" {
		t.Fatalf("metering = %+v", sink.records)
	}

	again := tracker.CheckRequest(qctx, 100, 0)
	if !again.Allowed {
		t.Fatalf("second pre-check = %+v", again)
	}
	moved := srv.settleRelayQuota(ctx, identity, qctx, 100, 40, "real-y")
	if moved.Actual != 40 {
		t.Fatalf("failover settle = %+v", moved)
	}
	if got := tracker.Remaining(srv.quotaContext(identity, "real-y")).Used; got != 120 {
		t.Fatalf("used after failover = %d, want 120 (80 already settled + 40 actual, not 80+100+40)", got)
	}
}

func newVirtualQuotaServer(t *testing.T, tracker *quota.Tracker) *Server {
	t.Helper()
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot([]channel.Channel{
		{ID: "x", TenantID: "t1", Status: channel.StatusActive, SupportedModels: []string{"real-x"}, Weight: 1},
		{ID: "y", TenantID: "t1", Status: channel.StatusActive, SupportedModels: []string{"real-y"}, Weight: 1},
	})
	loader := virtualmodel.New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	loader.SetSnapshot([]virtualmodel.Model{{
		TenantID: "t1", Name: "virt", DisplayName: "Virt", Enabled: true,
		Targets: []virtualmodel.Target{{Model: "real-x", Weight: 1, Priority: 0}},
	}})
	return &Server{
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		quotaTracker:   tracker,
		billingService: billing.NewService(tracker),
		virtualLoader:  loader,
		channelPicker:  channel.NewPicker(reg, channel.NewStatsStore(), nil),
		metering:       &capturingUsageSink{},
	}
}
