package server

import (
	"encoding/json"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestZeroUsagePlaceholderCannotEraseObservedOutput(t *testing.T) {
	for name, delta := range map[string]openai.StreamDelta{
		"text":      {Content: "visible prefix"},
		"reasoning": {ReasoningContent: "reasoning prefix"},
		"tool":      {ToolCalls: json.RawMessage(`[{"index":0,"function":{"arguments":"{"}}]`)},
	} {
		t.Run(name, func(t *testing.T) {
			var a streamAccounting
			a.observe(openai.StreamChunk{Usage: &openai.Usage{}})
			a.observe(openai.StreamChunk{Choices: []openai.StreamChoice{{Delta: delta}}})
			got := a.usage(7, true)
			if got.CompletionTokens <= 0 || got.PromptTokens != 7 || got.TotalTokens <= 7 {
				t.Fatalf("zero placeholder erased observed output: %+v", got)
			}
		})
	}
}

func TestReportedUsageStillWinsAndEmptyCancellationRefunds(t *testing.T) {
	var a streamAccounting
	a.observe(openai.StreamChunk{Usage: &openai.Usage{}})
	if got := a.usage(7, true); got.TotalTokens != 0 {
		t.Fatalf("empty cancellation charged: %+v", got)
	}
	a.observe(openai.StreamChunk{Usage: &openai.Usage{PromptTokens: 3, CompletionTokens: 2, TotalTokens: 5}})
	if got := a.usage(7, true); got.TotalTokens != 5 || got.PromptTokens != 3 || got.CompletionTokens != 2 {
		t.Fatalf("reported usage changed: %+v", got)
	}
}
