package provider

import (
	"context"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

// ChatProvider 抽象 OpenAI 兼容的聊天补全调用，支持非流式与 SSE 流式两种模式。
type ChatProvider interface {
	Complete(ctx context.Context, req openai.ChatCompletionRequest, decision routing.Decision) (openai.ChatCompletionResponse, error)
	Stream(ctx context.Context, req openai.ChatCompletionRequest, decision routing.Decision, push func(openai.StreamChunk) error) error
	Embeddings(ctx context.Context, req openai.EmbeddingRequest, decision routing.Decision) (openai.EmbeddingResponse, error)
}

// NewOpenAICompatibleProvider 构造默认 provider：
//
//   - 当路由 Decision 携带 Endpoint 且环境变量解析出 API Key 时，向上游真实调用；
//   - 否则回退到本地 mock，保证未配置 Key 的开发环境也能完成端到端联调。
//
// 这样 admin/portal 不需要改动配置，只需在网关进程上设置 `<PROVIDER>_API_KEY` 即可切换为真实模型。
func NewOpenAICompatibleProvider(opts ...Option) *OpenAICompatibleProvider {
	return newOpenAIHTTPProvider(opts...)
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
