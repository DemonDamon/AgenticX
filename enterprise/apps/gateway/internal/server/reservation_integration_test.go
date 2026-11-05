package server

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
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
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/outbound"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/golang-jwt/jwt/v5"
)

type receiptProvider struct {
	streamMode string
	partial    bool
	total      bool
	fail       bool
	calls      int
}

func (p *receiptProvider) Complete(context.Context, openai.ChatCompletionRequest, routing.Decision) (openai.ChatCompletionResponse, error) {
	p.calls++
	if p.fail {
		return openai.ChatCompletionResponse{}, errors.New("synthetic pre-output cancellation")
	}
	resp := receiptResponse()
	if p.total {
		resp.Usage.TotalTokens = 15
	}
	return resp, nil
}
func (*receiptProvider) Embeddings(context.Context, openai.EmbeddingRequest, routing.Decision) (openai.EmbeddingResponse, error) {
	return openai.EmbeddingResponse{}, nil
}
func (p *receiptProvider) Stream(_ context.Context, _ openai.ChatCompletionRequest, _ routing.Decision, push func(openai.StreamChunk) error) error {
	if strings.HasSuffix(p.streamMode, "usage") {
		u := openai.Usage{PromptTokens: 6, CompletionTokens: 4, TotalTokens: 10}
		if err := push(openai.StreamChunk{Usage: &u}); err != nil {
			return err
		}
	}
	if strings.HasSuffix(p.streamMode, "tool") {
		if err := push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{ToolCalls: json.RawMessage(receiptToolDelta)}}}}); err != nil {
			return err
		}
	}
	if p.partial {
		if err := push(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "part"}}}}); err != nil {
			return err
		}
	}
	return errors.New("synthetic interrupted stream")
}
func receiptResponse() openai.ChatCompletionResponse {
	return openai.ChatCompletionResponse{ID: "synthetic-completion", Model: "m", Choices: []openai.ChatCompletionChoice{{Message: openai.ChatMessage{Role: "assistant", Content: openai.NewStringContent("done")}}}, Usage: openai.Usage{PromptTokens: 6, CompletionTokens: 4, TotalTokens: 10}}
}

