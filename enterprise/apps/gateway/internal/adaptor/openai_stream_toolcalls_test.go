package adaptor

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

const (
	streamToolFrag1 = `[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":""}}]`
	streamToolFrag2 = `[{"index":0,"function":{"arguments":"{\"city\":"}}]`
	streamToolFrag3 = `[{"index":0,"function":{"arguments":"\"shanghai\"}"}}]`
)

func streamToolCallSSE() string {
	events := []string{
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"}}]}`,
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":` + streamToolFrag1 + `}}]}`,
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":` + streamToolFrag2 + `}}]}`,
		`{"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":` + streamToolFrag3 + `}}]}`,
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

func TestOpenAIStreamPassesToolCallDeltasVerbatim(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(streamToolCallSSE()))
	}))
	defer up.Close()

	var got []openai.StreamChunk
	err := NewOpenAIAdaptor().Stream(
		context.Background(),
		openai.ChatCompletionRequest{Model: "tool-model"},
		channel.Channel{ID: "ch-a", BaseURL: up.URL, APIKey: "k", ProviderType: "openai"},
		func(chunk openai.StreamChunk) error {
			got = append(got, chunk)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	if len(got) != 5 {
		t.Fatalf("chunk count = %d, want 5", len(got))
	}

	wantFrags := [][]byte{nil, []byte(streamToolFrag1), []byte(streamToolFrag2), []byte(streamToolFrag3), nil}
	for i, want := range wantFrags {
		gotRaw := got[i].Choices[0].Delta.ToolCalls
		if len(want) == 0 {
			if len(gotRaw) != 0 {
				t.Fatalf("chunk %d tool_calls = %s, want empty", i, gotRaw)
			}
			continue
		}
		if !bytes.Equal(gotRaw, want) {
			t.Fatalf("chunk %d tool_calls = %s, want %s", i, gotRaw, want)
		}
	}
	finish := got[len(got)-1].Choices[0].FinishReason
	if finish == nil || *finish != "tool_calls" {
		t.Fatalf("finish_reason = %v, want tool_calls", finish)
	}
}
