package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/streamio"
)

type diagnosticOpaqueError struct{}

func (diagnosticOpaqueError) Error() string { panic("diagnostics must not stringify errors") }

func TestDiagnosticReasonsUseTypedEvidenceOnly(t *testing.T) {
	const secret = "sk-fake-private-body https://secret.invalid/?query=private nonce-private"
	for _, tc := range []struct {
		err    error
		reason observability.TerminalReason
	}{
		{nil, observability.ReasonCompleted},
		{errors.Join(quota.ErrConcurrencyLeaseLost, context.Canceled), observability.ReasonConcurrencyLeaseLost}, {context.Canceled, observability.ReasonClientCancelled},
		{context.DeadlineExceeded, observability.ReasonRequestTimeout}, {streamio.ErrHeaderTimeout, observability.ReasonHeaderTimeout},
		{streamio.ErrIdleTimeout, observability.ReasonIdleTimeout}, {streamio.ErrBufferExceeded, observability.ReasonBufferExceeded},
		{openai.ErrIncompleteStream, observability.ReasonIncomplete},
		{&adaptor.UpstreamError{StatusCode: 429, Body: secret}, observability.ReasonRateLimited},
		{&adaptor.UpstreamError{StatusCode: 401, Body: secret}, observability.ReasonAuth},
		{&adaptor.UpstreamError{StatusCode: 403, Body: secret}, observability.ReasonForbidden},
		{errors.New(secret), observability.ReasonUpstreamError},
		{errors.New("quota:concurrency_lease_lost " + secret), observability.ReasonUpstreamError}, {diagnosticOpaqueError{}, observability.ReasonUpstreamError},
	} {
		if got := diagnosticStreamReason(tc.err); got != tc.reason {
			t.Fatalf("reason=%s want=%s", got, tc.reason)
		}
		if tc.err != nil {
			// Wrapper messages may contain anything; only their wrapped type counts.
			if _, opaque := tc.err.(diagnosticOpaqueError); !opaque {
				wrapped := fmt.Errorf("%s: %w", secret, tc.err)
				if diagnosticStreamReason(wrapped) != tc.reason {
					t.Fatal("wrapped reason changed")
				}
			}
		}
	}
}

func TestStreamDiagnosticPreservesDownstreamAndPolicyEvidence(t *testing.T) {
	var output bytes.Buffer
	ctx, phases := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).Start(context.Background())
	phases.SetReason(observability.ReasonDownstreamError)
	recordStreamDiagnostic(ctx, errors.New("private-body-sk-fake"), false)
	if phases.Snapshot().Reason != observability.ReasonDownstreamError {
		t.Fatal("generic error replaced callback evidence")
	}
	recordStreamDiagnostic(ctx, errors.New("private-body-sk-fake"), true)
	phases.Finish(ctx, observability.ReasonOther)
	if phases.Snapshot().Reason != observability.ReasonPolicyBlocked || strings.Contains(output.String(), "private-body") {
		t.Fatalf("unsafe record: %s", output.String())
	}
}

func TestRouterPhaseDiagnosticsAreOptInAndSecretSafe(t *testing.T) {
	const secret = "sk-fake-user-body-query-nonce"
	for _, every := range []string{"0", "1"} {
		t.Run(every, func(t *testing.T) {
			t.Setenv("GATEWAY_REQUEST_DIAGNOSTICS_SAMPLE_EVERY", every)
			var output bytes.Buffer
			server := &Server{logger: slog.New(slog.NewJSONHandler(&output, nil))}
			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions?query="+secret, strings.NewReader(secret))
			req.Header.Set("Authorization", "Bearer "+secret)
			req.Header.Set("X-Nonce", secret)
			response := httptest.NewRecorder()
			server.Router().ServeHTTP(response, req)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("status=%d", response.Code)
			}
			if strings.Contains(output.String(), secret) {
				t.Fatal("secret leaked")
			}
			lines := strings.Split(strings.TrimSpace(output.String()), "\n")
			count := 0
			for _, line := range lines {
				if line == "" {
					continue
				}
				var record map[string]any
				if err := json.Unmarshal([]byte(line), &record); err != nil {
					t.Fatal(err)
				}
				if record["event"] == "gateway.request_phases" {
					count++
					if record["reason"] != "auth_error" {
						t.Fatalf("reason=%v", record["reason"])
					}
				}
			}
			want := 0
			if every == "1" {
				want = 1
			}
			if count != want {
				t.Fatalf("records=%d want=%d", count, want)
			}
		})
	}
}

