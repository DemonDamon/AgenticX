package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/database"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/metering"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/provider"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	"github.com/agenticx/enterprise/gateway/internal/transform"
	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
)

// Exercise the real reporter and SQL argument serialization without an external DB.
type phaseTraceConnector struct{ records chan []byte }
type phaseTraceDriver struct{}
type phaseTraceConn struct{ records chan []byte }

func (c phaseTraceConnector) Connect(context.Context) (driver.Conn, error) {
	return phaseTraceConn(c), nil
}
func (phaseTraceConnector) Driver() driver.Driver          { return phaseTraceDriver{} }
func (phaseTraceDriver) Open(string) (driver.Conn, error)  { return nil, driver.ErrSkip }
func (phaseTraceConn) Prepare(string) (driver.Stmt, error) { return nil, driver.ErrSkip }
func (phaseTraceConn) Close() error                        { return nil }
func (phaseTraceConn) Begin() (driver.Tx, error)           { return nil, driver.ErrSkip }
func (phaseTraceConn) Ping(context.Context) error          { return nil }
func (c phaseTraceConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if strings.Contains(query, "agent_token_traces") && len(args) == 16 {
		if raw, ok := args[15].Value.([]byte); ok {
			c.records <- append([]byte(nil), raw...)
		}
	}
	return driver.RowsAffected(1), nil
}
func phaseTraceReporter(t *testing.T) (*metering.TraceReporter, <-chan []byte) {
	t.Helper()
	records := make(chan []byte, 8)
	db := sql.OpenDB(phaseTraceConnector{records: records})
	t.Cleanup(func() { _ = db.Close() })
	reporter, err := metering.NewTraceReporter(&database.Handle{DB: db, Dialect: database.PostgreSQL}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	return reporter, records
}
func assertLeaseTraceReason(t *testing.T, records <-chan []byte) {
	t.Helper()
	select {
	case raw := <-records:
		var meta struct {
			Phases observability.PhaseSnapshot `json:"request_phases"`
		}
		if err := json.Unmarshal(raw, &meta); err != nil {
			t.Fatal(err)
		}
		if meta.Phases.Reason != "concurrency_lease_lost" {
			t.Fatalf("trace=%s", raw)
		}
	case <-time.After(time.Second):
		t.Fatal("existing trace reporter did not write phase metadata")
	}
}

type lossDiagnosticProvider struct {
	provider.ChatProvider
	lose       func()
	typedCause bool
}

func (p *lossDiagnosticProvider) Complete(ctx context.Context, _ openai.ChatCompletionRequest, _ routing.Decision) (openai.ChatCompletionResponse, error) {
	p.lose()
	<-ctx.Done()
	p.typedCause = errors.Is(context.Cause(ctx), quota.ErrConcurrencyLeaseLost)
	return receiptResponse(), nil // Deliberately swallow cancellation like a slow upstream.
}
func (p *lossDiagnosticProvider) Stream(ctx context.Context, _ openai.ChatCompletionRequest, _ routing.Decision, push func(openai.StreamChunk) error) error {
	if err := push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "prefix"}}}}); err != nil {
		return err
	}
	p.lose()
	<-ctx.Done()
	p.typedCause = errors.Is(context.Cause(ctx), quota.ErrConcurrencyLeaseLost)
	return nil
}

