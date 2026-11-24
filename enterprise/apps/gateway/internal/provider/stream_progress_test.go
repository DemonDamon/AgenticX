package provider

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func TestDirectStreamRequiresTerminalWithoutReplay(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"prefix\"}}]}\n\n")
	}))
	defer server.Close()
	p := NewOpenAICompatibleProvider(WithKeyResolver(func(string) string { return "synthetic" }))
	chunks := 0
	err := p.Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, routing.Decision{Endpoint: server.URL}, func(openai.StreamChunk) error { chunks++; return nil })
	if !errors.Is(err, openai.ErrIncompleteStream) || calls.Load() != 1 || chunks != 1 {
		t.Fatalf("err=%v calls=%d chunks=%d", err, calls.Load(), chunks)
	}
}

func TestDirectStreamCancellationClosesStalledBody(t *testing.T) {
	closed := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	p := NewOpenAICompatibleProvider(WithKeyResolver(func(string) string { return "synthetic" }))
	err := p.Stream(ctx, openai.ChatCompletionRequest{Model: "m"}, routing.Decision{Endpoint: server.URL}, func(openai.StreamChunk) error { return nil })
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("got %v", err)
	}
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("upstream request remained open")
	}
}
