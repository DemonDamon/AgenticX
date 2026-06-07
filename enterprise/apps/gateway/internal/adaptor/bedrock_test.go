package adaptor

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestOpenAIToBedrockConverse(t *testing.T) {
	req := openai.ChatCompletionRequest{
		Model:    "anthropic.claude-3-haiku-20240307-v1:0",
		System:   "be helpful",
		Messages: []openai.ChatMessage{{Role: "user", Content: "hello"}},
		MaxTokens: 128,
		Temperature: 0.2,
	}
	wire := openAIToBedrockConverse(req)
	if len(wire.System) == 0 || wire.System[0].Text != "be helpful" {
		t.Fatalf("expected system block: %+v", wire.System)
	}
	if len(wire.Messages) != 1 || wire.Messages[0].Content[0].Text != "hello" {
		t.Fatalf("unexpected messages: %+v", wire.Messages)
	}
	if wire.InferenceConfig == nil || wire.InferenceConfig.MaxTokens != 128 {
		t.Fatalf("expected inference config: %+v", wire.InferenceConfig)
	}
}

func TestBedrockConverseToOpenAI(t *testing.T) {
	var wire bedrockConverseResponse
	wire.Output.Message = bedrockMessage{
		Role:    "assistant",
		Content: []bedrockContentBlock{{Text: "hi there"}},
	}
	wire.Usage.InputTokens = 10
	wire.Usage.OutputTokens = 5
	wire.Usage.TotalTokens = 15
	wire.StopReason = "end_turn"
	out := bedrockConverseToOpenAI(wire, "claude-haiku")
	if out.Choices[0].Message.Content != "hi there" {
		t.Fatalf("unexpected content: %q", out.Choices[0].Message.Content)
	}
	if out.Usage.TotalTokens != 15 {
		t.Fatalf("unexpected usage: %+v", out.Usage)
	}
}

func TestBedrockStreamEventToChunk(t *testing.T) {
	raw := `{"contentBlockDelta":{"delta":{"text":"Hel"}}}`
	var ev bedrockStreamEvent
	if err := json.Unmarshal([]byte(raw), &ev); err != nil {
		t.Fatal(err)
	}
	chunk, ok := bedrockStreamEventToChunk("claude-haiku", ev)
	if !ok || chunk.Choices[0].Delta.Content != "Hel" {
		t.Fatalf("unexpected chunk: %+v ok=%v", chunk, ok)
	}
	stopRaw := `{"messageStop":{"stopReason":"end_turn"}}`
	var stopEv bedrockStreamEvent
	if err := json.Unmarshal([]byte(stopRaw), &stopEv); err != nil {
		t.Fatal(err)
	}
	stopChunk, ok := bedrockStreamEventToChunk("claude-haiku", stopEv)
	if !ok || stopChunk.Choices[0].FinishReason == nil || *stopChunk.Choices[0].FinishReason != "end_turn" {
		t.Fatalf("unexpected stop chunk: %+v", stopChunk)
	}
}

func TestBedrockEmbeddingsUnsupported(t *testing.T) {
	ad := NewBedrockAdaptor()
	_, err := ad.Embeddings(context.Background(), openai.EmbeddingRequest{}, channel.Channel{})
	if err == nil || !strings.Contains(err.Error(), "embeddings not supported") {
		t.Fatalf("expected embeddings error, got %v", err)
	}
}

func TestBedrockPrepareMissingCreds(t *testing.T) {
	ad := NewBedrockAdaptor()
	_, err := ad.Complete(context.Background(), openai.ChatCompletionRequest{Model: "m"}, channel.Channel{Region: "us-east-1"})
	if err == nil || !strings.Contains(err.Error(), "credentials") {
		t.Fatalf("expected credentials error, got %v", err)
	}
}

func TestBedrockCredentialsFromAPIKey(t *testing.T) {
	raw := "ACCESSKEYID" + ":" + "SECRETKEYVALUE"
	ak, sk := bedrockCredentials(channel.Channel{APIKey: raw})
	if ak != "ACCESSKEYID" || sk != "SECRETKEYVALUE" {
		t.Fatalf("unexpected creds: %s %s", ak, sk)
	}
}

func TestBedrockCredentialsFromMetadata(t *testing.T) {
	ak, sk := bedrockCredentials(channel.Channel{
		Metadata: map[string]any{
			"accessKeyId":     "ACCESSKEYID",
			"secretAccessKey": "SECRETKEYVALUE",
		},
	})
	if ak != "ACCESSKEYID" || sk != "SECRETKEYVALUE" {
		t.Fatalf("unexpected creds: %s %s", ak, sk)
	}
}
