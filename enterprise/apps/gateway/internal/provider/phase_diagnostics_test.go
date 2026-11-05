package provider

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func TestDirectProviderPhaseEvidenceAndFailedPush(t *testing.T) {
	for _, failPush := range []bool{false, true} {
		t.Run(map[bool]string{false: "content", true: "failed_push"}[failPush], func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"private-body\"}}]}\n\ndata: [DONE]\n\n")
			}))
			defer server.Close()
			ctx, phases := observability.NewPhaseSampler(1, nil, nil).Start(context.Background())
			provider := NewOpenAICompatibleProvider(WithKeyResolver(func(string) string { return "sk-synthetic" }))
			err := provider.Stream(ctx, openai.ChatCompletionRequest{Model: "m"}, routing.Decision{Endpoint: server.URL}, func(openai.StreamChunk) error {
				if failPush {
					return errors.New("network error sk-fake-secret")
				}
				return nil
			})
			snapshot := phases.Snapshot()
			if (err != nil) != failPush || calls.Load() != 1 {
				t.Fatalf("err=%v calls=%d", err, calls.Load())
			}
			if snapshot.ResponseHeadersMS < 0 || snapshot.FirstBodyByteMS < snapshot.ResponseHeadersMS || (snapshot.FirstContentMS >= 0) == failPush {
				t.Fatalf("snapshot=%+v", snapshot)
			}
			if failPush && snapshot.Reason != observability.ReasonDownstreamError {
				t.Fatalf("reason=%s", snapshot.Reason)
			}
		})
	}
}