func TestDirectHandlersRecordTypedLeaseLossWithLiveOuterContext(t *testing.T) {
	oldKey, oldErr := publicKey, publicKeyErr
	publicKeyOnce = sync.Once{}
	t.Cleanup(func() {
		publicKey, publicKeyErr = oldKey, oldErr
		publicKeyOnce = sync.Once{}
		if oldKey != nil || oldErr != nil {
			publicKeyOnce.Do(func() {})
		}
	})
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	pub, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	t.Setenv("AUTH_JWT_PUBLIC_KEY", string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub})))
	claims := accessClaims{TenantID: "phase", UserID: "phase-user", Type: "access", Scopes: []string{"workspace:chat"}, RegisteredClaims: jwt.RegisteredClaims{Issuer: "agenticx-enterprise-web-portal", Audience: jwt.ClaimStrings{"agenticx-web-users"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "complete", true: "stream"}[stream], func(t *testing.T) {
			server := terminalDiagnosticServer(t, nil)
			t.Setenv("GATEWAY_CHANNEL_REGISTRY", "off")
			t.Setenv("GATEWAY_TRACE_IO_CAPTURE", "off")
			store := miniredis.RunT(t)
			limiter, err := quota.NewSharedRateLimiterWithLeaseOptions("redis://"+store.Addr(), quota.ConcurrencyLeaseOptions{TTL: 2 * time.Second, SafetyMargin: 100 * time.Millisecond, RenewInterval: 100 * time.Millisecond, RetryInterval: 25 * time.Millisecond, OperationTimeout: 50 * time.Millisecond})
			if err != nil {
				t.Fatal(err)
			}
			defer limiter.Close()
			dir := t.TempDir()
			configPath := filepath.Join(dir, "quota.json")
			if err := os.WriteFile(configPath, []byte(`{"users":{"phase-user":{"monthlyTokens":10000,"maxConcurrency":1,"action":"block"}}}`), 0600); err != nil {
				t.Fatal(err)
			}
			server.quotaTracker = quota.NewTrackerWithRateLimiter(configPath, filepath.Join(dir, "usage.json"), nil, limiter)
			server.billingService = billing.NewService(server.quotaTracker)
			model := &lossDiagnosticProvider{lose: store.FlushAll}
			server.provider = model
			reporter, traces := phaseTraceReporter(t)
			server.traceReporter = reporter
			var output bytes.Buffer
			outer, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			handler := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).HTTPMiddleware()(http.HandlerFunc(server.handleChatCompletions))
			requestBody, _ := json.Marshal(openai.ChatCompletionRequest{Model: "m", Stream: stream, Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("synthetic")}}})
			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(requestBody)).WithContext(outer)
			r.Header.Set("Authorization", "Bearer "+token)
			r.Header.Set(headerTraceID, "phase-trace")
			r.Header.Set(headerTraceStep, "1")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if outer.Err() != nil || !model.typedCause || !strings.Contains(w.Body.String(), "50302") {
				t.Fatalf("outer=%v cause=%v response=%s", outer.Err(), model.typedCause, w.Body.String())
			}
			assertTerminalDiagnostic(t, &output, "concurrency_lease_lost")
			assertLeaseTraceReason(t, traces)
		})
	}
}

type diagnosticLostLease struct {
	lost   atomic.Bool
	mu     sync.Mutex
	cancel context.CancelCauseFunc
}

func (*diagnosticLostLease) Release()       {}
func (l *diagnosticLostLease) IsLost() bool { return l.lost.Load() }
func (l *diagnosticLostLease) Lost() <-chan struct{} {
	ch := make(chan struct{})
	if l.IsLost() {
		close(ch)
	}
	return ch
}
func (l *diagnosticLostLease) Bind(ctx context.Context) (context.Context, context.CancelFunc) {
	bound, cancel := context.WithCancelCause(ctx)
	l.mu.Lock()
	l.cancel = cancel
	if l.IsLost() {
		cancel(quota.ErrConcurrencyLeaseLost)
	}
	l.mu.Unlock()
	return bound, func() { cancel(context.Canceled) }
}
func (l *diagnosticLostLease) lose() {
	l.lost.Store(true)
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.cancel != nil {
		l.cancel(quota.ErrConcurrencyLeaseLost)
	}
}

type lossDiagnosticAdaptor struct {
	adaptor.Adaptor
	lose func()
}

func (a lossDiagnosticAdaptor) Complete(context.Context, openai.ChatCompletionRequest, channel.Channel) (openai.ChatCompletionResponse, error) {
	a.lose()
	return receiptResponse(), nil
}
func (a lossDiagnosticAdaptor) Stream(_ context.Context, _ openai.ChatCompletionRequest, _ channel.Channel, push adaptor.StreamPush) error {
	if err := push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "prefix"}}}}); err != nil {
		return err
	}
	a.lose()
	return nil
}

