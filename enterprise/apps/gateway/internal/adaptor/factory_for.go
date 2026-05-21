package adaptor

import (
	"fmt"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/channel"
)

func (f *Factory) For(ch channel.Channel) (Adaptor, error) {
	if f == nil {
		return nil, fmt.Errorf("adaptor factory nil")
	}
	switch strings.ToLower(strings.TrimSpace(ch.ProviderType)) {
	case "", "openai", "openai-compatible":
		return f.openai, nil
	case "claude", "anthropic":
		return f.claude, nil
	case "gemini", "google":
		return f.gemini, nil
	default:
		return f.openai, nil
	}
}
