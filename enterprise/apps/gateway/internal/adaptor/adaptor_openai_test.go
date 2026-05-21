package adaptor

import (
	"context"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestClaudeAdaptorNotImplemented(t *testing.T) {
	ad := NewClaudeAdaptor()
	_, err := ad.Complete(context.Background(), openai.ChatCompletionRequest{}, channel.Channel{})
	if err == nil || err.Error() != "claude: not_implemented" {
		t.Fatalf("expected not_implemented, got %v", err)
	}
}

func TestGeminiAdaptorNotImplemented(t *testing.T) {
	ad := NewGeminiAdaptor()
	err := ad.Stream(context.Background(), openai.ChatCompletionRequest{}, channel.Channel{}, nil)
	if err == nil || err.Error() != "gemini: not_implemented" {
		t.Fatalf("expected not_implemented, got %v", err)
	}
}

func TestFactoryOpenAI(t *testing.T) {
	f := NewFactory(NewOpenAIAdaptor())
	ad, err := f.For(channel.Channel{ProviderType: "openai"})
	if err != nil || ad.Name() != "openai" {
		t.Fatalf("expected openai adaptor, got %v err=%v", ad, err)
	}
}
