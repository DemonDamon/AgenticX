package cache

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestCanonicalKeyStableAcrossFieldOrder(t *testing.T) {
	reqA := openai.ChatCompletionRequest{
		Model: "gpt-4o",
		Messages: []openai.ChatMessage{
			{Role: "user", Content: "hello"},
			{Role: "assistant", Content: "hi"},
		},
		Temperature: 0.2,
	}
	reqB := openai.ChatCompletionRequest{
		Model: "gpt-4o",
		Messages: []openai.ChatMessage{
			{Role: "assistant", Content: "hi"},
			{Role: "user", Content: "hello"},
		},
		Temperature: 0.2,
	}
	keyA, bypassA, _ := CanonicalKey("tenant-1", "user-1", reqA.Model, reqA)
	keyB, bypassB, _ := CanonicalKey("tenant-1", "user-1", reqB.Model, reqB)
	if bypassA || bypassB {
		t.Fatalf("unexpected bypass")
	}
	if keyA != keyB {
		t.Fatalf("expected stable canonical key, got %s vs %s", keyA, keyB)
	}
}

func TestCanonicalKeyExcludesStream(t *testing.T) {
	base := openai.ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []openai.ChatMessage{{Role: "user", Content: "ping"}},
	}
	stream := base
	stream.Stream = true
	keyA, _, _ := CanonicalKey("tenant-1", "user-1", base.Model, base)
	keyB, _, _ := CanonicalKey("tenant-1", "user-1", stream.Model, stream)
	if keyA != keyB {
		t.Fatalf("stream flag should not affect canonical key")
	}
}

func TestShouldBypassTools(t *testing.T) {
	req := openai.ChatCompletionRequest{
		Model: "gpt-4o",
		Messages: []openai.ChatMessage{{Role: "user", Content: "call tool"}},
		Tools: []openai.Tool{{Type: "function", Function: &openai.ToolFunction{Name: "search"}}},
		ToolChoice: "auto",
	}
	if !ShouldBypass(req) {
		t.Fatalf("expected tool requests to bypass cache")
	}
}