func TestAdmissionDurationAndDeniedReasonUseSharedGate(t *testing.T) {
	dir := t.TempDir()
	budgetPath := filepath.Join(dir, "budgets.json")
	if err := os.WriteFile(budgetPath, []byte(`{"version":2,"users":{"phase-user":{"unit":"tokens","period":"month","limit":1,"action":"block"}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", budgetPath)
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(dir, "budget-usage.json"))
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", "")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	ctx, phases := observability.NewPhaseSampler(1, nil, nil).Start(context.Background())
	server := &Server{quotaTracker: quota.NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)}
	request := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx)
	decision := routing.Decision{}
	_, _, allowed := server.runChatQuotaGate(httptest.NewRecorder(), request, quota.RequestContext{TenantID: "phase-tenant", UserID: "phase-user", Model: "m"}, requestIdentity{}, &openai.ChatCompletionRequest{Model: "m"}, &decision, 100, 100)
	if allowed || phases.Snapshot().AdmissionWaitMS < 0 || phases.Snapshot().Reason != observability.ReasonQuotaDenied {
		t.Fatalf("allowed=%v snapshot=%+v", allowed, phases.Snapshot())
	}
}

func TestTracePhaseSnapshotDoesNotCopyIdentityOrHeaders(t *testing.T) {
	const secret = "private-body-sk-fake-query-user-nonce"
	ctx, phases := observability.NewPhaseSampler(1, nil, nil).Start(context.Background())
	req := httptest.NewRequest(http.MethodPost, "/"+secret, nil).WithContext(ctx)
	req.Header.Set(headerTraceID, secret)
	req.Header.Set(headerSessionID, secret)
	identity := enrichTraceFromRequest(requestIdentity{UserID: secret}, req)
	if identity.diagnostics != phases {
		t.Fatal("trace context missing recorder")
	}
	phases.SetReason(observability.TerminalReason(secret))
	raw, err := json.Marshal(identity.diagnostics.Snapshot().TraceMetadata())
	if err != nil || bytes.Contains(raw, []byte(secret)) || len(raw) > 512 {
		t.Fatalf("metadata=%s err=%v", raw, err)
	}
	if identity := enrichTraceFromRequest(requestIdentity{}, req.WithContext(context.Background())); identity.diagnostics != nil {
		t.Fatal("disabled request acquired metadata")
	}
}

func TestSampledRequestPipelineEmitsOneCompletePhaseRecord(t *testing.T) {
	const secret = "sk-fake-private-body-user-query-nonce"
	dir := t.TempDir()
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", filepath.Join(dir, "budgets.json"))
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(dir, "budget-usage.json"))
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", "")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\""+secret+"\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer upstream.Close()
	server := &Server{quotaTracker: quota.NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)}
	modelProvider := provider.NewOpenAICompatibleProvider(provider.WithKeyResolver(func(string) string { return secret }))
	var output bytes.Buffer
	sampler := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil)
	handler := sampler.HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		req := openai.ChatCompletionRequest{Model: "phase-model", Stream: true}
		decision := routing.Decision{Endpoint: upstream.URL}
		_, _, allowed := server.runChatQuotaGate(w, r, quota.RequestContext{TenantID: "phase-tenant", UserID: secret, Model: req.Model}, requestIdentity{}, &req, &decision, 1, 1)
		if !allowed {
			t.Error("synthetic request denied")
			return
		}
		err := modelProvider.Stream(r.Context(), req, decision, func(openai.StreamChunk) error { return nil })
		recordStreamDiagnostic(r.Context(), err, false)
		if err != nil {
			t.Errorf("synthetic stream: %v", err)
		}
	}))
	req := httptest.NewRequest(http.MethodPost, "/"+secret+"?query="+secret, strings.NewReader(secret))
	req.Header.Set("Authorization", "Bearer "+secret)
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if strings.Contains(output.String(), secret) || bytes.Count(output.Bytes(), []byte("\n")) != 1 {
		t.Fatalf("unsafe output: %s", output.String())
	}
	var snapshot observability.PhaseSnapshot
	if err := json.Unmarshal(output.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Reason != observability.ReasonCompleted || snapshot.AdmissionWaitMS < 0 || snapshot.UpstreamStartMS < 0 || snapshot.ResponseHeadersMS < snapshot.UpstreamStartMS || snapshot.FirstBodyByteMS < snapshot.ResponseHeadersMS || snapshot.FirstContentMS < snapshot.FirstBodyByteMS || snapshot.TotalMS < snapshot.FirstContentMS {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}
