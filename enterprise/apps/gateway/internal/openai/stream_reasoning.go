package openai

import "strings"

const redactedThinkingCloseTag = "</think>"

const redactedOpen = "<think>"

var (
	thinkOpenTag  = "<" + "think" + ">"
	thinkCloseTag = "<" + "/" + "think" + ">"
)

// NormalizeThinkTags maps vendor-specific inline thinking markers to Machi-style tags.
func NormalizeThinkTags(text string) string {
	if text == "" {
		return text
	}
	text = strings.ReplaceAll(text, thinkOpenTag, redactedOpen)
	text = strings.ReplaceAll(text, thinkCloseTag, redactedThinkingCloseTag)
	return text
}

// StreamReasoningState merges reasoning_content and content deltas for reasoning models.
type StreamReasoningState struct {
	separateReasoningOpen bool
}

// cleanSeparateReasoningDelta removes inline markers from a field that is already
// semantically identified as reasoning_content. Some OpenAI-compatible providers
// include a closing marker in every reasoning delta; forwarding those markers
// creates dozens of orphan </think> tags in the visible answer.
func cleanSeparateReasoningDelta(reasoning string) string {
	reasoning = strings.ReplaceAll(reasoning, redactedOpen, "")
	reasoning = strings.ReplaceAll(reasoning, redactedThinkingCloseTag, "")
	return reasoning
}

// MergeDelta folds upstream reasoning/content fields into one client-visible content delta.
func (s *StreamReasoningState) MergeDelta(_ string, reasoning, content string) string {
	var merged strings.Builder
	reasoning = cleanSeparateReasoningDelta(reasoning)
	if reasoning != "" {
		if !s.separateReasoningOpen {
			merged.WriteString("<think>")
			s.separateReasoningOpen = true
		}
		merged.WriteString(reasoning)
	}
	if content != "" {
		if s.separateReasoningOpen {
			// When a provider emits both reasoning_content and an inline closing
			// marker, our canonical close below owns the boundary. Removing only
			// markers here preserves the provider's visible answer text.
			content = strings.ReplaceAll(content, redactedOpen, "")
			content = strings.ReplaceAll(content, redactedThinkingCloseTag, "")
			merged.WriteString("</think>\n")
			s.separateReasoningOpen = false
		}
		merged.WriteString(content)
	}
	return merged.String()
}

// CloseOpenReasoning returns a trailing think close tag when stream ends mid-reasoning.
func (s *StreamReasoningState) CloseOpenReasoning() string {
	if !s.separateReasoningOpen {
		return ""
	}
	s.separateReasoningOpen = false
	return "</think>"
}

// ComposeMessageContent merges non-stream assistant message fields for downstream clients.
func ComposeMessageContent(content, reasoning string) string {
	content = NormalizeThinkTags(strings.TrimSpace(content))
	reasoning = strings.TrimSpace(reasoning)
	if reasoning == "" {
		return content
	}
	if content == "" {
		return "<think>" + reasoning + "</think>"
	}
	if strings.Contains(content, "<think>") {
		return content + reasoning
	}
	return "<think>" + reasoning + "</think>\n" + content
}
