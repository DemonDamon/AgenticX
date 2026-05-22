package metering

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"gopkg.in/yaml.v3"
)

// ModelPricing holds per-token unit prices in USD.
type ModelPricing struct {
	Input          float64 `yaml:"input"`
	Output         float64 `yaml:"output"`
	CachedInput    float64 `yaml:"cached_input"`
	CacheCreation  float64 `yaml:"cache_creation"`
	CacheRead      float64 `yaml:"cache_read"`
	ReasoningOutput float64 `yaml:"reasoning_output"`
}

type pricingFile struct {
	Models map[string]ModelPricing `yaml:"models"`
	Default ModelPricing           `yaml:"default"`
}

// PricingTable resolves model-specific token prices with cache-aware fallbacks.
type PricingTable struct {
	mu      sync.RWMutex
	models  map[string]ModelPricing
	defaultP ModelPricing
}

func LoadPricingTable(path string) (*PricingTable, error) {
	table := &PricingTable{models: make(map[string]ModelPricing)}
	if path == "" {
		path = DefaultPricingPath()
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			table.defaultP = ModelPricing{Input: 0.000001, Output: 0.000002}
			return table, nil
		}
		return nil, err
	}
	var parsed pricingFile
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	table.models = parsed.Models
	table.defaultP = parsed.Default
	if table.defaultP.Input == 0 {
		table.defaultP.Input = 0.000001
	}
	if table.defaultP.Output == 0 {
		table.defaultP.Output = 0.000002
	}
	return table, nil
}

func DefaultPricingPath() string {
	if v := os.Getenv("GATEWAY_PRICING_FILE"); v != "" {
		return v
	}
	return filepath.Join("internal", "metering", "pricing.yaml")
}

func (t *PricingTable) ForModel(model string) ModelPricing {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if p, ok := t.models[model]; ok {
		return normalizePricing(p, t.defaultP)
	}
	return normalizePricing(t.defaultP, t.defaultP)
}

func normalizePricing(p, fallback ModelPricing) ModelPricing {
	if p.Input == 0 {
		p.Input = fallback.Input
	}
	if p.Output == 0 {
		p.Output = fallback.Output
	}
	if p.CachedInput == 0 {
		p.CachedInput = p.Input * 0.1
	}
	if p.CacheCreation == 0 {
		p.CacheCreation = p.Input
	}
	if p.CacheRead == 0 {
		p.CacheRead = p.CachedInput
	}
	if p.ReasoningOutput == 0 {
		p.ReasoningOutput = p.Output
	}
	return p
}

// ComputeCostUSD calculates multi-dimensional cache-aware cost.
func (t *PricingTable) ComputeCostUSD(model string, usage openai.Usage) float64 {
	p := t.ForModel(model)
	n := NormalizeUsage(usage)
	regularInput := n.PromptTokens - n.CachedTokens - n.CacheReadInputTokens
	if regularInput < 0 {
		regularInput = 0
	}
	cost := float64(regularInput)*p.Input +
		float64(n.CachedTokens)*p.CachedInput +
		float64(n.CacheCreationInputTokens)*p.CacheCreation +
		float64(n.CacheReadInputTokens)*p.CacheRead +
		float64(n.CompletionTokens)*p.Output +
		float64(n.ReasoningTokens)*p.ReasoningOutput
	return cost
}
