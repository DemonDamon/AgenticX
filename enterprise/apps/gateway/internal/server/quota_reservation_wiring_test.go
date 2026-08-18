package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/transform"
)

type responseWriterWithoutFlusher struct{ http.ResponseWriter }

func TestEnsureBoundedMaxTokensInjectsAForwardedServerDefault(t *testing.T) {
	req := openai.ChatCompletionRequest{}
	if got := ensureBoundedMaxTokens(&req); got != defaultGatewayMaxCompletionTokens {
		t.Fatalf("bound=%d want=%d", got, defaultGatewayMaxCompletionTokens)
	}
	if req.MaxCompletionTokens != defaultGatewayMaxCompletionTokens {
		t.Fatalf("server bound was not forwarded upstream: %+v", req)
	}
	if got := estimateTokensWithMax(123, ensureBoundedMaxTokens(&req)); got != 123+defaultGatewayMaxCompletionTokens {
		t.Fatalf("reservation=%d", got)
	}
}

func TestEnsureBoundedMaxTokensPreservesExplicitCallerLimit(t *testing.T) {
	req := openai.ChatCompletionRequest{MaxTokens: 512}
	if got := ensureBoundedMaxTokens(&req); got != 512 {
		t.Fatalf("bound=%d want=512", got)
	}
	if req.MaxCompletionTokens != 0 || req.MaxTokens != 512 {
		t.Fatalf("explicit caller limit was rewritten: %+v", req)
	}
}

func TestNonRelayQuotaGateReservesInputAndOutputCapacity(t *testing.T) {
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "on")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quota.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", filepath.Join(dir, "missing-budgets.json"))
	if err := os.WriteFile(cfgPath, []byte(`{
  "defaults":{"role":{},"model":{}},
  "users":{"u1":{"monthlyTokens":0,"dailyTokens":5000,"action":"block"}},
  "departments":{},"apiTokens":{}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := quota.NewTracker(cfgPath, filepath.Join(dir, "usage.json"), nil)
	srv := &Server{quotaTracker: tracker, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	req := openai.ChatCompletionRequest{Model: "model-a"}
	maxOutput := ensureBoundedMaxTokens(&req)
	inputTokens := 100
	reserved := estimateTokensWithMax(inputTokens, maxOutput)
	identity := requestIdentity{TenantID: "tenant-1", UserID: "u1"}
	qctx := quota.RequestContext{TenantID: "tenant-1", UserID: "u1", Model: req.Model}
	decision := routing.Decision{Provider: "provider-a", Model: req.Model}

	check, _, ok := srv.runChatQuotaGate(
		httptest.NewRecorder(), httptest.NewRequest("POST", "/v1/chat/completions", nil),
		qctx, identity, &req, &decision, inputTokens, reserved,
	)
	if ok || check.Allowed {
		t.Fatalf("input-only reservation would pass, but bounded output capacity must block: %+v", check)
	}
	if check.Kind != "token_day" {
		t.Fatalf("kind=%q want token_day", check.Kind)
	}
}

func TestPreUpstreamEarlyReturnsRefundAdmissionReceipt(t *testing.T) {
	tests := []struct {
		name string
		run  func(*Server, http.ResponseWriter, openai.ChatCompletionRequest, requestIdentity, quota.RequestContext, quota.CheckResult)
	}{
		{
			name: "protocol relay unavailable",
			run: func(s *Server, w http.ResponseWriter, req openai.ChatCompletionRequest, identity requestIdentity, qctx quota.RequestContext, check quota.CheckResult) {
				s.protocolComplete(w, httptest.NewRequest("POST", "/v1/messages", nil), req, identity, protocolSession{}, transform.DerivedModel{}, transform.ThinkingOff, time.Now(), 10, 100, check, qctx)
			},
		},
		{
			name: "protocol writer has no flusher",
			run: func(s *Server, w http.ResponseWriter, req openai.ChatCompletionRequest, identity requestIdentity, qctx quota.RequestContext, check quota.CheckResult) {
				s.protocolStream(w, httptest.NewRequest("POST", "/v1/messages", nil), req, identity, protocolSession{}, transform.DerivedModel{}, transform.ThinkingOff, time.Now(), 10, 100, check, qctx)
			},
		},
		{
			name: "openai writer has no flusher",
			run: func(s *Server, w http.ResponseWriter, req openai.ChatCompletionRequest, identity requestIdentity, qctx quota.RequestContext, check quota.CheckResult) {
				s.handleStream(w, httptest.NewRequest("POST", "/v1/chat/completions", nil), req, routing.Decision{}, time.Now(), identity, 10, 100, nil, check, qctx)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			srv, tracker, identity, qctx, check := newEarlyReturnReservationFixture(t)
			recorder := httptest.NewRecorder()
			writer := http.ResponseWriter(recorder)
			if test.name != "protocol relay unavailable" {
				writer = &responseWriterWithoutFlusher{ResponseWriter: recorder}
			}
			test.run(srv, writer, openai.ChatCompletionRequest{Model: "model-a", Stream: true}, identity, qctx, check)
			if remaining := tracker.Remaining(qctx); remaining.Used != 0 || remaining.Unavailable {
				t.Fatalf("pre-upstream return leaked reservation: %+v", remaining)
			}
		})
	}
}

func newEarlyReturnReservationFixture(t *testing.T) (*Server, *quota.Tracker, requestIdentity, quota.RequestContext, quota.CheckResult) {
	t.Helper()
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "local")
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quota.json")
	t.Setenv("GATEWAY_QUOTA_POOL_USAGE_FILE", filepath.Join(dir, "pool.json"))
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", filepath.Join(dir, "missing-budget.json"))
	if err := os.WriteFile(cfgPath, []byte(`{
  "defaults":{"role":{},"model":{}},
  "users":{"u1":{"monthlyTokens":1000,"action":"block"}},
  "departments":{},"apiTokens":{}
}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := quota.NewTracker(cfgPath, filepath.Join(dir, "usage.json"), nil)
	qctx := quota.RequestContext{TenantID: "tenant-1", UserID: "u1", Role: "staff", Model: "model-a", TurnID: "turn-1"}
	check := tracker.CheckRequest(qctx, 100, 0)
	if !check.Allowed || check.Reservation == nil {
		t.Fatalf("fixture admission failed: %+v", check)
	}
	srv := &Server{quotaTracker: tracker, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	identity := requestIdentity{TenantID: "tenant-1", UserID: "u1", RoleCodes: []string{"staff"}, TurnID: "turn-1"}
	return srv, tracker, identity, qctx, check
}
