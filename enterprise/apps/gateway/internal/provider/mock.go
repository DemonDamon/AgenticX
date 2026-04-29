package provider

import (
	"context"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

// MockProvider 在没有真实模型 Key 时提供占位响应，保证联调链路（鉴权 -> 策略 -> 审计 -> 计量）依然可走通。
type MockProvider struct{}

func NewMockProvider() *MockProvider { return &MockProvider{} }

func (p *MockProvider) Complete(
	_ context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
) (openai.ChatCompletionResponse, error) {
	content := "（开发模式 mock 回复，未配置真实模型 Key）来自 " + nonEmpty(decision.Provider, decision.Route)
	return openai.ChatCompletionResponse{
		ID:      "chatcmpl_mock_" + time.Now().Format("150405"),
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   nonEmpty(decision.Model, req.Model),
		Choices: []openai.ChatCompletionChoice{
			{
				Index: 0,
				Message: openai.ChatMessage{
					Role:    "assistant",
					Content: content,
				},
				FinishReason: "stop",
			},
		},
		Usage: openai.Usage{
			PromptTokens:     estimateTokens(req.Messages),
			CompletionTokens: 12,
			TotalTokens:      estimateTokens(req.Messages) + 12,
		},
	}, nil
}

func (p *MockProvider) Stream(
	_ context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
	push func(openai.StreamChunk) error,
) error {
	responseText := "（mock 流式）via " + nonEmpty(decision.Provider, decision.Route)
	parts := strings.Split(responseText, " ")
	for idx, part := range parts {
		chunk := openai.StreamChunk{
			ID:      "chatcmpl_stream_" + time.Now().Format("150405"),
			Object:  "chat.completion.chunk",
			Created: time.Now().Unix(),
			Model:   nonEmpty(decision.Model, req.Model),
			Choices: []openai.StreamChoice{
				{
					Index: 0,
					Delta: openai.StreamDelta{
						Content: part + " ",
					},
				},
			},
		}
		if idx == 0 {
			chunk.Choices[0].Delta.Role = "assistant"
		}
		if err := push(chunk); err != nil {
			return err
		}
	}
	stop := "stop"
	return push(openai.StreamChunk{
		ID:      "chatcmpl_stream_" + time.Now().Format("150405"),
		Object:  "chat.completion.chunk",
		Created: time.Now().Unix(),
		Model:   nonEmpty(decision.Model, req.Model),
		Choices: []openai.StreamChoice{
			{
				Index:        0,
				Delta:        openai.StreamDelta{},
				FinishReason: &stop,
			},
		},
	})
}