func TestProtocolAndCacheLeaseLossShareTerminalAndTraceEvidence(t *testing.T) {
	for _, mode := range []string{"protocol-complete", "protocol-stream", "cache-complete", "cache-stream", "protocol-cache"} {
		t.Run(mode, func(t *testing.T) {
			server := terminalDiagnosticServer(t, nil)
			t.Setenv("GATEWAY_CHANNEL_REGISTRY", "on")
			t.Setenv("GATEWAY_TRACE_IO_CAPTURE", "off")
			reporter, traces := phaseTraceReporter(t)
			server.traceReporter = reporter
			lease := &diagnosticLostLease{}
			receipt := &quota.ReservationReceipt{Lease: lease}
			registry := channel.NewRegistry(nil, nil)
			registry.SetSnapshot([]channel.Channel{{ID: "phase", TenantID: "phase", ProviderType: "openai", Status: channel.StatusActive, APIKey: "synthetic", SupportedModels: []string{"m"}}})
			server.channelRegistry = registry
			server.relayExecutor = relay.NewExecutor(channel.NewPicker(registry, channel.NewStatsStore(), channel.NewAffinityStore(time.Minute)), adaptor.NewFactory(lossDiagnosticAdaptor{lose: lease.lose}), nil)
			var output bytes.Buffer
			outer, cancel := context.WithCancel(context.Background())
			defer cancel()
			stream := strings.HasSuffix(mode, "stream")
			req := openai.ChatCompletionRequest{Model: "m", Stream: stream, Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("synthetic")}}}
			if strings.Contains(mode, "cache") {
				server.cacheService = cache.NewService(cache.Config{L1Enabled: true}, cache.NewMemoryStore(4))
				entry := cache.Entry{Response: receiptResponse(), Usage: receiptResponse().Usage}
				if stream {
					entry = cache.BuildStreamEntry([]openai.StreamChunk{{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "prefix"}}}}, {Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "second"}}}}}, openai.Usage{PromptTokens: 6, CompletionTokens: 4, TotalTokens: 10}, req.Model)
				}
				server.cacheService.Write("phase", "phase-user", req, entry)
			}
			handler := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				identity := enrichTraceFromRequest(requestIdentity{TenantID: "phase", UserID: "phase-user"}, r)
				identity.quotaReservation = receipt
				r, stop := server.bindChatLease(r, receipt)
				defer stop()
				qctx := quota.RequestContext{Reservation: receipt}
				check := quota.CheckResult{Reservation: receipt}
				switch mode {
				case "protocol-complete":
					server.protocolComplete(w, r, req, identity, protocolSession{inbound: inbound.ProtocolResponses, outbound: inbound.ProtocolResponses}, transform.DerivedModel{}, "", time.Now(), 1, 1, check, qctx)
				case "protocol-stream":
					server.protocolStream(w, r, req, identity, protocolSession{inbound: "openai-chat", outbound: "openai-chat"}, transform.DerivedModel{}, "", time.Now(), 1, 1, check, qctx)
				case "cache-stream":
					// Preserve the real outer diagnostic writer while injecting loss after its first frame.
					wrapped := &leaseLossAfterWrite{ResponseWriter: w, stop: lease.lose}
					server.tryServeFromCache(cacheServeContext{w: wrapped, r: r, req: req, identity: identity, startedAt: time.Now(), estimatedInputTokens: 1, budgetCheck: &check})
				case "cache-complete", "protocol-cache":
					lease.lose()
					cacheCtx := cacheServeContext{w: w, r: r, req: req, identity: identity, startedAt: time.Now(), budgetCheck: &check}
					if mode == "protocol-cache" {
						server.tryServeProtocolCache(w, cacheCtx, protocolSession{outbound: inbound.ProtocolResponses})
					} else {
						server.tryServeFromCache(cacheCtx)
					}
				}
			}))
			r := httptest.NewRequest(http.MethodPost, "/", nil).WithContext(outer)
			r.Header.Set(headerTraceID, "phase-trace")
			r.Header.Set(headerTraceStep, "1")
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if outer.Err() != nil {
				t.Fatalf("outer context cancelled: %v", outer.Err())
			}
			assertTerminalDiagnostic(t, &output, "concurrency_lease_lost")
			if mode == "protocol-complete" || mode == "protocol-stream" || mode == "cache-stream" {
				assertLeaseTraceReason(t, traces)
			}
		})
	}
}

type leaseLossAfterWrite struct {
	http.ResponseWriter
	stop   func()
	writes int
}

func (w *leaseLossAfterWrite) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	w.writes++
	if w.writes == 1 {
		w.stop()
	}
	return n, err
}
func (w *leaseLossAfterWrite) Flush() { w.ResponseWriter.(http.Flusher).Flush() }

func TestTypedLeaseCauseIsObservedWithoutAReceiptOrCancelledOuterContext(t *testing.T) {
	for _, path := range []string{"stream", "write", "cache"} {
		t.Run(path, func(t *testing.T) {
			var output bytes.Buffer
			outer, phases := observability.NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), nil).Start(context.Background())
			bound, cancel := context.WithCancelCause(outer)
			cancel(errors.Join(quota.ErrConcurrencyLeaseLost, errors.New("sk-fake-private-cause")))
			switch path {
			case "stream":
				recordStreamDiagnostic(bound, nil, false)
			case "write":
				recordDiagnosticFailure(bound, io.ErrClosedPipe, observability.ReasonDownstreamError)
			case "cache":
				if !errors.Is(cachedRequestError(httptest.NewRequest(http.MethodGet, "/", nil).WithContext(bound), requestIdentity{}), quota.ErrConcurrencyLeaseLost) {
					t.Fatal("typed cache cause changed")
				}
			}
			if outer.Err() != nil || phases.Snapshot().TraceMetadata()["reason"] != "concurrency_lease_lost" {
				t.Fatal("cause did not reach shared trace recorder")
			}
			phases.Finish(outer, observability.ReasonCompleted)
			assertTerminalDiagnostic(t, &output, "concurrency_lease_lost")
			if strings.Contains(output.String(), "sk-fake") {
				t.Fatal("raw cause leaked")
			}
		})
	}
}
