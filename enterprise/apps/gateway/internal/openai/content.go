package openai

import (
	"encoding/json"
	"strings"
)

// ContentText extracts plain text from message content for policy scans and token estimates.
// Supports legacy string JSON and OpenAI multimodal arrays (text parts only).
func ContentText(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	if trimmed[0] == '"' {
		var text string
		if err := json.Unmarshal(raw, &text); err == nil {
			return text
		}
	}
	if trimmed[0] == '[' {
		var parts []struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ImageURL *struct {
				URL string `json:"url"`
			} `json:"image_url"`
		}
		if err := json.Unmarshal(raw, &parts); err == nil {
			texts := make([]string, 0, len(parts))
			for _, part := range parts {
				if part.Type == "text" && strings.TrimSpace(part.Text) != "" {
					texts = append(texts, part.Text)
				}
			}
			return strings.Join(texts, "\n")
		}
	}
	return trimmed
}

// NewStringContent marshals a plain-text message content field.
func NewStringContent(text string) json.RawMessage {
	b, _ := json.Marshal(text)
	return b
}

// ComposeMessageContentRaw merges assistant fields into a string content payload.
func ComposeMessageContentRaw(content json.RawMessage, reasoning string) json.RawMessage {
	return NewStringContent(ComposeMessageContent(ContentText(content), reasoning))
}
