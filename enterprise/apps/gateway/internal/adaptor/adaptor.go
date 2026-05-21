package adaptor

import (
	"context"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// StreamPush 流式 chunk 回调。
type StreamPush func(openai.StreamChunk) error

// Adaptor 协议边界：OpenAI 兼容为首个实现；Claude/Gemini 占位。
type Adaptor interface {
	Name() string
	Complete(ctx context.Context, req openai.ChatCompletionRequest, ch channel.Channel) (openai.ChatCompletionResponse, error)
	Stream(ctx context.Context, req openai.ChatCompletionRequest, ch channel.Channel, push StreamPush) error
	Embeddings(ctx context.Context, req openai.EmbeddingRequest, ch channel.Channel) (openai.EmbeddingResponse, error)
}
