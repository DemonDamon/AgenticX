package relay

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// TestChannelRotationKillsAFiftyTimes 覆盖 AC-2：
// Channel-A 上游 5xx → 连续 50 次请求全部由 Channel-B 接管，0 个错误透传。
func TestChannelRotationKillsAFiftyTimes(t *testing.T) {
	var aHits, bHits int32

	upA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&aHits, 1)
		http.Error(w, `{"error":{"message":"upstream dead"}}`, http.StatusServiceUnavailable)
	}))
	defer upA.Close()

	upB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&bHits, 1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(openai.ChatCompletionResponse{
			ID:    "ok",
			Model: "deepseek-chat",
			Choices: []openai.ChatCompletionChoice{
				{Index: 0, Message: openai.ChatMessage{Role: "assistant", Content: "hi"}, FinishReason: "stop"},
				},
				Usage: openai.Usage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
		})
	}))
	defer upB.Close()

	channels := []channel.Channel{
		{
			ID: "chan-a", TenantID: "t1", Name: "A", ProviderType: "openai",
			BaseURL: upA.URL, APIKey: "k", Weight: 1, Status: channel.StatusActive,
			SupportedModels: []string{"deepseek-chat"},
		},
		{
			ID: "chan-b", TenantID: "t1", Name: "B", ProviderType: "openai",
			BaseURL: upB.URL, APIKey: "k", Weight: 1, Status: channel.StatusActive,
			SupportedModels: []string{"deepseek-chat"},
		},
	}
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot(channels)
	stats := channel.NewStatsStore()
	aff := channel.NewAffinityStore(time.Minute)
	picker := channel.NewPicker(reg, stats, aff)
	factory := adaptor.NewFactory(adaptor.NewOpenAIAdaptor())
	exec := NewExecutor(picker, factory, nil)

	ctx := context.Background()
	req := openai.ChatCompletionRequest{
		Model:    "deepseek-chat",
		Messages: []openai.ChatMessage{{Role: "user", Content: "ping"}},
	}

	successes := 0
	for i := 0; i < 50; i++ {
		id := channel.Identity{TenantID: "t1", SessionID: "s1"}
		res, err := exec.Complete(ctx, req, "deepseek-chat", id)
		if err != nil {
			t.Fatalf("iter %d: unexpected error %v (attempts=%+v)", i, err, res.Attempts)
		}
		if res.Channel.ID != "chan-b" {
			t.Fatalf("iter %d: expected chan-b, got %s", i, res.Channel.ID)
		}
		successes++
	}
	if successes != 50 {
		t.Fatalf("expected 50 successes, got %d", successes)
	}
	if atomic.LoadInt32(&bHits) < 50 {
		t.Fatalf("expected ≥50 hits on B, got %d", bHits)
	}
	// 命中 A 的次数应远小于 50：affinity 命中 B 后稳定，A 仅在 cooldown 过期后偶尔被探活。
	if got := atomic.LoadInt32(&aHits); got > 5 {
		t.Logf("A was hit %d times (cooldown probes acceptable)", got)
	}
}

