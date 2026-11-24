package openai

import (
	"encoding/json"
	"testing"
)

func TestHasContentDeltaUsesSemanticFieldsWithoutAllocating(t *testing.T) {
	for _, tc := range []struct {
		name  string
		delta StreamDelta
		want  bool
	}{
		{"empty", StreamDelta{}, false}, {"role", StreamDelta{Role: "assistant"}, false},
		{"text", StreamDelta{Content: " "}, true}, {"reasoning", StreamDelta{ReasoningContent: "thought"}, true},
		{"empty_tools", StreamDelta{ToolCalls: json.RawMessage(" [ ] ")}, false},
		{"null_tools", StreamDelta{ToolCalls: json.RawMessage("null")}, false},
		{"tool", StreamDelta{ToolCalls: json.RawMessage(`[{"index":0}]`)}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			chunk := StreamChunk{Choices: []StreamChoice{{Delta: tc.delta}}}
			if got := chunk.HasContentDelta(); got != tc.want {
				t.Fatalf("got=%v", got)
			}
			if allocs := testing.AllocsPerRun(1000, func() {
				if chunk.HasContentDelta() != tc.want {
					panic("predicate changed")
				}
			}); allocs != 0 {
				t.Fatalf("allocations=%v", allocs)
			}
		})
	}
}
