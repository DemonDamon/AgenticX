package server

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

type statusRecorder struct {
	*httptest.ResponseRecorder
	statuses []int
}

func (w *statusRecorder) WriteHeader(code int) {
	w.statuses = append(w.statuses, code)
	w.ResponseRecorder.WriteHeader(code)
}

type discardUsageSink struct{}

func (discardUsageSink) ReportAsync(metering.UsageRecord) {}

type neverEndingProvider struct{}

func (neverEndingProvider) Complete(context.Context, openai.ChatCompletionRequest, routing.Decision) (openai.ChatCompletionResponse, error) {
	return openai.ChatCompletionResponse{}, nil
}

func (neverEndingProvider) Embeddings(context.Context, openai.EmbeddingRequest, routing.Decision) (openai.EmbeddingResponse, error) {
	return openai.EmbeddingResponse{}, nil
}

func (neverEndingProvider) Stream(ctx context.Context, _ openai.ChatCompletionRequest, _ routing.Decision, push func(openai.StreamChunk) error) error {
	if err := push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "partial"}}}}); err != nil {
		return err
	}
	<-ctx.Done()
	// A provider that swallows cancellation must not look successful.
	return nil
}

func TestRequestTimeoutHandlerFinishesBeforeDeadline(t *testing.T) {
	w := &statusRecorder{ResponseRecorder: httptest.NewRecorder()}
	handler := requestTimeout(time.Second)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if len(w.statuses) != 1 || w.statuses[0] != http.StatusOK || w.Body.String() != "ok" {
		t.Fatalf("early finish status=%v body=%q", w.statuses, w.Body.String())
	}
}

func TestRequestTimeoutFinishesActiveChatStreamWithErrorAndDone(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", filepath.Join(dir, "budgets.json"))
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(dir, "budget-usage.json"))
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", "")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")

	s := &Server{
		provider:     neverEndingProvider{},
		policy:       &policyengine.Engine{},
		metering:     discardUsageSink{},
		logger:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		quotaTracker: quota.NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "quota-usage.json"), nil),
	}
	w := &statusRecorder{ResponseRecorder: httptest.NewRecorder()}
	handler := requestTimeout(40 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.handleStream(w, r, openai.ChatCompletionRequest{Model: "slow-model", Stream: true}, routing.Decision{}, time.Now(), requestIdentity{}, 0, 0, nil, quota.CheckResult{}, quota.RequestContext{})
	}))

	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out stream handler did not return")
	}

	body := w.Body.String()
	if len(w.statuses) != 1 || w.statuses[0] != http.StatusOK {
		t.Fatalf("SSE status writes = %v, want only 200", w.statuses)
	}
	errAt := strings.Index(body, "本次生成超过时限")
	doneAt := strings.LastIndex(body, "data: [DONE]\n\n")
	if !strings.Contains(body, "partial") || errAt < 0 || doneAt < errAt || !strings.HasSuffix(body, "data: [DONE]\n\n") {
		t.Fatalf("missing active chunk, timeout error, or trailing [DONE]: %q", body)
	}
	if !strings.Contains(body, "event: error\n") || strings.Contains(body, "agenticx_usage") {
		t.Fatalf("timed out stream must carry an error frame and no success usage: %q", body)
	}
}

func TestRequestTimeoutReturns504BeforeHeaders(t *testing.T) {
	w := &statusRecorder{ResponseRecorder: httptest.NewRecorder()}
	handler := requestTimeout(20 * time.Millisecond)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	done := make(chan struct{})
	go func() {
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/healthz", nil))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("headerless timeout handler did not return")
	}
	if len(w.statuses) != 1 || w.statuses[0] != http.StatusGatewayTimeout {
		t.Fatalf("non-stream status writes = %v, want one 504", w.statuses)
	}
}

func TestRequestTimeoutFromEnv(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	t.Setenv("GATEWAY_REQUEST_TIMEOUT", "50ms")
	if got := requestTimeoutFromEnv(logger); got != 50*time.Millisecond {
		t.Fatalf("50ms parsed as %s", got)
	}
	w := httptest.NewRecorder()
	started := time.Now()
	handler := requestTimeout(requestTimeoutFromEnv(logger))(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("GATEWAY_REQUEST_TIMEOUT=50ms took %s", elapsed)
	}
	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("50ms timeout status=%d, want 504", w.Code)
	}

	t.Setenv("GATEWAY_REQUEST_TIMEOUT", "abc")
	if got := requestTimeoutFromEnv(logger); got != 10*time.Minute {
		t.Fatalf("abc fell back to %s, want 10m", got)
	}
	t.Setenv("GATEWAY_REQUEST_TIMEOUT", "")
	if got := requestTimeoutFromEnv(logger); got != 10*time.Minute {
		t.Fatalf("empty fell back to %s, want 10m", got)
	}
	t.Setenv("GATEWAY_REQUEST_TIMEOUT", "0s")
	if got := requestTimeoutFromEnv(logger); got != 10*time.Minute {
		t.Fatalf("non-positive fell back to %s, want 10m", got)
	}
}
