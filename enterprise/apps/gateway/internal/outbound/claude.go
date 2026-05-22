package outbound

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

const ProtocolClaude = "claude-messages"

// ClaudeStreamEncoder converts pivot stream chunks to Anthropic SSE events.
type ClaudeStreamEncoder struct {
	messageID   string
	model       string
	started     bool
	blockOpen   bool
	blockIndex  int
	inputTokens int
	outputTokens int
}

func NewClaudeStreamEncoder(model string) *ClaudeStreamEncoder {
	return &ClaudeStreamEncoder{
		messageID: fmt.Sprintf("msg_%d", time.Now().UnixNano()),
		model:     model,
	}
}

func (e *ClaudeStreamEncoder) MessageStart() []byte {
	if e.started {
		return nil
	}
	e.started = true
	payload, _ := json.Marshal(map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id":    e.messageID,
			"type":  "message",
			"role":  "assistant",
			"model": e.model,
			"content": []any{},
			"usage": map[string]any{"input_tokens": 0, "output_tokens": 0},
		},
	})
	return claudeSSE("message_start", payload)
}

func (e *ClaudeStreamEncoder) EncodeChunk(chunk openai.StreamChunk) [][]byte {
	var out [][]byte
	if !e.started {
		out = append(out, e.MessageStart())
	}
	if len(chunk.Choices) == 0 {
		return out
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
		return out
	}
	if !e.blockOpen {
		e.blockOpen = true
		startPayload, _ := json.Marshal(map[string]any{
			"type":  "content_block_start",
			"index": e.blockIndex,
			"content_block": map[string]any{
				"type": "text",
				"text": "",
			},
		})
		out = append(out, claudeSSE("content_block_start", startPayload))
	}
	deltaPayload, _ := json.Marshal(map[string]any{
		"type":  "content_block_delta",
		"index": e.blockIndex,
		"delta": map[string]any{
			"type": "text_delta",
			"text": text,
		},
	})
	out = append(out, claudeSSE("content_block_delta", deltaPayload))
	e.outputTokens += len([]rune(text)) / 4
	if e.outputTokens == 0 {
		e.outputTokens = 1
	}
	return out
}

func (e *ClaudeStreamEncoder) Final(usage openai.Usage) [][]byte {
	var out [][]byte
	if !e.started {
		out = append(out, e.MessageStart())
	}
	if e.blockOpen {
		stopPayload, _ := json.Marshal(map[string]any{
			"type":  "content_block_stop",
			"index": e.blockIndex,
		})
		out = append(out, claudeSSE("content_block_stop", stopPayload))
		e.blockOpen = false
	}
	inTok := usage.PromptTokens
	outTok := usage.CompletionTokens
	if inTok == 0 {
		inTok = e.inputTokens
	}
	if outTok == 0 {
		outTok = e.outputTokens
	}
	deltaPayload, _ := json.Marshal(map[string]any{
		"type": "message_delta",
		"delta": map[string]any{
			"stop_reason":   "end_turn",
			"stop_sequence": nil,
		},
		"usage": map[string]any{"output_tokens": outTok},
	})
	out = append(out, claudeSSE("message_delta", deltaPayload))
	stopPayload, _ := json.Marshal(map[string]any{
		"type": "message_stop",
	})
	out = append(out, claudeSSE("message_stop", stopPayload))
	return out
}

func (e *ClaudeStreamEncoder) CompleteResponse(resp openai.ChatCompletionResponse) map[string]any {
	text := ""
	if len(resp.Choices) > 0 {
		msg := resp.Choices[0].Message
		text = openai.ComposeMessageContent(msg.Content, msg.ReasoningContent)
	}
	return map[string]any{
		"id":    nonEmpty(resp.ID, e.messageID),
		"type":  "message",
		"role":  "assistant",
		"model": nonEmpty(resp.Model, e.model),
		"content": []map[string]any{
			{"type": "text", "text": text},
		},
		"stop_reason": "end_turn",
		"usage": map[string]any{
			"input_tokens":  resp.Usage.PromptTokens,
			"output_tokens": resp.Usage.CompletionTokens,
		},
	}
}

func claudeSSE(event string, payload []byte) []byte {
	return []byte("event: " + event + "\ndata: " + string(payload) + "\n\n")
}

func nonEmpty(a, fallback string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return fallback
}
