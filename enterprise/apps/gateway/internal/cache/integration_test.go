package cache

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestL1HitSkipsUpstream(t *testing.T) {
	svc := NewService(Config{L1Enabled: true, L1TTL: 0}, NewMemoryStore(32))
	req := openai.ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []openai.ChatMessage{{Role: "user", Content: "same prompt"}},
	}
	entry := Entry{
		Response: openai.ChatCompletionResponse{
			Model: req.Model,
			Choices: []openai.ChatCompletionChoice{{
				Message: openai.ChatMessage{Role: "assistant", Content: "cached answer"},
			}},
			Usage: openai.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
		},
		Usage: openai.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
	}
	svc.Write("tenant-a", "user-a", req, entry)
	hit, ok := svc.Lookup("tenant-a", "user-a", req)
	if !ok || hit.Layer != LayerL1 {
		t.Fatalf("expected L1 hit, got ok=%v layer=%s", ok, hit.Layer)
	}
}
