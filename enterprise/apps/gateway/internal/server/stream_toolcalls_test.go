package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/adaptor"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/config"
	"github.com/agenticx/enterprise/gateway/internal/keypool"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/relay"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

const (
	chatToolArgHead = `{"city":`
	chatToolArgTail = `"shanghai"}`
	chatToolFrag1   = `[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":""}}]`
	chatToolFrag2   = `[{"index":0,"function":{"arguments":"{\"city\":"}}]`
	chatToolFrag3   = `[{"index":0,"function":{"arguments":"\"shanghai\"}"}}]`
)

func chatToolCallSSE() string {
	events := []string{
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}`,
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":` + chatToolFrag1 + `}}]}`,
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":` + chatToolFrag2 + `}}]}`,
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":` + chatToolFrag3 + `}}]}`,
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		`[DONE]`,
	}
	var buf bytes.Buffer
	for _, event := range events {
		buf.WriteString("data: ")
		buf.WriteString(event)
		buf.WriteString("\n\n")
	}
	return buf.String()
}

func TestChatCompletionsStreamPassesToolCallArguments(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(chatToolCallSSE()))
	}))
	defer up.Close()

	t.Setenv("GATEWAY_CHANNEL_REGISTRY", "on")
	engine, err := policyengine.NewEngine(nil)
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	reg := channel.NewRegistry(logger, nil)
	reg.SetSnapshot([]channel.Channel{{
		ID:              "ch-a",
		TenantID:        "tenant-1",
		Name:            "upstream",
		ProviderType:    "openai",
		BaseURL:         up.URL,
		APIKey:          "k",
		Status:          channel.StatusActive,
		SupportedModels: []string{"tool-model"},
		Weight:          1,
	}})
	picker := channel.NewPicker(reg, channel.NewStatsStore(), channel.NewAffinityStore(0))
	s := newPATServer(t, &fakeAuditWriter{})
	s.logger = logger
	s.policy = engine
	s.metering = &capturingUsageSink{}
	s.decider = routing.NewDecider(config.Config{DefaultRoute: "third-party"})
	s.billingService = billing.NewService(nil)
	s.channelRegistry = reg
	s.channelPicker = picker
	s.relayExecutor = relay.NewExecutor(picker, adaptor.NewFactory(adaptor.NewOpenAIAdaptor()), keypool.NewPool())

	req := httptest.NewRequest(
		http.MethodPost,
		"/v1/chat/completions",
		strings.NewReader(`{"model":"tool-model","stream":true,"messages":[{"role":"user","content":"ping"}]}`),
	)
	req.Header.Set("Authorization", "Bearer agx-pat-chat-only")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	var args strings.Builder
	sawToolCalls := false
	for _, line := range strings.Split(rec.Body.String(), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk openai.StreamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil || len(chunk.Choices) == 0 {
			continue
		}
		raw := chunk.Choices[0].Delta.ToolCalls
		if len(raw) == 0 {
			continue
		}
		sawToolCalls = true
		var calls []struct {
			Function struct {
				Arguments string `json:"arguments"`
			} `json:"function"`
		}
		if err := json.Unmarshal(raw, &calls); err != nil {
			t.Fatalf("tool_calls: %v raw=%s", err, raw)
		}
		for _, call := range calls {
			args.WriteString(call.Function.Arguments)
		}
	}
	if !sawToolCalls {
		t.Fatalf("response missing tool_calls: %s", rec.Body.String())
	}
	want := chatToolArgHead + chatToolArgTail
	if args.String() != want {
		t.Fatalf("arguments = %q, want %q", args.String(), want)
	}
}
