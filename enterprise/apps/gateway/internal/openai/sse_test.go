package openai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/streamio"
)

func TestCommonStreamTermination(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		incomplete bool
	}{
		{"done", "data: [DONE]\n\n", false},
		{"finish", "data: {\"choices\":[{\"finish_reason\":\"stop\",\"delta\":{}}]}\n\n", false},
		{"partial", "data: {\"choices\":[{\"delta\":{\"content\":\"prefix\"}}]}\n\n", true},
		{"empty", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ReadSSE(context.Background(), strings.NewReader(tc.body), streamio.Config{}, func(StreamChunk) error { return nil })
			if errors.Is(err, ErrIncompleteStream) != tc.incomplete || (!tc.incomplete && err != nil) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestStreamPreservesToolAndUsagePivot(t *testing.T) {
	const tool = `[{"index":0,"id":"call-1","type":"function","function":{"name":"optional","arguments":"{\"x\":"}}]`
	body := "data: {\"choices\":[{\"delta\":{\"tool_calls\":" + tool + "}}]}\n\ndata: {\"usage\":{\"total_tokens\":9}}\n\ndata: [DONE]\n\n"
	var chunks []StreamChunk
	err := ReadSSE(context.Background(), strings.NewReader(body), streamio.Config{}, func(c StreamChunk) error { chunks = append(chunks, c); return nil })
	if err != nil || len(chunks) != 2 {
		t.Fatalf("chunks=%+v err=%v", chunks, err)
	}
	if string(chunks[0].Choices[0].Delta.ToolCalls) != tool || chunks[1].Usage == nil || chunks[1].Usage.TotalTokens != 9 {
		t.Fatalf("lost pivot fields: %+v", chunks)
	}
	raw, err := json.Marshal(chunks[0])
	if err != nil || !strings.Contains(string(raw), `"tool_calls"`) {
		t.Fatalf("raw=%s err=%v", raw, err)
	}
}

func TestStreamCallbackFailurePropagates(t *testing.T) {
	want := errors.New("downstream closed")
	err := ReadSSE(context.Background(), strings.NewReader("data: {\"id\":\"first\"}\n\ndata: [DONE]\n\n"), streamio.Config{}, func(StreamChunk) error { return want })
	if !errors.Is(err, want) {
		t.Fatalf("got %v", err)
	}
}
