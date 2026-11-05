package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/transform"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

type terminalAuditWriter struct{ err error }

func (w terminalAuditWriter) Write(*audit.Event) error { return w.err }

type terminalProvider struct{ provider.ChatProvider }

func (terminalProvider) Stream(_ context.Context, _ openai.ChatCompletionRequest, _ routing.Decision, push func(openai.StreamChunk) error) error {
	return push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "prefix"}}}})
}

type terminalAdaptor struct{ adaptor.Adaptor }

func (terminalAdaptor) Stream(_ context.Context, _ openai.ChatCompletionRequest, _ channel.Channel, push adaptor.StreamPush) error {
	return push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "prefix"}}}})
}

type terminalFailWriter struct {
	*httptest.ResponseRecorder
	marker string
	failed bool
}

func (w *terminalFailWriter) Write(payload []byte) (int, error) {
	if w.marker != "" && bytes.Contains(payload, []byte(w.marker)) {
		w.failed = true
		return 0, io.ErrClosedPipe
	}
	return w.ResponseRecorder.Write(payload)
}

func terminalDiagnosticServer(t *testing.T, auditError error) *Server {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", filepath.Join(dir, "budgets.json"))
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", filepath.Join(dir, "budget-usage.json"))
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", "")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	tracker := quota.NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	return &Server{provider: terminalProvider{}, policy: &policyengine.Engine{}, audit: terminalAuditWriter{auditError}, metering: discardUsageSink{}, logger: slog.New(slog.NewTextHandler(io.Discard, nil)), quotaTracker: tracker, billingService: billing.NewService(tracker), decider: routing.NewDecider(config.Config{})}
}

func assertTerminalDiagnostic(t *testing.T, output *bytes.Buffer, want observability.TerminalReason) {
	t.Helper()
	var snapshot observability.PhaseSnapshot
	if err := json.Unmarshal(output.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Reason != want || bytes.Count(output.Bytes(), []byte("\n")) != 1 {
		t.Fatalf("terminal record=%s want=%s", output.String(), want)
	}
}

func TestFinalChatStreamFailuresAreNotCompleted(t *testing.T) {
	for _, tc := range []struct {
		name, marker string
		auditError   error
		reason       observability.TerminalReason
	}{
		{"usage_write", "agenticx_usage", nil, observability.ReasonDownstreamError},
		{"done_write", "data: [DONE]", nil, observability.ReasonDownstreamError},
		{"audit", "", io.ErrUnexpectedEOF, observability.ReasonInternalError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := terminalDiagnosticServer(t, tc.auditError)
			var output bytes.Buffer
			alive := false
			handler := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				server.handleStream(w, r, openai.ChatCompletionRequest{Model: "m", Stream: true}, routing.Decision{}, time.Now(), requestIdentity{}, 0, 0, nil, quota.CheckResult{}, quota.RequestContext{})
				alive = r.Context().Err() == nil
			}))
			writer := &terminalFailWriter{ResponseRecorder: httptest.NewRecorder(), marker: tc.marker}
			handler.ServeHTTP(writer, httptest.NewRequest(http.MethodPost, "/", nil))
			if !alive || writer.Code != http.StatusOK || (tc.marker != "" && !writer.failed) {
				t.Fatalf("alive=%v status=%d failed=%v", alive, writer.Code, writer.failed)
			}
			assertTerminalDiagnostic(t, &output, tc.reason)
		})
	}
}

func TestFinalProtocolWritesAreNotCompleted(t *testing.T) {
	for _, tc := range []struct {
		protocol, marker string
		auditError       error
		reason           observability.TerminalReason
	}{
		{inbound.ProtocolClaude, "event: message_stop", nil, observability.ReasonDownstreamError},
		{inbound.ProtocolGemini, "data: [DONE]", nil, observability.ReasonDownstreamError},
		{inbound.ProtocolResponses, "response.output_text.done", nil, observability.ReasonDownstreamError},
		{inbound.ProtocolGemini, "", io.ErrUnexpectedEOF, observability.ReasonInternalError},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			server := terminalDiagnosticServer(t, tc.auditError)
			registry := channel.NewRegistry(nil, nil)
			registry.SetSnapshot([]channel.Channel{{ID: "phase", TenantID: "phase", ProviderType: "openai", Status: channel.StatusActive, APIKey: "synthetic", SupportedModels: []string{"m"}}})
			server.relayExecutor = relay.NewExecutor(channel.NewPicker(registry, channel.NewStatsStore(), channel.NewAffinityStore(time.Minute)), adaptor.NewFactory(terminalAdaptor{}), nil)
			var output bytes.Buffer
			alive := false
			handler := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				server.protocolStream(w, r, openai.ChatCompletionRequest{Model: "m", Stream: true}, requestIdentity{TenantID: "phase"}, protocolSession{inbound: tc.protocol, outbound: tc.protocol}, transform.DerivedModel{}, transform.ThinkingMode(""), time.Now(), 0, 0, quota.CheckResult{}, quota.RequestContext{})
				alive = r.Context().Err() == nil
			}))
			writer := &terminalFailWriter{ResponseRecorder: httptest.NewRecorder(), marker: tc.marker}
			handler.ServeHTTP(writer, httptest.NewRequest(http.MethodPost, "/", nil))
			if !alive || (tc.marker != "" && !writer.failed) || writer.Code != http.StatusOK {
				t.Fatalf("alive=%v failed=%v status=%d", alive, writer.failed, writer.Code)
			}
			assertTerminalDiagnostic(t, &output, tc.reason)
		})
	}
}

