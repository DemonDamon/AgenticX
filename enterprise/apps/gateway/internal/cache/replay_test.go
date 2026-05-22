package cache

import (
	"net/http/httptest"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestReplayStreamBurst(t *testing.T) {
	entry := Entry{
		Stream: true,
		StreamChunks: []openai.StreamChunk{{
			Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "hello"}}},
		}},
	}
	rec := httptest.NewRecorder()
	if err := ReplayStream(rec, entry, ReplayBurst); err != nil {
		t.Fatalf("replay failed: %v", err)
	}
	body := rec.Body.String()
	if body == "" {
		t.Fatalf("expected sse body")
	}
}
