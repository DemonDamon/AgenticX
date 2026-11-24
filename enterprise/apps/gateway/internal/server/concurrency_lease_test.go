package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
)

type observedLostLease struct{ lost atomic.Bool }

func (l *observedLostLease) Release()     {}
func (l *observedLostLease) IsLost() bool { return l.lost.Load() }
func (l *observedLostLease) Lost() <-chan struct{} {
	ch := make(chan struct{})
	if l.IsLost() {
		close(ch)
	}
	return ch
}
func (l *observedLostLease) Bind(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithCancel(ctx)
}

func TestCachedResponseChecksLeaseSynchronouslyBeforeSuccess(t *testing.T) {
	lease := &observedLostLease{}
	lease.lost.Store(true)
	identity := requestIdentity{TenantID: "t", UserID: "u", quotaReservation: &quota.ReservationReceipt{Lease: lease}}
	req := openai.ChatCompletionRequest{Model: "m", Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("fixture")}}}
	service := cache.NewService(cache.Config{L1Enabled: true, L1TTL: time.Minute}, nil)
	service.Write("t", "u", req, cache.Entry{Response: receiptResponse(), Usage: receiptResponse().Usage})
	s := &Server{cacheService: service}
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	if !s.tryServeFromCache(cacheServeContext{w: w, r: r, req: req, identity: identity}) {
		t.Fatal("expected hit refusal")
	}
	if w.Code != http.StatusServiceUnavailable || !strings.Contains(w.Body.String(), "50302") {
		t.Fatalf("lost lease returned success: %d %s", w.Code, w.Body.String())
	}
}
func TestCachedStreamCannotEmitTerminalAfterLeaseLoss(t *testing.T) {
	lease := &observedLostLease{}
	w := httptest.NewRecorder()
	guard := &leaseCacheStreamWriter{ResponseWriter: w, flusher: w, identity: requestIdentity{quotaReservation: &quota.ReservationReceipt{Lease: lease}}}
	if _, err := guard.Write([]byte("data: partial\n\n")); err != nil {
		t.Fatal(err)
	}
	lease.lost.Store(true)
	if _, err := guard.Write([]byte("data: [DONE]\n\n")); !errors.Is(err, quota.ErrConcurrencyLeaseLost) {
		t.Fatal("terminal write ignored loss", err)
	}
	if strings.Contains(w.Body.String(), "[DONE]") {
		t.Fatal("successful terminal escaped after lease expiry")
	}
}

type lossAfterFirstCachedWrite struct {
	*httptest.ResponseRecorder
	stop   func()
	writes int
}

func (w *lossAfterFirstCachedWrite) Write(p []byte) (int, error) {
	n, err := w.ResponseRecorder.Write(p)
	w.writes++
	if w.writes == 1 {
		w.stop()
	}
	return n, err
}
func TestCachedReplayStopsAndChargesOnlyDeliveredPrefix(t *testing.T) {
	for _, mode := range []string{"lease", "context"} {
		t.Run(mode, func(t *testing.T) {
			lease := &observedLostLease{}
			identity := requestIdentity{TenantID: "t", UserID: "u", quotaReservation: &quota.ReservationReceipt{Lease: lease}}
			req := openai.ChatCompletionRequest{Model: "m", Stream: true, Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("fixture")}}}
			service := cache.NewService(cache.Config{L1Enabled: true, L1TTL: time.Minute}, nil)
			chunks := []openai.StreamChunk{{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "first"}}}}, {Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "second"}}}}}
			service.Write("t", "u", req, cache.Entry{Stream: true, StreamChunks: chunks, Usage: openai.Usage{PromptTokens: 90, CompletionTokens: 10, TotalTokens: 100}})
			request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			ctx, cancel := context.WithCancel(request.Context())
			defer cancel()
			request = request.WithContext(ctx)
			stop := func() { lease.lost.Store(true) }
			if mode == "context" {
				stop = cancel
			}
			recorder := &lossAfterFirstCachedWrite{ResponseRecorder: httptest.NewRecorder(), stop: stop}
			sink := &capturingUsageSink{}
			s := &Server{cacheService: service, metering: sink, audit: leaseDiscardAudit{}}
			if !s.tryServeFromCache(cacheServeContext{w: recorder, r: request, req: req, identity: identity, estimatedInputTokens: 3}) {
				t.Fatal("expected cache hit")
			}
			if strings.Contains(recorder.Body.String(), "second") || strings.Contains(recorder.Body.String(), "[DONE]") {
				t.Fatal("replay continued after cancellation", recorder.Body.String())
			}
			if len(sink.records) != 1 || sink.records[0].TotalTokens != 5 {
				t.Fatalf("did not settle delivered prefix only: %+v", sink.records)
			}
		})
	}
}
func TestProtocolCacheChecksLeaseAndCancelledContextBeforeBilling(t *testing.T) {
	for _, mode := range []string{"lease", "context"} {
		t.Run(mode, func(t *testing.T) {
			lease := &observedLostLease{}
			if mode == "lease" {
				lease.lost.Store(true)
			}
			identity := requestIdentity{TenantID: "t", UserID: "u", quotaReservation: &quota.ReservationReceipt{Lease: lease}}
			req := openai.ChatCompletionRequest{Model: "m", Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("fixture")}}}
			service := cache.NewService(cache.Config{L1Enabled: true, L1TTL: time.Minute}, nil)
			service.Write("t", "u", req, cache.Entry{Response: receiptResponse(), Usage: receiptResponse().Usage})
			request := httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			if mode == "context" {
				ctx, cancel := context.WithCancel(request.Context())
				cancel()
				request = request.WithContext(ctx)
			}
			w := httptest.NewRecorder()
			s := &Server{cacheService: service}
			if !s.tryServeProtocolCache(w, cacheServeContext{w: w, r: request, req: req, identity: identity}, protocolSession{outbound: inbound.ProtocolResponses}) {
				t.Fatal("expected rejected hit")
			}
			if w.Code == http.StatusOK {
				t.Fatalf("cancelled cache returned200: %s", w.Body.String())
			}
		})
	}
}
