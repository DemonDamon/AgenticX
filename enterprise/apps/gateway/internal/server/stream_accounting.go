package server

import (
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"strings"
	"unicode/utf8"
)

// streamAccounting retains only cumulative usage and a constant-size character
// counter. Tool-only and separate reasoning output still represent consumed work.
type streamAccounting struct {
	reported    *openai.Usage
	outputRunes int
}

func (a *streamAccounting) observe(chunk openai.StreamChunk) {
	if chunk.Usage != nil {
		copy := *chunk.Usage
		a.reported = &copy
	}
	for _, choice := range chunk.Choices {
		d := choice.Delta
		a.outputRunes += utf8.RuneCountInString(d.Content) + utf8.RuneCountInString(d.ReasoningContent)
		raw := strings.TrimSpace(string(d.ToolCalls))
		if raw != "" && raw != "null" && raw != "[]" {
			a.outputRunes += utf8.RuneCountInString(raw)
		}
	}
}
func (a *streamAccounting) usage(input int, interrupted bool) openai.Usage {
	// Some upstreams attach an all-zero placeholder before final usage. It must
	// not erase observed output when a stream stops before that final report.
	if a.reported != nil && (a.reported.TotalTokens > 0 || a.reported.PromptTokens > 0 || a.reported.CompletionTokens > 0) {
		usage := *a.reported
		if usage.TotalTokens <= 0 {
			usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
		}
		return usage
	}
	if interrupted && a.outputRunes == 0 {
		return openai.Usage{}
	}
	output := (a.outputRunes + 2) / 3
	return openai.Usage{PromptTokens: input, CompletionTokens: output, TotalTokens: input + output}
}
