package cache

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestL2BypassesPIILikePrompt(t *testing.T) {
	req := openai.ChatCompletionRequest{
		Model:    "gpt-4o",
		Messages: []openai.ChatMessage{{Role: "user", Content: "my password is secret-key-123"}},
	}
	if !ShouldBypass(req) {
		t.Fatalf("expected PII-like prompt to bypass cache")
	}
}
