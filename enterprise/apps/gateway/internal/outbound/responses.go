package outbound

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

const ProtocolResponses = "openai-responses"

// ResponsesStreamEncoder emits OpenAI Responses SSE events (minimal set).
type ResponsesStreamEncoder struct {
	responseID string
	model      string
}

func NewResponsesStreamEncoder(model string) *ResponsesStreamEncoder {
	return &ResponsesStreamEncoder{
		responseID: fmt.Sprintf("resp_%d", time.Now().UnixNano()),
		model:      model,
	}
}

func (e *ResponsesStreamEncoder) Created() []byte {
	payload, _ := json.Marshal(map[string]any{
		"type":        "response.created",
		"response": map[string]any{
			"id":     e.responseID,
			"object": "response",
			"status": "in_progress",
			"model":  e.model,
		},
	})
	return responsesSSE(payload)
}

func (e *ResponsesStreamEncoder) EncodeChunk(chunk openai.StreamChunk) [][]byte {
	if len(chunk.Choices) == 0 {
		return nil
	}
	delta := chunk.Choices[0].Delta
	text := strings.TrimSpace(delta.Content)
	if delta.ReasoningContent != "" {
		text = delta.ReasoningContent + text
	}
	if text == "" {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{
		"type":  "response.output_text.delta",
		"delta": text,
	})
	return [][]byte{responsesSSE(payload)}
}

func (e *ResponsesStreamEncoder) Done(usage openai.Usage) []byte {
	payload, _ := json.Marshal(map[string]any{
		"type": "response.output_text.done",
	})
	_ = usage
	return responsesSSE(payload)
}

func (e *ResponsesStreamEncoder) Completed(text string, usage openai.Usage) map[string]any {
	return map[string]any{
		"id":     e.responseID,
		"object": "response",
		"status": "completed",
		"model":  e.model,
		"output": []map[string]any{
			{
				"type": "message",
				"role": "assistant",
				"content": []map[string]any{
					{"type": "output_text", "text": text},
				},
			},
		},
		"usage": map[string]any{
			"input_tokens":  usage.PromptTokens,
			"output_tokens": usage.CompletionTokens,
			"total_tokens":  usage.TotalTokens,
		},
	}
}

func responsesSSE(payload []byte) []byte {
	return []byte("data: " + string(payload) + "\n\n")
}
