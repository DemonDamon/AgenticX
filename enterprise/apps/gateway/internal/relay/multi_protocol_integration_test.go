package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/inbound"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/outbound"
)

// TestClaudeInboundOpenAIUpstreamStream covers AC-1 style path: Claude pivot -> OpenAI upstream -> Claude SSE.
func TestClaudeInboundOpenAIUpstreamStream(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer up.Close()

	channels := []channel.Channel{{
		ID: "c1", TenantID: "t1", Name: "openai-up", ProviderType: "openai",
		BaseURL: up.URL, APIKey: "k", Status: channel.StatusActive,
		SupportedModels: []string{"deepseek-chat"},
	}}
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot(channels)
	picker := channel.NewPicker(reg, channel.NewStatsStore(), channel.NewAffinityStore(0))
	exec := NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), keypool.NewPool())

	body := strings.NewReader(`{"model":"deepseek-chat","max_tokens":64,"stream":true,"messages":[{"role":"user","content":"ping"}]}`)
	pivot, err := inbound.ParseClaudeMessages(body)
	if err != nil {
		t.Fatal(err)
	}

	enc := outbound.NewClaudeStreamEncoder(pivot.Model)
	var sse bytes.Buffer
	push := func(chunk openai.StreamChunk) error {
		if line := enc.MessageStart(); len(line) > 0 {
			sse.Write(line)
		}
		for _, line := range enc.EncodeChunk(chunk) {
			sse.Write(line)
		}
		return nil
	}
	_, err = exec.Stream(context.Background(), pivot, pivot.Model, channel.Identity{TenantID: "t1"}, push)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range enc.Final(openai.Usage{CompletionTokens: 1}) {
		sse.Write(line)
	}
	out := sse.String()
	if !strings.Contains(out, "content_block_delta") || !strings.Contains(out, "message_stop") {
		t.Fatalf("expected anthropic sse events, got %q", out)
	}
}

func TestGeminiInboundPivotRoundTrip(t *testing.T) {
	body := strings.NewReader(`{"contents":[{"role":"user","parts":[{"text":"x"}]}]}`)
	req, err := inbound.ParseGeminiGenerate(body, "gemini-1.5-pro", true)
	if err != nil {
		t.Fatal(err)
	}
	enc := outbound.NewGeminiStreamEncoder(req.Model)
	chunk := openai.StreamChunk{
		Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "y"}}},
	}
	lines := enc.EncodeChunk(chunk)
	if len(lines) != 1 || !bytesContains(lines[0], "candidates") {
		t.Fatalf("unexpected gemini sse %q", lines[0])
	}
}

func TestOpenAIUpstreamCompleteViaPivot(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(openai.ChatCompletionResponse{
			Model: "m",
			Choices: []openai.ChatCompletionChoice{{
				Message: openai.ChatMessage{Role: "assistant", Content: "ok"},
			}},
			Usage: openai.Usage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
		})
	}))
	defer up.Close()
	channels := []channel.Channel{{
		ID: "c1", ProviderType: "openai", BaseURL: up.URL, APIKey: "k",
		Status: channel.StatusActive, SupportedModels: []string{"m"},
	}}
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot(channels)
	exec := NewExecutor(channel.NewPicker(reg, channel.NewStatsStore(), channel.NewAffinityStore(0)), adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), nil)
	res, err := exec.Complete(context.Background(), openai.ChatCompletionRequest{
		Model: "m", Messages: []openai.ChatMessage{{Role: "user", Content: "x"}},
	}, "m", channel.Identity{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Response.Choices) == 0 || res.Response.Choices[0].Message.Content != "ok" {
		t.Fatalf("unexpected %+v", res.Response)
	}
}

func bytesContains(b []byte, sub string) bool {
	return strings.Contains(string(b), sub)
}

func TestClaudeAdaptorUpstreamMock(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "msg_1",
			"content": []map[string]any{{"type": "text", "text": "hello"}},
			"usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
		})
	}))
	defer up.Close()
	ad := adaptor.NewClaudeAdaptor()
	resp, err := ad.Complete(context.Background(), openai.ChatCompletionRequest{
		Model: "claude-3", Messages: []openai.ChatMessage{{Role: "user", Content: "x"}}, MaxTokens: 10,
	}, channel.Channel{BaseURL: up.URL, APIKey: "k"})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Choices) == 0 || resp.Choices[0].Message.Content != "hello" {
		t.Fatalf("unexpected %+v", resp)
	}
}

func TestGeminiAdaptorUpstreamMock(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, ":generateContent") {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"candidates": []map[string]any{{
				"content": map[string]any{
					"parts": []map[string]any{{"text": "gemini"}},
				},
			}},
			"usageMetadata": map[string]any{"promptTokenCount": 1, "candidatesTokenCount": 1},
		})
	}))
	defer up.Close()
	ad := adaptor.NewGeminiAdaptor()
	resp, err := ad.Complete(context.Background(), openai.ChatCompletionRequest{
		Model: "gemini-1.5-pro", Messages: []openai.ChatMessage{{Role: "user", Content: "x"}},
	}, channel.Channel{BaseURL: up.URL, APIKey: "k"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Choices[0].Message.Content != "gemini" {
		t.Fatalf("unexpected %+v", resp)
	}
}

func TestMapUpstreamErrorOverloaded(t *testing.T) {
	err := adaptor.MapUpstreamError(529, "overloaded_error", inbound.ProtocolClaude)
	if err.HTTPStatus != http.StatusTooManyRequests {
		t.Fatalf("unexpected %+v", err)
	}
}
