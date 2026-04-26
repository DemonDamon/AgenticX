package provider

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func TestDefaultKeyFromEnv_PrefersProviderSpecific(t *testing.T) {
	t.Setenv("LLM_API_KEY", "fallback-key")
	t.Setenv("DEEPSEEK_API_KEY", "ds-real")

	if got := DefaultKeyFromEnv("deepseek"); got != "ds-real" {
		t.Fatalf("expected provider-specific key, got %q", got)
	}
}

func TestDefaultKeyFromEnv_FallsBackToGeneric(t *testing.T) {
	t.Setenv("LLM_API_KEY", "fallback-key")
	t.Setenv("MOONSHOT_API_KEY", "")

	if got := DefaultKeyFromEnv("moonshot"); got != "fallback-key" {
		t.Fatalf("expected fallback key, got %q", got)
	}
}

func TestDefaultKeyFromEnv_HyphenProviderName(t *testing.T) {
	t.Setenv("EDGE_AGENT_API_KEY", "edge-real")

	if got := DefaultKeyFromEnv("edge-agent"); got != "edge-real" {
		t.Fatalf("expected hyphen-translated key, got %q", got)
	}
}

func TestOpenAIHTTP_Complete_SendsBearerAndDecodesResponse(t *testing.T) {
	var receivedAuth string
	var receivedBody openai.ChatCompletionRequest

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		receivedAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&receivedBody)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id": "chatcmpl_real",
			"object": "chat.completion",
			"created": 1700000000,
			"model": "deepseek-chat",
			"choices": [
				{"index": 0, "message": {"role": "assistant", "content": "你好，世界"}, "finish_reason": "stop"}
			],
			"usage": {"prompt_tokens": 8, "completion_tokens": 5, "total_tokens": 13}
		}`))
	}))
	defer server.Close()

	provider := NewOpenAICompatibleProvider(
		WithKeyResolver(func(string) string { return "test-key" }),
	)

	resp, err := provider.Complete(context.Background(),
		openai.ChatCompletionRequest{
			Model:    "deepseek-chat",
			Messages: []openai.ChatMessage{{Role: "user", Content: "hi"}},
		},
		routing.Decision{Provider: "deepseek", Endpoint: server.URL + "/v1", Model: "deepseek-chat"},
	)
	if err != nil {
		t.Fatalf("Complete returned error: %v", err)
	}
	if receivedAuth != "Bearer test-key" {
		t.Errorf("expected bearer header, got %q", receivedAuth)
	}
	if receivedBody.Stream {
		t.Errorf("Complete should send stream=false to upstream")
	}
	if len(resp.Choices) != 1 || resp.Choices[0].Message.Content != "你好，世界" {
		t.Errorf("unexpected upstream response: %+v", resp)
	}
}

func TestOpenAIHTTP_Complete_FallsBackWhenKeyMissing(t *testing.T) {
	provider := NewOpenAICompatibleProvider(
		WithKeyResolver(func(string) string { return "" }),
	)

	resp, err := provider.Complete(context.Background(),
		openai.ChatCompletionRequest{
			Model:    "deepseek-chat",
			Messages: []openai.ChatMessage{{Role: "user", Content: "hi"}},
		},
		routing.Decision{Provider: "deepseek", Endpoint: "https://example.com/v1", Model: "deepseek-chat"},
	)
	if err != nil {
		t.Fatalf("expected fallback success, got error: %v", err)
	}
	if len(resp.Choices) != 1 || !strings.Contains(resp.Choices[0].Message.Content, "mock") {
		t.Errorf("expected mock fallback content, got %+v", resp)
	}
}

func TestOpenAIHTTP_Stream_ParsesSSEChunksAndStopsOnDone(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)

		_, _ = io.WriteString(w, ": heartbeat\n\n")
		_, _ = io.WriteString(w, `data: {"id":"c1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"你"}}]}`+"\n\n")
		flusher.Flush()
		_, _ = io.WriteString(w, `data: {"id":"c1","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"好"}}]}`+"\n\n")
		flusher.Flush()
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer server.Close()

	provider := NewOpenAICompatibleProvider(
		WithKeyResolver(func(string) string { return "test-key" }),
	)

	var collected strings.Builder
	err := provider.Stream(context.Background(),
		openai.ChatCompletionRequest{
			Model:    "m",
			Messages: []openai.ChatMessage{{Role: "user", Content: "hi"}},
			Stream:   true,
		},
		routing.Decision{Provider: "moonshot", Endpoint: server.URL + "/v1", Model: "m"},
		func(chunk openai.StreamChunk) error {
			if len(chunk.Choices) > 0 {
				collected.WriteString(chunk.Choices[0].Delta.Content)
			}
			return nil
		},
	)
	if err != nil {
		t.Fatalf("Stream returned error: %v", err)
	}
	if got := collected.String(); got != "你好" {
		t.Errorf("expected concatenated stream %q, got %q", "你好", got)
	}
}

func TestOpenAIHTTP_Complete_PropagatesUpstreamError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
	}))
	defer server.Close()

	provider := NewOpenAICompatibleProvider(
		WithKeyResolver(func(string) string { return "bad-key" }),
	)

	_, err := provider.Complete(context.Background(),
		openai.ChatCompletionRequest{
			Model:    "deepseek-chat",
			Messages: []openai.ChatMessage{{Role: "user", Content: "hi"}},
		},
		routing.Decision{Provider: "deepseek", Endpoint: server.URL + "/v1", Model: "deepseek-chat"},
	)
	if err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("expected upstream 401 error, got %v", err)
	}
}
