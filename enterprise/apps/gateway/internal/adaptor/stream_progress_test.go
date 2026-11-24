package adaptor

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestAdapterSlowWireFragmentsRemainActive(t *testing.T) {
	const payload = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{}\"}}]}}]}\n\ndata: {\"usage\":{\"total_tokens\":3}}\n\ndata: [DONE]\n\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		for i := 0; i < len(payload); i += 4 {
			end := i + 4
			if end > len(payload) {
				end = len(payload)
			}
			if _, err := io.WriteString(w, payload[i:end]); err != nil {
				return
			}
			w.(http.Flusher).Flush()
			select {
			case <-r.Context().Done():
				return
			case <-time.After(15 * time.Millisecond):
			}
		}
	}))
	defer server.Close()
	ad := NewOpenAIAdaptor(WithStreamConfig(StreamConfig{IdleTimeout: 150 * time.Millisecond, HeaderTimeout: time.Second}))
	var chunks []openai.StreamChunk
	err := ad.Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, channel.Channel{BaseURL: server.URL, APIKey: "synthetic"}, func(c openai.StreamChunk) error { chunks = append(chunks, c); return nil })
	if err != nil || len(chunks) != 2 {
		t.Fatalf("chunks=%+v err=%v", chunks, err)
	}
	if !strings.Contains(string(chunks[0].Choices[0].Delta.ToolCalls), "arguments") || chunks[1].Usage.TotalTokens != 3 {
		t.Fatalf("lost stream fields: %+v", chunks)
	}
}

func TestAdapterMissingTerminalIsIncomplete(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "data: {\"id\":\"partial\"}\n\n")
	}))
	defer server.Close()
	err := NewOpenAIAdaptor().Stream(context.Background(), openai.ChatCompletionRequest{Model: "m"}, channel.Channel{BaseURL: server.URL, APIKey: "synthetic"}, func(openai.StreamChunk) error { return nil })
	if !errors.Is(err, openai.ErrIncompleteStream) {
		t.Fatalf("got %v", err)
	}
}
