package adaptor

import (
	"context"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestClaudeAdaptorRegistered(t *testing.T) {
	ad := NewClaudeAdaptor()
	if ad.Name() != "claude" {
		t.Fatalf("expected claude, got %s", ad.Name())
	}
	_, err := ad.Complete(context.Background(), openai.ChatCompletionRequest{}, channel.Channel{})
	if err == nil || err.Error() != "channel missing api key" {
		t.Fatalf("expected missing api key, got %v", err)
	}
}

func TestGeminiAdaptorRegistered(t *testing.T) {
	ad := NewGeminiAdaptor()
	if ad.Name() != "gemini" {
		t.Fatalf("expected gemini, got %s", ad.Name())
	}
	err := ad.Stream(context.Background(), openai.ChatCompletionRequest{}, channel.Channel{}, nil)
	if err == nil || err.Error() != "channel missing api key" {
		t.Fatalf("expected missing api key, got %v", err)
	}
}

func TestFactoryOpenAI(t *testing.T) {
	f := NewFactory(NewOpenAIAdaptor())
	ad, err := f.For(channel.Channel{ProviderType: "openai"})
	if err != nil || ad.Name() != "openai" {
		t.Fatalf("expected openai adaptor, got %v err=%v", ad, err)
	}
}
