package openai

import "strings"

// CompatibleRequest applies the wire contract shared by direct providers and
// channel adaptors. Some chat templates accept only one system message, and it
// must be the first message.
func CompatibleRequest(req ChatCompletionRequest) ChatCompletionRequest {
	req.Messages = consolidateSystemMessages(req.Messages)
	parts := strings.Split(strings.ToLower(strings.TrimSpace(req.Model)), "/")
	switch parts[len(parts)-1] {
	case "kimi-k2.6", "kimi-k2.7-code":
		// omitempty drops zero, which these templates reject when sent explicitly.
		req.Temperature = 0
		req.TopP = 0
	}
	return req
}

func consolidateSystemMessages(messages []ChatMessage) []ChatMessage {
	var system *ChatMessage
	var instructions []string
	conversation := make([]ChatMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role != "system" {
			conversation = append(conversation, message)
			continue
		}
		if system == nil {
			firstSystem := message
			system = &firstSystem
		}
		if text := ContentText(message.Content); text != "" {
			instructions = append(instructions, text)
		}
	}
	if system == nil {
		return messages
	}
	if len(conversation) == len(messages)-1 {
		return append([]ChatMessage{*system}, conversation...)
	}
	system.Content = NewStringContent(strings.Join(instructions, "\n\n"))
	return append([]ChatMessage{*system}, conversation...)
}