func TestReservationAllChatExitsSettleOriginalRows(t *testing.T) {
	oldKey, oldErr := publicKey, publicKeyErr
	publicKeyOnce = sync.Once{}
	t.Cleanup(func() {
		publicKey = oldKey
		publicKeyErr = oldErr
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
	for _, mode := range []string{"direct", "direct-failure", "channel", "cache", "protocol", "protocol-cache", "protocol-unavailable", "direct-stream-failure", "direct-stream-partial", "protocol-stream-failure", "protocol-stream-partial", "direct-total", "channel-total", "direct-stream-usage", "direct-stream-tool", "protocol-stream-usage", "protocol-stream-tool"} {
		t.Run(mode, func(t *testing.T) {
			d := t.TempDir()
			for key, value := range map[string]string{"GATEWAY_QUOTA_POOL": "on", "GATEWAY_QUOTA_POOL_BACKEND": "local", "GATEWAY_TOKEN_WINDOW_QUOTA": "on", "GATEWAY_REQUEST_COUNT_QUOTA": "off", "GATEWAY_REMOTE_QUOTA_CONFIG_URL": "", "GATEWAY_REMOTE_BUDGET_CONFIG_URL": "", "GATEWAY_BUDGET_BACKEND": "", "GATEWAY_CHANNEL_REGISTRY": "off", "GATEWAY_ADMIN_CHANNELS_FILE": filepath.Join(d, "channels.json"), "GATEWAY_REMOTE_CHANNELS_URL": "", "GATEWAY_BUDGET_CONFIG_FILE": filepath.Join(d, "budgets.json"), "GATEWAY_BUDGET_USAGE_FILE": filepath.Join(d, "budgets-usage.json"), "GATEWAY_QUOTA_POOL_USAGE_FILE": filepath.Join(d, "pools.json")} {
				t.Setenv(key, value)
			}
			qp := filepath.Join(d, "quotas.json")
			up := filepath.Join(d, "usage.json")
			if err := os.WriteFile(qp, []byte(`{"users":{"receipt-user":{"monthlyTokens":1000,"dailyTokens":1000,"weeklyTokens":1000,"maxConcurrency":1,"action":"block"}}}`), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(d, "budgets.json"), []byte(`{"version":2,"users":{"receipt-user":{"unit":"tokens","period":"month","limit":1000,"action":"block"}}}`), 0600); err != nil {
				t.Fatal(err)
			}
			provider := &receiptProvider{streamMode: mode, fail: mode == "direct-failure", partial: strings.HasSuffix(mode, "partial"), total: strings.HasSuffix(mode, "total")}
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			tracker := quota.NewTracker(qp, up, nil)
			s := &Server{provider: provider, policy: &policyengine.Engine{}, logger: logger, quotaTracker: tracker, billingService: billing.NewService(tracker), metering: discardUsageSink{}, audit: &fakeAuditWriter{}, decider: routing.NewDecider(config.Config{DefaultRoute: "third-party"})}
			reqBody := openai.ChatCompletionRequest{Model: "m", Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("hello")}}, MaxTokens: 100}
			reqBody.Stream = strings.Contains(mode, "stream")
			raw, _ := json.Marshal(reqBody)
			r := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(raw)))
			if strings.HasPrefix(mode, "channel") || mode == "protocol" || strings.HasPrefix(mode, "protocol-stream") {
				t.Setenv("GATEWAY_CHANNEL_REGISTRY", "on")
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if reqBody.Stream {
						w.Header().Set("Content-Type", "text/event-stream")
						if strings.HasSuffix(mode, "usage") {
							_, _ = w.Write([]byte("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":6,\"completion_tokens\":4,\"total_tokens\":10}}\n\n"))
						}
						if strings.HasSuffix(mode, "tool") {
							_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"tool_calls\":" + receiptToolDelta + "}}]}\n\n"))
						}

						if strings.HasSuffix(mode, "partial") {
							_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"part\"}}]}\n\n"))
						}
						return
					}
					resp := receiptResponse()
					if strings.HasSuffix(mode, "total") {
						resp.Usage.TotalTokens = 15
					}
					_ = json.NewEncoder(w).Encode(resp)
				}))
				defer upstream.Close()
				s.channelRegistry = channel.NewRegistry(logger, nil)
				s.channelRegistry.SetSnapshot([]channel.Channel{{ID: "synthetic", TenantID: "receipt-tenant", Status: channel.StatusActive, ProviderType: "openai", APIKey: "synthetic-test-key", BaseURL: upstream.URL, SupportedModels: []string{"m"}, Weight: 1}})
				stats := channel.NewStatsStore()
				picker := channel.NewPicker(s.channelRegistry, stats, channel.NewAffinityStore(0))
				s.relayExecutor = relay.NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), keypool.NewPool())
			}
			if mode == "cache" || mode == "protocol-cache" {
				s.cacheService = cache.NewService(cache.Config{L1Enabled: true, L1TTL: time.Minute}, nil)
				s.cacheService.Write("receipt-tenant", "receipt-user", reqBody, cache.Entry{Response: receiptResponse(), Usage: receiptResponse().Usage})
			}
			w := httptest.NewRecorder()
			if strings.HasPrefix(mode, "protocol") {
				s.dispatchProtocol(w, r, reqBody, requestIdentity{TenantID: "receipt-tenant", UserID: "receipt-user"}, protocolSession{inbound: inbound.ProtocolResponses, outbound: outbound.ProtocolResponses})
			} else {
				claims := accessClaims{UserID: "receipt-user", TenantID: "receipt-tenant", Type: "access", Scopes: []string{"workspace:chat"}, RegisteredClaims: jwt.RegisteredClaims{Issuer: "agenticx-enterprise-web-portal", Audience: jwt.ClaimStrings{"agenticx-web-users"}, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}
				token, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
				if err != nil {
					t.Fatal(err)
				}
				r.Header.Set("Authorization", "Bearer "+token)
				s.handleChatCompletions(w, r)
			}
			want := int64(10)
			if strings.HasSuffix(mode, "total") {
				want = 15
			}
			if strings.Contains(mode, "stream") {
				want = 0
				if strings.HasSuffix(mode, "partial") {
					want = int64(estimateTextTokens("hello") + estimateTextTokens("part"))
				}
			}
			if mode == "direct-failure" || mode == "protocol-unavailable" {
				want = 0
				if w.Code < 400 {
					t.Fatalf("failure unexpectedly succeeded: %d", w.Code)
				}
			} else if w.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if strings.HasSuffix(mode, "usage") {
				want = 10
			}
			if strings.HasSuffix(mode, "tool") {
				want = int64(estimateTextTokens("hello") + estimateTextTokens(receiptToolDelta))
			}
			qctx := quota.RequestContext{TenantID: "receipt-tenant", UserID: "receipt-user", Role: "staff", Model: "m"}
			if used := tracker.Remaining(qctx).Used; used != want {
				t.Fatalf("monthly=%d want%d body=%s", used, want, w.Body.String())
			}
			if got := readBudgetUsed(t, filepath.Join(d, "budgets-usage.json")); got != float64(want) {
				t.Fatalf("budget=%v want%d", got, want)
			}
			var rows []struct {
				Used int64 `json:"used_total"`
			}
			b, err := os.ReadFile(filepath.Join(d, "pools.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err = json.Unmarshal(b, &rows); err != nil {
				t.Fatal(err)
			}
			if len(rows) != 2 {
				t.Fatalf("window rows=%s", b)
			}
			for _, row := range rows {
				if row.Used != want {
					t.Fatalf("window=%d want%d", row.Used, want)
				}
			}
			// All exits released the captured slot, even when no upstream response existed.
			probe := tracker.CheckRequest(qctx, 1, 0)
			if !probe.Allowed {
				t.Fatalf("slot leaked: %+v", probe)
			}
			if err := tracker.FinishReservation(probe.Reservation, 0, 0); err != nil {
				t.Fatal(err)
			}
			tracker.ReleaseReservation(probe.Reservation)
			if (mode == "cache" || mode == "protocol-cache") && provider.calls != 0 {
				t.Fatal("cache called upstream")
			}
		})
	}
}

