package relay

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func newPrefixExecutor(t *testing.T, aURL, bURL string) (*Executor, *channel.StatsStore) {
	t.Helper()
	t.Setenv("GATEWAY_AI_LB_POLICY", "prefix_cache")
	stats := channel.NewStatsStore()
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot([]channel.Channel{
		{
			ID: "a-up", ProviderType: "openai", BaseURL: aURL, APIKey: "k",
			Status: channel.StatusActive, SupportedModels: []string{"m"}, Weight: 1,
		},
		{
			ID: "b-up", ProviderType: "openai", BaseURL: bURL, APIKey: "k",
			Status: channel.StatusActive, SupportedModels: []string{"m"}, Weight: 1,
		},
	})
	picker := channel.NewPicker(reg, stats, channel.NewAffinityStore(0))
	return NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), keypool.NewPool()), stats
}

func emptyPrefixRequest() openai.ChatCompletionRequest {
	return openai.ChatCompletionRequest{
		Model:    "m",
		Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("")}},
	}
}

func writeSSEThenReset(t *testing.T, w http.ResponseWriter, events ...string) {
	t.Helper()
	hj, ok := w.(http.Hijacker)
	if !ok {
		t.Fatal("response writer does not support hijack")
	}
	conn, bufrw, err := hj.Hijack()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := bufrw.WriteString("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n"); err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if _, err := fmt.Fprintf(bufrw, "%x\r\n%s\r\n", len(event), event); err != nil {
			t.Fatal(err)
		}
	}
	if err := bufrw.Flush(); err != nil {
		t.Fatal(err)
	}
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetLinger(0)
	}
	_ = conn.Close()
}

func sseContent(text string) string {
	return `data: {"choices":[{"delta":{"content":"` + text + `"}}]}` + "\n\n"
}

func TestStreamDoesNotRetryChannelAfterClientOutput(t *testing.T) {
	var bHits atomic.Int32
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		bHits.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sseContent("from-b") + "data: [DONE]\n\n"))
	}))
	defer b.Close()
	a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeSSEThenReset(t, w, sseContent("a1"), sseContent("a2"))
	}))
	defer a.Close()

	exec, stats := newPrefixExecutor(t, a.URL, b.URL)
	var got []string
	_, err := exec.Stream(context.Background(), emptyPrefixRequest(), "m", channel.Identity{}, func(chunk openai.StreamChunk) error {
		if len(chunk.Choices) > 0 {
			got = append(got, chunk.Choices[0].Delta.Content)
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected error after partial output")
	}
	if !IsChannelRetryable(err) {
		t.Fatalf("disconnect should stay channel-retryable, got %v", err)
	}
	if len(got) != 2 || got[0] != "a1" || got[1] != "a2" {
		t.Fatalf("push got %#v, want [a1 a2]", got)
	}
	if bHits.Load() != 0 {
		t.Fatalf("channel B calls = %d, want 0", bHits.Load())
	}
	if !stats.InCooldown("a-up", time.Now()) {
		t.Fatal("channel A should be in cooldown")
	}
}

func TestStreamToolCallChunkCountsAsCommitted(t *testing.T) {
	var bHits atomic.Int32
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		bHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer b.Close()
	a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeSSEThenReset(t, w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"lookup\",\"arguments\":\"{}\"}}]}}]}\n\n")
	}))
	defer a.Close()

	exec, stats := newPrefixExecutor(t, a.URL, b.URL)
	var toolChunks int
	_, err := exec.Stream(context.Background(), emptyPrefixRequest(), "m", channel.Identity{}, func(chunk openai.StreamChunk) error {
		if len(chunk.Choices) > 0 && len(chunk.Choices[0].Delta.ToolCalls) > 0 {
			toolChunks++
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected error after tool-call output")
	}
	if toolChunks != 1 {
		t.Fatalf("tool chunks = %d, want 1", toolChunks)
	}
	if bHits.Load() != 0 {
		t.Fatalf("channel B calls = %d, want 0", bHits.Load())
	}
	if !stats.InCooldown("a-up", time.Now()) {
		t.Fatal("channel A should be in cooldown")
	}
}

func TestStreamRetriesChannelBeforeAnyOutput(t *testing.T) {
	var bHits atomic.Int32
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		bHits.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sseContent("from-b") + "data: [DONE]\n\n"))
	}))
	defer b.Close()
	a := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	defer a.Close()

	exec, _ := newPrefixExecutor(t, a.URL, b.URL)
	var got []string
	_, err := exec.Stream(context.Background(), emptyPrefixRequest(), "m", channel.Identity{}, func(chunk openai.StreamChunk) error {
		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			got = append(got, chunk.Choices[0].Delta.Content)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if bHits.Load() != 1 {
		t.Fatalf("channel B calls = %d, want 1", bHits.Load())
	}
	if len(got) != 1 || got[0] != "from-b" {
		t.Fatalf("push got %#v, want [from-b]", got)
	}
}

func TestStreamDoesNotRetryWhenClientWriteFails(t *testing.T) {
	var hits atomic.Int32
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(sseContent("x") + "data: [DONE]\n\n"))
	})
	a := httptest.NewServer(handler)
	defer a.Close()
	b := httptest.NewServer(handler)
	defer b.Close()

	exec, _ := newPrefixExecutor(t, a.URL, b.URL)
	_, err := exec.Stream(context.Background(), emptyPrefixRequest(), "m", channel.Identity{}, func(openai.StreamChunk) error {
		return &net.OpError{Op: "write", Err: errors.New("broken pipe")}
	})
	if err == nil {
		t.Fatal("expected client write error")
	}
	if IsChannelRetryable(err) {
		t.Fatalf("client write error should not be channel-retryable, got %v", err)
	}
	if hits.Load() != 1 {
		t.Fatalf("upstream calls = %d, want 1", hits.Load())
	}
}
