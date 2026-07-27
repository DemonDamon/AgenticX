package server

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	gatewayauth "github.com/agenticx/enterprise/gateway/internal/auth"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/runtimeconfig"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

type stubManagedAuthorizer struct {
	allow map[string]bool
	err   error
	calls []string
}

func (s *stubManagedAuthorizer) IsAllowed(
	ctx context.Context,
	identity gatewayauth.ManagedModelIdentity,
	modelID string,
) (bool, error) {
	s.calls = append(s.calls, modelID)
	if s.err != nil {
		return false, s.err
	}
	return s.allow[modelID], nil
}

type capturingProvider struct {
	lastModel    string
	lastProvider string
	called       int
}

func (c *capturingProvider) Complete(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
) (openai.ChatCompletionResponse, error) {
	c.called++
	c.lastModel = req.Model
	c.lastProvider = decision.Provider
	return openai.ChatCompletionResponse{
		ID:     "chatcmpl-test",
		Object: "chat.completion",
		Choices: []openai.ChatCompletionChoice{{
			Message: openai.ChatMessage{Role: "assistant", Content: openai.NewStringContent("ok")},
		}},
	}, nil
}

func (c *capturingProvider) Stream(
	ctx context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
	push func(openai.StreamChunk) error,
) error {
	return errors.New("stream not used")
}

func (c *capturingProvider) Embeddings(
	ctx context.Context,
	req openai.EmbeddingRequest,
	decision routing.Decision,
) (openai.EmbeddingResponse, error) {
	return openai.EmbeddingResponse{}, errors.New("embeddings not used")
}

type nopAuditWriter struct{}

func (nopAuditWriter) Write(event *audit.Event) error { return nil }

type nopMeterSink struct{}

func (nopMeterSink) ReportAsync(record metering.UsageRecord) {}

func TestResolveManagedModelCandidate(t *testing.T) {
	p, m, err := resolveManagedModelCandidate("provider-a/model-a", "")
	if err != nil || p != "provider-a" || m != "model-a" {
		t.Fatalf("got %s/%s err=%v", p, m, err)
	}
	p, m, err = resolveManagedModelCandidate("model-a", "provider-a")
	if err != nil || p != "provider-a" || m != "model-a" {
		t.Fatalf("compat got %s/%s err=%v", p, m, err)
	}
	if _, _, err := resolveManagedModelCandidate("provider-a/model-a", "other"); err == nil {
		t.Fatal("expected conflict")
	}
	if _, _, err := resolveManagedModelCandidate("model-a", ""); err == nil {
		t.Fatal("expected bare model without header to fail")
	}
}

func TestManagedChatCompletionsAuthorization(t *testing.T) {
	dir := t.TempDir()
	providersFile := filepath.Join(dir, "providers.json")
	if err := os.WriteFile(providersFile, []byte(`{
		"providers": [{
			"id": "provider-a",
			"displayName": "A",
			"baseUrl": "https://example.invalid/v1",
			"apiKey": "sk-test",
			"enabled": true,
			"isDefault": true,
			"route": "third-party",
			"models": [{ "name": "model-a", "label": "A", "enabled": true }]
		}]
	}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", providersFile)
	admin := runtimeconfig.New(slog.Default())
	admin.Start(context.Background())
	time.Sleep(30 * time.Millisecond)

	token := "agx-pat-managed-route-token"
	pat := gatewayauth.NewPATVerifier(nil)
	gatewayauth.SetPATLookupForTest(pat, token, gatewayauth.PATIdentity{
		APITokenID: 7,
		TenantID:   "tenant-a",
		UserID:     "user-a",
		DeptID:     "dept-a",
		Scopes:     []string{"workspace:chat", "desktop:managed"},
		UserEmail:  "alice@example.invalid",
	})

	authz := &stubManagedAuthorizer{allow: map[string]bool{"provider-a/model-a": true}}
	cap := &capturingProvider{}
	cfg := config.Config{DefaultRoute: "third-party", AuditDir: t.TempDir()}
	quotaCfg := filepath.Join(dir, "quotas.json")
	quotaUsage := filepath.Join(dir, "quota-usage.json")
	_ = os.WriteFile(quotaCfg, []byte(`{}`), 0o600)
	tracker := quota.NewTracker(quotaCfg, quotaUsage, nil)
	s := &Server{
		cfg:            cfg,
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		provider:       cap,
		decider:        routing.NewDeciderWithAdmin(cfg, admin),
		policy:         &policyengine.Engine{},
		audit:          nopAuditWriter{},
		billingService: billing.NewService(tracker),
		quotaTracker:   tracker,
		patVerifier:    pat,
		managedModels:  authz,
		metering:       nopMeterSink{},
	}

	body := `{"model":"provider-a/model-a","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.handleChatCompletions(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if cap.called != 1 || cap.lastModel != "model-a" || cap.lastProvider != "provider-a" {
		t.Fatalf("provider call=%d model=%q provider=%q", cap.called, cap.lastModel, cap.lastProvider)
	}

	authz.allow = map[string]bool{}
	req2 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	req2.Header.Set("Authorization", "Bearer "+token)
	rec2 := httptest.NewRecorder()
	before := cap.called
	s.handleChatCompletions(rec2, req2)
	if rec2.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d %s", rec2.Code, rec2.Body.String())
	}
	if cap.called != before {
		t.Fatal("provider must not be called on deny")
	}

	authz.err = errors.New("db down")
	req3 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	req3.Header.Set("Authorization", "Bearer "+token)
	rec3 := httptest.NewRecorder()
	s.handleChatCompletions(rec3, req3)
	if rec3.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d %s", rec3.Code, rec3.Body.String())
	}

	authz.err = nil
	authz.allow = map[string]bool{"provider-a/model-a": true}
	req4 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(body))
	req4.Header.Set("Authorization", "Bearer "+token)
	req4.Header.Set(routing.HeaderProvider, "evil-provider")
	rec4 := httptest.NewRecorder()
	s.handleChatCompletions(rec4, req4)
	if rec4.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 conflict, got %d %s", rec4.Code, rec4.Body.String())
	}

	compat := `{"model":"model-a","messages":[{"role":"user","content":"hi"}]}`
	req5 := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(compat))
	req5.Header.Set("Authorization", "Bearer "+token)
	req5.Header.Set(routing.HeaderProvider, "provider-a")
	rec5 := httptest.NewRecorder()
	s.handleChatCompletions(rec5, req5)
	if rec5.Code != http.StatusOK {
		t.Fatalf("compat status=%d body=%s", rec5.Code, rec5.Body.String())
	}
	if cap.lastProvider != "provider-a" || cap.lastModel != "model-a" {
		t.Fatalf("compat routing failed: model=%q provider=%q", cap.lastModel, cap.lastProvider)
	}
}
