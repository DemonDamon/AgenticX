package outbound

import (
	"encoding/json"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

const ProtocolGemini = "gemini-generate"

// GeminiStreamEncoder emits Gemini-style SSE data lines.
type GeminiStreamEncoder struct {
	model string
}

func NewGeminiStreamEncoder(model string) *GeminiStreamEncoder {
	return &GeminiStreamEncoder{model: model}
}

func (e *GeminiStreamEncoder) EncodeChunk(chunk openai.StreamChunk) [][]byte {
	if len(chunk.Choices) == 0 {
		return nil
	}
	delta := chunk.Choices[0].Delta
	text := strings.TrimSpace(delta.Content)
	if delta.ReasoningContent != "" {
		if text != "" {
			text = delta.ReasoningContent + text
		} else {
			text = delta.ReasoningContent
		}
	}
	if text == "" {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{
		"candidates": []map[string]any{
			{
				"content": map[string]any{
					"role":  "model",
					"parts": []map[string]any{{"text": text}},
				},
			},
		},
		"modelVersion": nonEmpty(chunk.Model, e.model),
	})
	return [][]byte{geminiSSE(payload)}
}

func (e *GeminiStreamEncoder) CompleteResponse(resp openai.ChatCompletionResponse) map[string]any {
	text := ""
	if len(resp.Choices) > 0 {
		msg := resp.Choices[0].Message
		text = openai.ComposeMessageContent(msg.Content, msg.ReasoningContent)
	}
	return map[string]any{
		"candidates": []map[string]any{
			{
				"content": map[string]any{
					"role":  "model",
					"parts": []map[string]any{{"text": text}},
				},
				"finishReason": "STOP",
			},
		},
		"usageMetadata": map[string]any{
			"promptTokenCount":     resp.Usage.PromptTokens,
			"candidatesTokenCount": resp.Usage.CompletionTokens,
			"totalTokenCount":      resp.Usage.TotalTokens,
		},
		"modelVersion": nonEmpty(resp.Model, e.model),
	}
}

func geminiSSE(payload []byte) []byte {
	return []byte("data: " + string(payload) + "\n\n")
}
