package cache

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestCanonicalKeyStableAcrossFieldOrder(t *testing.T) {
	temperature := 0.2
	reqA := openai.ChatCompletionRequest{
		Model: "gpt-4o",
		Messages: []openai.ChatMessage{
			{Role: "user", Content: openai.NewStringContent("hello")},
			{Role: "assistant", Content: openai.NewStringContent("hi")},
		},
		Temperature: &temperature,
	}
	reqB := openai.ChatCompletionRequest{
		Model: "gpt-4o",
		Messages: []openai.ChatMessage{
			{Role: "assistant", Content: openai.NewStringContent("hi")},
			{Role: "user", Content: openai.NewStringContent("hello")},
		},
		Temperature: &temperature,
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

func TestCanonicalKeyDistinguishesOmittedAndExplicitZeroTemperature(t *testing.T) {
	explicitZero := 0.0
	omitted := openai.ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("ping")}},
	}
	withZero := omitted
	withZero.Temperature = &explicitZero

	omittedKey, omittedBypass, _ := CanonicalKey("tenant-1", "user-1", omitted.Model, omitted)
	zeroKey, zeroBypass, _ := CanonicalKey("tenant-1", "user-1", withZero.Model, withZero)
	if omittedBypass || zeroBypass {
		t.Fatal("unexpected cache bypass")
	}
	if omittedKey == zeroKey {
		t.Fatal("omitted and explicit temperature=0 must use different cache keys")
	}
}

func TestCanonicalKeyExcludesStream(t *testing.T) {
	base := openai.ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("ping")}},
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
		Model:      "gpt-4o",
		Messages:   []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("call tool")}},
		Tools:      []openai.Tool{{Type: "function", Function: &openai.ToolFunction{Name: "search"}}},
		ToolChoice: "auto",
	}
	if !ShouldBypass(req) {
		t.Fatalf("expected tool requests to bypass cache")
	}
}
