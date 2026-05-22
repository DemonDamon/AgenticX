package transform_test

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/transform"
)

func TestResolveModelOpenAIEffort(t *testing.T) {
	cases := []struct {
		in       string
		wantModel string
		wantEffort string
	}{
		{"gpt-5-high", "gpt-5", "high"},
		{"o3-mini-low", "o3-mini", "low"},
		{"deepseek-chat", "deepseek-chat", ""},
	}
	for _, tc := range cases {
		got := transform.ResolveModel(tc.in)
		if got.UpstreamModel != tc.wantModel || got.ReasoningEffort != tc.wantEffort {
			t.Fatalf("%s => %+v, want model=%s effort=%s", tc.in, got, tc.wantModel, tc.wantEffort)
		}
	}
}

func TestResolveModelGeminiThinking(t *testing.T) {
	got := transform.ResolveModel("gemini-2.5-flash-thinking-128")
	if got.UpstreamModel != "gemini-2.5-flash" || !got.ThinkingEnabled || got.ThinkingBudget != 128 {
		t.Fatalf("unexpected %+v", got)
	}
	got = transform.ResolveModel("gemini-2.5-pro-low")
	if got.UpstreamModel != "gemini-2.5-pro" || got.ThinkingBudget != 2048 {
		t.Fatalf("unexpected %+v", got)
	}
}

func TestResolveModelClaudeThinking(t *testing.T) {
	got := transform.ResolveModel("claude-3-7-sonnet-thinking")
	if !got.ThinkingEnabled || got.ThinkingBudget != 8192 {
		t.Fatalf("unexpected %+v", got)
	}
}

func TestOpenAIToolsRoundTrip(t *testing.T) {
	tools := []openai.Tool{{
		Type: "function",
		Function: &openai.ToolFunction{
			Name:        "get_weather",
			Description: "Get weather",
			Parameters:  map[string]any{"type": "object"},
		},
	}}
	claude := transform.OpenAIToolsToClaude(tools)
	back := transform.ClaudeToolsToOpenAI(claude)
	if len(back) != 1 || back[0].Function.Name != "get_weather" {
		t.Fatalf("round trip failed: %+v", back)
	}
}

func TestOpenAIToGeminiTools(t *testing.T) {
	tools := []openai.Tool{{
		Type: "function",
		Function: &openai.ToolFunction{Name: "search", Description: "search docs"},
	}}
	gemini := transform.OpenAIToolsToGemini(tools)
	if len(gemini) != 1 || gemini[0].Name != "search" {
		t.Fatalf("unexpected %+v", gemini)
	}
}

func TestGeminiToolsToOpenAI(t *testing.T) {
	decls := []transform.GeminiFunctionDeclaration{{Name: "calc", Description: "calc"}}
	out := transform.GeminiToolsToOpenAI(decls)
	if len(out) != 1 || out[0].Function.Name != "calc" {
		t.Fatalf("unexpected %+v", out)
	}
}

func TestThinkingSeparatePreservesReasoning(t *testing.T) {
	chunk := openai.StreamChunk{
		Choices: []openai.StreamChoice{{
			Delta: openai.StreamDelta{ReasoningContent: "think", Content: "answer"},
		}},
	}
	transform.ApplyStreamDelta(&chunk, transform.ThinkingSeparate)
	if chunk.Choices[0].Delta.ReasoningContent != "think" {
		t.Fatalf("expected reasoning preserved")
	}
}

func TestThinkingMergeWrapsReasoning(t *testing.T) {
	chunk := openai.StreamChunk{
		Choices: []openai.StreamChoice{{
			Delta: openai.StreamDelta{ReasoningContent: "think"},
		}},
	}
	transform.ApplyStreamDelta(&chunk, transform.ThinkingMerge)
	if chunk.Choices[0].Delta.ReasoningContent != "" {
		t.Fatalf("reasoning should be cleared")
	}
	if chunk.Choices[0].Delta.Content == "" {
		t.Fatalf("expected merged content")
	}
}
