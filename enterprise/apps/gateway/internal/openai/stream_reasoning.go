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

// MergeDelta folds upstream reasoning/content fields into one client-visible content delta.
func (s *StreamReasoningState) MergeDelta(accumulated, reasoning, content string) string {
	var merged strings.Builder
	if reasoning != "" {
		if strings.Contains(accumulated, redactedThinkingCloseTag) {
			merged.WriteString(reasoning)
		} else {
			if !s.separateReasoningOpen {
				merged.WriteString("<think>")
				s.separateReasoningOpen = true
			}
			merged.WriteString(reasoning)
		}
	}
	if content != "" {
		if s.separateReasoningOpen && !strings.Contains(content, redactedThinkingCloseTag) {
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
