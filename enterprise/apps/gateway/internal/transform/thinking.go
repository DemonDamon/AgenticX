package transform

import (
	"os"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// ThinkingMode controls how reasoning/thinking text is exposed downstream.
type ThinkingMode string

const (
	ThinkingOff      ThinkingMode = "off"
	ThinkingSeparate ThinkingMode = "separate"
	ThinkingMerge    ThinkingMode = "merge"
)

func ThinkingModeFromEnv() ThinkingMode {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_RELAY_THINKING_TO_CONTENT")))
	if raw == "" {
		raw = strings.ToLower(strings.TrimSpace(os.Getenv("RELAY_THINKING_TO_CONTENT")))
	}
	switch ThinkingMode(raw) {
	case ThinkingSeparate, ThinkingMerge:
		return ThinkingMode(raw)
	default:
		return ThinkingOff
	}
}

// ApplyStreamDelta mutates chunk delta fields per thinking mode.
func ApplyStreamDelta(chunk *openai.StreamChunk, mode ThinkingMode) {
	if chunk == nil || len(chunk.Choices) == 0 || mode == ThinkingOff {
		return
	}
	delta := &chunk.Choices[0].Delta
	reasoning := strings.TrimSpace(delta.ReasoningContent)
	content := strings.TrimSpace(delta.Content)
	switch mode {
	case ThinkingSeparate:
		// keep reasoning_content separate; content unchanged
		return
	case ThinkingMerge:
		if reasoning != "" {
			wrapped := "<think>" + reasoning + "</think>"
			if content != "" {
				delta.Content = wrapped + content
			} else {
				delta.Content = wrapped
			}
			delta.ReasoningContent = ""
		}
	}
}
