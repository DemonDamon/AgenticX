package adaptor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// TestStreamIdleTimeout 覆盖 AC-6：上游 stall 超过 idle 阈值 → stream:idle_timeout。
func TestStreamIdleTimeout(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		_, _ = w.Write([]byte("data: {\"id\":\"x\"}\n\n"))
		if flusher != nil {
			flusher.Flush()
		}
		// 阻塞直到客户端断开
		<-r.Context().Done()
	}))
	defer up.Close()

	ad := NewOpenAIAdaptor(WithStreamConfig(StreamConfig{
		IdleTimeout:       200 * time.Millisecond,
		ScannerMaxBufferB: 16 * 1024 * 1024,
	}))
	ch := channel.Channel{ID: "x", BaseURL: up.URL, APIKey: "k", ProviderType: "openai"}
	err := ad.Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, ch, func(openai.StreamChunk) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "stream:idle_timeout") {
		t.Fatalf("expected stream:idle_timeout, got %v", err)
	}
}

// TestStreamBufferExceeded 覆盖 AC-6：单 event 累计字节超过上限 → stream:buffer_exceeded。
func TestStreamBufferExceeded(t *testing.T) {
	big := strings.Repeat("a", 2048)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for i := 0; i < 100; i++ {
			_, _ = w.Write([]byte("data: {\"id\":\"" + big + "\"}\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	defer up.Close()

	ad := NewOpenAIAdaptor(WithStreamConfig(StreamConfig{
		IdleTimeout:       5 * time.Second,
		ScannerMaxBufferB: 4 * 1024, // 4KB 上限，远小于 100 × 2KB
	}))
	ch := channel.Channel{ID: "x", BaseURL: up.URL, APIKey: "k", ProviderType: "openai"}
	err := ad.Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, ch, func(openai.StreamChunk) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "stream:buffer_exceeded") {
		t.Fatalf("expected stream:buffer_exceeded, got %v", err)
	}
}
