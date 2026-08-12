package adaptor

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func temperaturePtr(value float64) *float64 {
	return &value
}

func TestProviderPivotsPreserveExplicitZeroTemperature(t *testing.T) {
	temperature := temperaturePtr(0)
	req := openai.ChatCompletionRequest{
		Model:       "m",
		Messages:    []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("hello")}},
		Temperature: temperature,
	}

	claudeWire := pivotToClaudeRequest(req, channel.Channel{}, false)
	if claudeWire.Temperature == nil || *claudeWire.Temperature != 0 {
		t.Fatalf("claude pivot lost explicit temperature=0: %#v", claudeWire.Temperature)
	}

	geminiWire := pivotToGeminiRequest(req)
	if geminiWire.GenerationConfig == nil || geminiWire.GenerationConfig.Temperature == nil || *geminiWire.GenerationConfig.Temperature != 0 {
		t.Fatalf("gemini pivot lost explicit temperature=0: %#v", geminiWire.GenerationConfig)
	}

	bedrockWire := openAIToBedrockConverse(req)
	if bedrockWire.InferenceConfig == nil || bedrockWire.InferenceConfig.Temperature == nil || *bedrockWire.InferenceConfig.Temperature != 0 {
		t.Fatalf("bedrock pivot lost explicit temperature=0: %#v", bedrockWire.InferenceConfig)
	}

	for name, payload := range map[string]any{
		"claude":  claudeWire,
		"gemini":  geminiWire,
		"bedrock": bedrockWire,
	} {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal %s request: %v", name, err)
		}
		if !strings.Contains(string(raw), `"temperature":0`) {
			t.Errorf("%s wire payload lost explicit temperature=0: %s", name, raw)
		}
	}
}

func TestOpenAIAdaptorForwardsExplicitZeroTemperature(t *testing.T) {
	var received map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c1","model":"m","choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}`))
	}))
	defer server.Close()

	adaptor := NewOpenAIAdaptor()
	adaptor.httpClient = server.Client()
	_, err := adaptor.Complete(
		context.Background(),
		openai.ChatCompletionRequest{
			Model:       "m",
			Messages:    []openai.ChatMessage{{Role: "user", Content: openai.NewStringContent("hello")}},
			Temperature: temperaturePtr(0),
		},
		channel.Channel{BaseURL: server.URL, APIKey: "test-key"},
	)
	if err != nil {
		t.Fatal(err)
	}
	value, ok := received["temperature"]
	if !ok || string(value) != "0" {
		t.Fatalf("upstream request lost explicit temperature=0: %s", value)
	}
}
