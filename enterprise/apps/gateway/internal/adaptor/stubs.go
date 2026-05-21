package adaptor

import (
	"context"
	"fmt"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

type stubAdaptor struct {
	name string
}

func NewClaudeAdaptor() Adaptor { return &stubAdaptor{name: "claude"} }
func NewGeminiAdaptor() Adaptor { return &stubAdaptor{name: "gemini"} }

func (s *stubAdaptor) Name() string { return s.name }

func (s *stubAdaptor) Complete(_ context.Context, _ openai.ChatCompletionRequest, _ channel.Channel) (openai.ChatCompletionResponse, error) {
	return openai.ChatCompletionResponse{}, fmt.Errorf("%s: not_implemented", s.name)
}

func (s *stubAdaptor) Stream(_ context.Context, _ openai.ChatCompletionRequest, _ channel.Channel, _ StreamPush) error {
	return fmt.Errorf("%s: not_implemented", s.name)
}

func (s *stubAdaptor) Embeddings(_ context.Context, _ openai.EmbeddingRequest, _ channel.Channel) (openai.EmbeddingResponse, error) {
	return openai.EmbeddingResponse{}, fmt.Errorf("%s: not_implemented", s.name)
}
