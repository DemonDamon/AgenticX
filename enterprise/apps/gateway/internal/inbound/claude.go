package inbound

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/transform"
)

const ProtocolClaude = "claude-messages"

type claudeContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type claudeMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type ClaudeMessagesRequest struct {
	Model         string          `json:"model"`
	Messages      []claudeMessage `json:"messages"`
	System        json.RawMessage `json:"system,omitempty"`
	MaxTokens     int             `json:"max_tokens"`
	Temperature   *float64        `json:"temperature,omitempty"`
	TopP          *float64        `json:"top_p,omitempty"`
	TopK          *int            `json:"top_k,omitempty"`
	StopSequences []string        `json:"stop_sequences,omitempty"`
	Stream        bool            `json:"stream,omitempty"`
	Tools         []transform.ClaudeTool `json:"tools,omitempty"`
	ToolChoice    json.RawMessage `json:"tool_choice,omitempty"`
}

func ParseClaudeMessages(body io.Reader) (openai.ChatCompletionRequest, error) {
	var raw ClaudeMessagesRequest
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return openai.ChatCompletionRequest{}, fmt.Errorf("invalid claude json: %w", err)
	}
	if strings.TrimSpace(raw.Model) == "" {
		return openai.ChatCompletionRequest{}, fmt.Errorf("model is required")
	}
	if raw.MaxTokens <= 0 {
		raw.MaxTokens = 4096
	}

	req := openai.ChatCompletionRequest{
		Model:       raw.Model,
		Stream:      raw.Stream,
		MaxTokens:   raw.MaxTokens,
		Stop:        raw.StopSequences,
		Tools:       transform.ClaudeToolsToOpenAI(raw.Tools),
	}
	if raw.Temperature != nil {
		req.Temperature = *raw.Temperature
	}
	if raw.TopP != nil {
		req.TopP = *raw.TopP
	}
	if len(raw.System) > 0 {
		req.System = claudeSystemText(raw.System)
	}
	if len(raw.ToolChoice) > 0 {
		req.ToolChoice = json.RawMessage(raw.ToolChoice)
	}

	for _, msg := range raw.Messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		if role == "assistant" {
			role = "assistant"
		} else if role != "user" {
			role = "user"
		}
		text := claudeMessageText(msg.Content)
		req.Messages = append(req.Messages, openai.ChatMessage{Role: role, Content: text})
	}
	if len(req.Messages) == 0 {
		return openai.ChatCompletionRequest{}, fmt.Errorf("messages is required")
	}
	return req, nil
}

func claudeSystemText(raw json.RawMessage) string {
	raw = json.RawMessage(strings.TrimSpace(string(raw)))
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var blocks []claudeContentBlock
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var b strings.Builder
		for _, block := range blocks {
			if block.Type == "text" && block.Text != "" {
				b.WriteString(block.Text)
			}
		}
		return b.String()
	}
	return string(raw)
}

func claudeMessageText(raw json.RawMessage) string {
	raw = json.RawMessage(strings.TrimSpace(string(raw)))
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var blocks []claudeContentBlock
	if err := json.Unmarshal(raw, &blocks); err == nil {
		var b strings.Builder
		for _, block := range blocks {
			if block.Type == "text" && block.Text != "" {
				b.WriteString(block.Text)
			}
		}
		return b.String()
	}
	return string(raw)
}
