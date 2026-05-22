package metering

import "testing"

func TestNormalizeOpenAICachedTokens(t *testing.T) {
	usage := NormalizeOpenAI(map[string]any{
		"prompt_tokens":     100,
		"completion_tokens": 20,
		"total_tokens":      120,
		"prompt_tokens_details": map[string]any{
			"cached_tokens": 40,
		},
	})
	if usage.CachedTokens != 40 {
		t.Fatalf("expected cached_tokens=40, got %d", usage.CachedTokens)
	}
}

func TestNormalizeAnthropicCacheFields(t *testing.T) {
	usage := NormalizeAnthropic(map[string]any{
		"input_tokens":               100,
		"output_tokens":              20,
		"cache_creation_input_tokens": 50,
		"cache_read_input_tokens":     30,
	})
	if usage.CacheCreationInputTokens != 50 || usage.CacheReadInputTokens != 30 {
		t.Fatalf("unexpected anthropic cache fields: %+v", usage)
	}
}

func TestPricingCacheCost(t *testing.T) {
	table := &PricingTable{
		models: map[string]ModelPricing{
			"gpt-4o": {Input: 1, Output: 2, CachedInput: 0.1},
		},
		defaultP: ModelPricing{Input: 1, Output: 2, CachedInput: 0.1},
	}
	usage := NormalizeOpenAI(map[string]any{
		"prompt_tokens":     100,
		"completion_tokens": 10,
		"prompt_tokens_details": map[string]any{"cached_tokens": 60},
	})
	cost := table.ComputeCostUSD("gpt-4o", usage)
	// regular input 40 *1 + cached 60 *0.1 + output 10*2 = 40+6+20=66
	if cost < 65.9 || cost > 66.1 {
		t.Fatalf("unexpected cost %v", cost)
	}
}
