package inbound

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

const ProtocolResponses = "openai-responses"

type responsesInputMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ResponsesRequest struct {
	Model        string          `json:"model"`
	Input        json.RawMessage `json:"input"`
	Instructions string          `json:"instructions,omitempty"`
	Tools        []openai.Tool   `json:"tools,omitempty"`
	Stream       bool            `json:"stream,omitempty"`
	MaxOutputTokens int          `json:"max_output_tokens,omitempty"`
}

// ParseResponses converts OpenAI Responses API request to pivot.
func ParseResponses(body io.Reader) (openai.ChatCompletionRequest, error) {
	var raw ResponsesRequest
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return openai.ChatCompletionRequest{}, fmt.Errorf("invalid responses json: %w", err)
	}
	if strings.TrimSpace(raw.Model) == "" {
		return openai.ChatCompletionRequest{}, fmt.Errorf("model is required")
	}
	req := openai.ChatCompletionRequest{
		Model:       raw.Model,
		Stream:      raw.Stream,
		System:      strings.TrimSpace(raw.Instructions),
		Tools:       raw.Tools,
		MaxTokens:   raw.MaxOutputTokens,
	}
	if len(raw.Input) == 0 {
		return openai.ChatCompletionRequest{}, fmt.Errorf("input is required")
	}
	var asString string
	if err := json.Unmarshal(raw.Input, &asString); err == nil {
		req.Messages = []openai.ChatMessage{{Role: "user", Content: asString}}
		return req, nil
	}
	var msgs []responsesInputMessage
	if err := json.Unmarshal(raw.Input, &msgs); err == nil {
		for _, m := range msgs {
			role := strings.ToLower(strings.TrimSpace(m.Role))
			if role != "assistant" && role != "system" {
				role = "user"
			}
			if role == "system" && req.System == "" {
				req.System = m.Content
				continue
			}
			req.Messages = append(req.Messages, openai.ChatMessage{Role: role, Content: m.Content})
		}
		if len(req.Messages) == 0 && req.System != "" {
			req.Messages = []openai.ChatMessage{{Role: "user", Content: req.System}}
		}
		if len(req.Messages) == 0 {
			return openai.ChatCompletionRequest{}, fmt.Errorf("input messages empty")
		}
		return req, nil
	}
	return openai.ChatCompletionRequest{}, fmt.Errorf("unsupported input format")
}
