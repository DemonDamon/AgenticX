package metering

import "github.com/agenticx/enterprise/gateway/internal/openai"

// NormalizedUsage is the canonical usage shape for billing and reporting.
type NormalizedUsage struct {
	PromptTokens             int
	CompletionTokens         int
	TotalTokens              int
	CachedTokens             int
	CacheCreationInputTokens int
	CacheReadInputTokens     int
	ReasoningTokens          int
	Source                   string
}

func NormalizeUsage(usage openai.Usage) NormalizedUsage {
	n := NormalizedUsage{
		PromptTokens:             usage.PromptTokens,
		CompletionTokens:         usage.CompletionTokens,
		TotalTokens:              usage.TotalTokens,
		CachedTokens:             usage.CachedTokens,
		CacheCreationInputTokens: usage.CacheCreationInputTokens,
		CacheReadInputTokens:     usage.CacheReadInputTokens,
		ReasoningTokens:          usage.ReasoningTokens,
		Source:                   usage.Source,
	}
	if usage.PromptTokensDetails != nil && usage.PromptTokensDetails.CachedTokens > 0 {
		n.CachedTokens = usage.PromptTokensDetails.CachedTokens
	}
	if n.TotalTokens == 0 {
		n.TotalTokens = n.PromptTokens + n.CompletionTokens
	}
	return n
}

// NormalizeOpenAI maps OpenAI-compatible usage JSON into canonical fields.
func NormalizeOpenAI(raw map[string]any) openai.Usage {
	usage := openai.Usage{}
	if v, ok := asInt(raw["prompt_tokens"]); ok {
		usage.PromptTokens = v
	}
	if v, ok := asInt(raw["completion_tokens"]); ok {
		usage.CompletionTokens = v
	}
	if v, ok := asInt(raw["total_tokens"]); ok {
		usage.TotalTokens = v
	}
	if details, ok := raw["prompt_tokens_details"].(map[string]any); ok {
		if v, ok := asInt(details["cached_tokens"]); ok {
			usage.CachedTokens = v
			usage.PromptTokensDetails = &openai.PromptTokensDetails{CachedTokens: v}
		}
	}
	if v, ok := asInt(raw["reasoning_tokens"]); ok {
		usage.ReasoningTokens = v
	}
	return usage
}

// NormalizeAnthropic maps Claude usage fields.
func NormalizeAnthropic(raw map[string]any) openai.Usage {
	usage := openai.Usage{}
	if v, ok := asInt(raw["input_tokens"]); ok {
		usage.PromptTokens = v
	}
	if v, ok := asInt(raw["output_tokens"]); ok {
		usage.CompletionTokens = v
	}
	if v, ok := asInt(raw["cache_creation_input_tokens"]); ok {
		usage.CacheCreationInputTokens = v
	}
	if v, ok := asInt(raw["cache_read_input_tokens"]); ok {
		usage.CacheReadInputTokens = v
	}
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return usage
}

// NormalizeDeepSeek maps DeepSeek prompt cache hit tokens.
func NormalizeDeepSeek(raw map[string]any) openai.Usage {
	usage := NormalizeOpenAI(raw)
	if v, ok := asInt(raw["prompt_cache_hit_tokens"]); ok {
		usage.CachedTokens = v
	}
	return usage
}

// NormalizeGemini maps Gemini cachedContentTokenCount.
func NormalizeGemini(raw map[string]any) openai.Usage {
	usage := openai.Usage{}
	if v, ok := asInt(raw["promptTokenCount"]); ok {
		usage.PromptTokens = v
	}
	if v, ok := asInt(raw["candidatesTokenCount"]); ok {
		usage.CompletionTokens = v
	}
	if v, ok := asInt(raw["cachedContentTokenCount"]); ok {
		usage.CachedTokens = v
	}
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return usage
}

func asInt(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, true
	case int64:
		return int(v), true
	case float64:
		return int(v), true
	default:
		return 0, false
	}
}