const receiptToolDelta = `[{"index":0,"function":{"arguments":"{}"}}]`

func TestProtocolStreamMidLeaseLossUsesSharedServiceError(t *testing.T) {
	t.Setenv("GATEWAY_CHANNEL_REGISTRY", "on")
	lease := &observedLostLease{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n"))
	}))
	defer upstream.Close()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	registry := channel.NewRegistry(logger, nil)
	registry.SetSnapshot([]channel.Channel{{ID: "lease-protocol", TenantID: "t", Status: channel.StatusActive, ProviderType: "openai", APIKey: "synthetic-test-key", BaseURL: upstream.URL, SupportedModels: []string{"m"}, Weight: 1}})
	picker := channel.NewPicker(registry, channel.NewStatsStore(), channel.NewAffinityStore(0))
	s := &Server{logger: logger, channelRegistry: registry, relayExecutor: relay.NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), keypool.NewPool()), billingService: billing.NewService(nil), policy: &policyengine.Engine{}, metering: discardUsageSink{}, audit: leaseDiscardAudit{}, decider: routing.NewDecider(config.Config{})}
	req := openai.ChatCompletionRequest{Model: "m", Stream: true}
	_, derived := applyDerivedModel(req)
	receipt := &quota.ReservationReceipt{Lease: lease}
	identity := requestIdentity{TenantID: "t", UserID: "u", quotaReservation: receipt}
	w := &lossAfterFirstCachedWrite{ResponseRecorder: httptest.NewRecorder(), stop: func() { lease.lost.Store(true) }}
	s.protocolStream(w, httptest.NewRequest(http.MethodPost, "/v1/responses", nil), req, identity, protocolSession{inbound: "openai-chat", outbound: "openai-chat"}, derived, "", time.Now(), 2, 10, quota.CheckResult{Reservation: receipt}, quota.RequestContext{Reservation: receipt})
	body := w.Body.String()
	if !strings.Contains(body, "first") || !strings.Contains(body, "50302") || strings.Contains(body, "50000") {
		t.Fatalf("protocol mid-stream loss has inconsistent code: %s", body)
	}
}