// TestRetryAuditCarriesAttempts 覆盖 NFR-5：失败重试场景下 Attempts 含 A→fail+B→ok 顺序。
func TestRetryAuditCarriesAttempts(t *testing.T) {
	upA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusBadGateway)
	}))
	defer upA.Close()
	upB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(openai.ChatCompletionResponse{
			ID: "ok", Model: "m",
			Choices: []openai.ChatCompletionChoice{{Index: 0, Message: openai.ChatMessage{Role: "assistant", Content: "ok"}}},
		})
	}))
	defer upB.Close()

	channels := []channel.Channel{
		{ID: "a", TenantID: "t", Name: "A", BaseURL: upA.URL, APIKey: "k", Weight: 100, Status: channel.StatusActive, SupportedModels: []string{"m"}},
		{ID: "b", TenantID: "t", Name: "B", BaseURL: upB.URL, APIKey: "k", Weight: 1, Status: channel.StatusActive, SupportedModels: []string{"m"}},
	}
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot(channels)
	stats := channel.NewStatsStore()
	aff := channel.NewAffinityStore(time.Minute)
	picker := channel.NewPicker(reg, stats, aff)
	exec := NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), nil)

	// 优先选 A（weight=100），失败后切到 B。设一个空 sessionID 强制走 weightedSample，
	// 不依赖 affinity 命中 A。
	res, err := exec.Complete(context.Background(), openai.ChatCompletionRequest{
		Model:    "m",
		Messages: []openai.ChatMessage{{Role: "user", Content: "x"}},
	}, "m", channel.Identity{TenantID: "t"})
	if err != nil {
		t.Fatalf("expected eventual success, got %v", err)
	}
	if len(res.Attempts) < 2 {
		t.Fatalf("expected ≥2 attempts (A fail → B ok), got %+v", res.Attempts)
	}
	first := res.Attempts[0]
	last := res.Attempts[len(res.Attempts)-1]
	if first.Success {
		t.Fatalf("expected first attempt failure, got %+v", first)
	}
	if !last.Success || last.ChannelID != "b" {
		t.Fatalf("expected last attempt success on b, got %+v", last)
	}
	if strings.TrimSpace(first.RetryReason) == "" {
		t.Fatalf("expected retry_reason on failed attempt")
	}
}

// TestKeyFailoverWithinChannel401 覆盖 AC-1：同 Channel 内 bad key 401 后自动切到下一把 key。
func TestKeyFailoverWithinChannel401(t *testing.T) {
	const keyA = "TEST_KEYPOOL_KEY_A"
	const keyB = "TEST_KEYPOOL_KEY_B"
	t.Setenv(keyA, "sk-bad")
	t.Setenv(keyB, "sk-good")

	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if strings.Contains(auth, "sk-bad") {
			http.Error(w, `{"error":"invalid key"}`, http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(openai.ChatCompletionResponse{
			ID:    "ok",
			Model: "deepseek-chat",
			Choices: []openai.ChatCompletionChoice{
				{Index: 0, Message: openai.ChatMessage{Role: "assistant", Content: "hi"}, FinishReason: "stop"},
			},
		})
	}))
	defer up.Close()

	channels := []channel.Channel{
		{
			ID: "chan-k", TenantID: "t1", Name: "K", ProviderType: "openai",
			BaseURL: up.URL, Weight: 1, Status: channel.StatusActive,
			SupportedModels: []string{"deepseek-chat"},
			Metadata: map[string]any{"keyRefs": []string{keyA, keyB}},
		},
	}
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot(channels)
	picker := channel.NewPicker(reg, channel.NewStatsStore(), channel.NewAffinityStore(time.Minute))
	pool := keypool.NewPool()
	exec := NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), pool)

	res, err := exec.Complete(context.Background(), openai.ChatCompletionRequest{
		Model:    "deepseek-chat",
		Messages: []openai.ChatMessage{{Role: "user", Content: "ping"}},
	}, "deepseek-chat", channel.Identity{TenantID: "t1"})
	if err != nil {
		t.Fatalf("expected success after key failover, got %v", err)
	}
	if res.KeyRef != keyB {
		t.Fatalf("expected key ref %s, got %s", keyB, res.KeyRef)
	}
}

// server 路径会回退到 legacy Decider；此处校验信号。
func TestNoChannelsFallbackSignal(t *testing.T) {
	reg := channel.NewRegistry(nil, nil)
	if reg.HasChannels() {
		t.Fatal("expected HasChannels=false on empty registry")
	}
	// seed 后翻转
	reg.SetSnapshot([]channel.Channel{{ID: "x", Status: channel.StatusActive, SupportedModels: []string{"m"}}})
	if !reg.HasChannels() {
		t.Fatal("expected HasChannels=true after seed")
	}
}

// silenceUnused 让 io.ReadAll 等 import 在裁剪时保留可用。
var _ = io.ReadAll
