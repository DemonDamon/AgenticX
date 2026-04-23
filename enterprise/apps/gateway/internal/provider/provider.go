package provider

import (
	"context"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

type ChatProvider interface {
	Complete(ctx context.Context, req openai.ChatCompletionRequest, decision routing.Decision) (openai.ChatCompletionResponse, error)
	Stream(ctx context.Context, req openai.ChatCompletionRequest, decision routing.Decision, push func(openai.StreamChunk) error) error
}

type OpenAICompatibleProvider struct{}

func NewOpenAICompatibleProvider() *OpenAICompatibleProvider {
	return &OpenAICompatibleProvider{}
}

func (p *OpenAICompatibleProvider) Complete(
	_ context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
) (openai.ChatCompletionResponse, error) {
	// W3-T03: provider 抽象已准备就绪；当前先返回 mock，下一阶段可替换为真实 endpoint 调用。
	content := "mock completion from " + nonEmpty(decision.Provider, decision.Route)
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

func (p *OpenAICompatibleProvider) Stream(
	_ context.Context,
	req openai.ChatCompletionRequest,
	decision routing.Decision,
	push func(openai.StreamChunk) error,
) error {
	responseText := "mock streaming response via " + nonEmpty(decision.Provider, decision.Route)
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

func nonEmpty(a, fallback string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return fallback
}

func estimateTokens(messages []openai.ChatMessage) int {
	total := 0
	for _, msg := range messages {
		total += len(msg.Content) / 3
		if len(msg.Content)%3 != 0 {
			total += 1
		}
	}
	if total == 0 {
		return 1
	}
	return total
}
