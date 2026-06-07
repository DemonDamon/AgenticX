package adaptor

import (
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
)

func TestAzureChatURL(t *testing.T) {
	ch := channel.Channel{
		BaseURL: "https://myresource.openai.azure.com",
		Metadata: map[string]any{
			"deployment":  "gpt-4o",
			"apiVersion":  "2024-06-01",
		},
	}
	u, err := azureChatURL(ch.BaseURL, ch, "client-model", false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(u, "/openai/deployments/gpt-4o/chat/completions") {
		t.Fatalf("unexpected path: %s", u)
	}
	if !strings.Contains(u, "api-version=2024-06-01") {
		t.Fatalf("missing api-version: %s", u)
	}
}

func TestAzureDeploymentFallbackModel(t *testing.T) {
	ch := channel.Channel{BaseURL: "https://x.openai.azure.com"}
	u, err := azureChatURL(ch.BaseURL, ch, "my-deploy", false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(u, "/deployments/my-deploy/") {
		t.Fatalf("expected model fallback deployment: %s", u)
	}
}

func TestFactoryAzure(t *testing.T) {
	f := NewFactory(NewOpenAIAdaptor())
	ad, err := f.For(channel.Channel{ProviderType: "azure"})
	if err != nil || ad.Name() != "azure" {
		t.Fatalf("expected azure adaptor, got %v err=%v", ad, err)
	}
}

func TestFactoryBedrock(t *testing.T) {
	f := NewFactory(NewOpenAIAdaptor())
	ad, err := f.For(channel.Channel{ProviderType: "aws-bedrock"})
	if err != nil || ad.Name() != "bedrock" {
		t.Fatalf("expected bedrock adaptor, got %v err=%v", ad, err)
	}
}

func TestFactoryOpenAICompatibleExplicit(t *testing.T) {
	f := NewFactory(NewOpenAIAdaptor())
	ad, err := f.For(channel.Channel{ProviderType: "openai-compatible"})
	if err != nil || ad.Name() != "openai" {
		t.Fatalf("expected openai adaptor for openai-compatible, got %v", ad)
	}
}
