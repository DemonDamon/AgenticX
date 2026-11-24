package relay

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestPhaseEvidenceCountsOnlySuccessfullyPushedContent(t *testing.T) {
	for _, tc := range []struct {
		name      string
		chunk     openai.StreamChunk
		content   bool
		pushError bool
	}{
		{"role", openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Role: "assistant"}}}}, false, false},
		{"usage", openai.StreamChunk{Usage: &openai.Usage{TotalTokens: 1}}, false, false},
		{"text", openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "synthetic body"}}}}, true, false},
		{"reasoning", openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{ReasoningContent: "synthetic thought"}}}}, true, false},
		{"tool", openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{ToolCalls: json.RawMessage(`[{"index":0}]`)}}}}, true, false},
		{"failed_push", openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: openai.StreamDelta{Content: "synthetic body"}}}}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, phases := observability.NewPhaseSampler(1, nil, nil).Start(context.Background())
			ad := &progressAdaptor{chunk: &tc.chunk}
			exec := progressExecutor(t, ad, true)
			_, err := exec.Stream(ctx, openai.ChatCompletionRequest{Model: "m"}, "m", channel.Identity{TenantID: "t", SessionID: "s"}, func(openai.StreamChunk) error {
				if tc.pushError {
					return errors.New("private-body-sk-fake")
				}
				return nil
			})
			if err == nil || ad.aCalls != 1 || ad.bCalls != 0 {
				t.Fatalf("a=%d b=%d err=%v", ad.aCalls, ad.bCalls, err)
			}
			snapshot := phases.Snapshot()
			if (snapshot.FirstContentMS >= 0) != tc.content {
				t.Fatalf("snapshot=%+v", snapshot)
			}
			if tc.pushError && snapshot.Reason != observability.ReasonDownstreamError {
				t.Fatalf("reason=%s", snapshot.Reason)
			}
		})
	}
}