func TestCacheReplayAndAuditFailuresAreNotCompleted(t *testing.T) {
	for _, tc := range []struct {
		name, marker string
		auditError   error
		reason       observability.TerminalReason
	}{
		{"replay", "data: [DONE]", nil, observability.ReasonDownstreamError},
		{"audit", "", io.ErrUnexpectedEOF, observability.ReasonInternalError},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := terminalDiagnosticServer(t, tc.auditError)
			server.cacheService = cache.NewService(cache.Config{L1Enabled: true}, cache.NewMemoryStore(8))
			req := openai.ChatCompletionRequest{Model: "m", Stream: true, Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("synthetic")}}}
			server.cacheService.Write("phase", "phase", req, cache.BuildStreamEntry([]openai.StreamChunk{{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "cached"}}}}}, openai.Usage{}, req.Model))
			var output bytes.Buffer
			alive, served := false, false
			handler := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				served = server.tryServeFromCache(cacheServeContext{w: w, r: r, req: req, identity: requestIdentity{TenantID: "phase", UserID: "phase"}, startedAt: time.Now()})
				alive = r.Context().Err() == nil
			}))
			writer := &terminalFailWriter{ResponseRecorder: httptest.NewRecorder(), marker: tc.marker}
			handler.ServeHTTP(writer, httptest.NewRequest(http.MethodPost, "/", nil))
			if !alive || !served || writer.Code != http.StatusOK || (tc.marker != "" && !writer.failed) {
				t.Fatalf("alive=%v served=%v status=%d failed=%v", alive, served, writer.Code, writer.failed)
			}
			assertTerminalDiagnostic(t, &output, tc.reason)
		})
	}
}

func TestSampledRealSSEPreservesFlushInterfaces(t *testing.T) {
	for _, http2 := range []bool{false, true} {
		t.Run(map[bool]string{false: "http1", true: "http2"}[http2], func(t *testing.T) {
			var output bytes.Buffer
			release := make(chan struct{})
			flushError := make(chan error, 1)
			handler := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				if _, ok := w.(http.Flusher); !ok {
					flushError <- http.ErrNotSupported
					return
				}
				_, _ = io.WriteString(w, "data: first\n\n")
				if err := http.NewResponseController(w).Flush(); err != nil {
					flushError <- err
					return
				}
				flushError <- nil
				select {
				case <-release:
				case <-r.Context().Done():
					return
				}
				_, _ = io.WriteString(w, "data: [DONE]\n\n")
			}))
			server := httptest.NewUnstartedServer(handler)
			if http2 {
				server.EnableHTTP2 = true
				server.StartTLS()
			} else {
				server.Start()
			}
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
			response, err := server.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if err := <-flushError; err != nil {
				t.Fatal(err)
			}
			if http2 && response.ProtoMajor != 2 {
				t.Fatalf("protocol=%s", response.Proto)
			}
			reader := bufio.NewReader(response.Body)
			line, err := reader.ReadString('\n')
			if err != nil || line != "data: first\n" {
				t.Fatalf("line=%q err=%v", line, err)
			}
			close(release)
			rest, err := io.ReadAll(reader)
			if err != nil || !strings.Contains(string(rest), "[DONE]") {
				t.Fatalf("rest=%q err=%v", rest, err)
			}
			assertTerminalDiagnostic(t, &output, observability.ReasonCompleted)
		})
	}
}

func TestProducerSuccessDoesNotClaimCompletedTraceSnapshot(t *testing.T) {
	var output bytes.Buffer
	ctx, phases := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).Start(context.Background())
	recordStreamDiagnostic(ctx, nil, false)
	before := phases.Snapshot().TraceMetadata()
	if before["reason"] != string(observability.ReasonOther) {
		t.Fatalf("premature trace outcome: %v", before)
	}
	recordDiagnosticFailure(ctx, io.ErrClosedPipe, observability.ReasonDownstreamError)
	if phases.Snapshot().TraceMetadata()["reason"] != string(observability.ReasonDownstreamError) {
		t.Fatal("trace snapshot lost handler-tail failure")
	}
	phases.Finish(ctx, observability.ReasonCompleted)
	assertTerminalDiagnostic(t, &output, observability.ReasonDownstreamError)
}
