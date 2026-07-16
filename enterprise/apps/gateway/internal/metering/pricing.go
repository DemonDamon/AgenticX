package metering

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
	"gopkg.in/yaml.v3"
)

// SurchargeWhen describes optional complexity triggers for surcharges.
type SurchargeWhen struct {
	ContextTokensGte int   `yaml:"context_tokens_gte,omitempty" json:"contextTokensGte,omitempty"`
	HasReasoning     *bool `yaml:"has_reasoning,omitempty" json:"hasReasoning,omitempty"`
	ToolCallsGte     int   `yaml:"tool_calls_gte,omitempty" json:"toolCallsGte,omitempty"`
}

// SurchargeRule adds cost when complexity conditions match.
type SurchargeRule struct {
	Name          string        `yaml:"name,omitempty" json:"name,omitempty"`
	When          SurchargeWhen `yaml:"when" json:"when"`
	AddPerM       float64       `yaml:"add_per_m,omitempty" json:"addPerM,omitempty"`
	MultiplierPct float64       `yaml:"multiplier_pct,omitempty" json:"multiplierPct,omitempty"`
	ApplyTo       string        `yaml:"apply_to,omitempty" json:"applyTo,omitempty"` // input|output|reasoning|total
}

// ModelPricing holds per-token unit prices in USD with optional surcharges.
type ModelPricing struct {
	Tier            string          `yaml:"tier,omitempty" json:"tier,omitempty"`
	Input           float64         `yaml:"input" json:"input"`
	Output          float64         `yaml:"output" json:"output"`
	CachedInput     float64         `yaml:"cached_input" json:"cachedInput"`
	CacheCreation   float64         `yaml:"cache_creation" json:"cacheCreation"`
	CacheRead       float64         `yaml:"cache_read" json:"cacheRead"`
	ReasoningOutput float64         `yaml:"reasoning_output" json:"reasoningOutput"`
	InputPerM       float64         `yaml:"input_per_m,omitempty" json:"inputPerM,omitempty"`
	OutputPerM      float64         `yaml:"output_per_m,omitempty" json:"outputPerM,omitempty"`
	ReasoningPerM   float64         `yaml:"reasoning_per_m,omitempty" json:"reasoningPerM,omitempty"`
	Surcharges      []SurchargeRule `yaml:"surcharges,omitempty" json:"surcharges,omitempty"`
	EffectiveDate   string          `yaml:"effective_date,omitempty" json:"effectiveDate,omitempty"`
}

type pricingFile struct {
	Version   string                    `yaml:"version,omitempty" json:"version,omitempty"`
	UpdatedAt string                    `yaml:"updated_at,omitempty" json:"updatedAt,omitempty"`
	Models    map[string][]ModelPricing `yaml:"models" json:"models"`
	Default   ModelPricing              `yaml:"default" json:"default"`
}

// CostContext carries optional billing dimensions beyond usage.
type CostContext struct {
	ToolCalls int
	At        time.Time
}

// CostResult is the outcome of dynamic pricing.
type CostResult struct {
	CostUSD        float64
	PricingVersion string
}

// PricingTable resolves model-specific token prices with cache-aware fallbacks.
type PricingTable struct {
	mu            sync.RWMutex
	version       string
	models        map[string][]ModelPricing
	defaultP      ModelPricing
	localFallback *PricingTable
}

func LoadPricingTable(path string) (*PricingTable, error) {
	if path == "" {
		table := &PricingTable{models: make(map[string][]ModelPricing)}
		table.defaultP = defaultModelPricing()
		return table, nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			table := &PricingTable{models: make(map[string][]ModelPricing)}
			table.defaultP = defaultModelPricing()
			return table, nil
		}
		return nil, err
	}
	return parsePricingTableBytes(raw, "local:"+path)
}

func parsePricingTableBytes(raw []byte, versionHint string) (*PricingTable, error) {
	table := &PricingTable{models: make(map[string][]ModelPricing)}
	var parsed pricingFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		if err := unmarshalPricingYAML(raw, &parsed); err != nil {
			return nil, err
		}
	}
	table.version = strings.TrimSpace(parsed.Version)
	if table.version == "" && strings.TrimSpace(parsed.UpdatedAt) != "" {
		table.version = "snapshot:" + strings.TrimSpace(parsed.UpdatedAt)
	}
	if table.version == "" {
		table.version = versionHint
	}
	if parsed.Default.Input == 0 && parsed.Default.Output == 0 && parsed.Default.InputPerM == 0 {
		table.defaultP = defaultModelPricing()
	} else {
		table.defaultP = normalizePricing(parsed.Default, defaultModelPricing())
	}
	for model, entries := range parsed.Models {
		if len(entries) == 0 {
			continue
		}
		normalized := make([]ModelPricing, 0, len(entries))
		for _, entry := range entries {
			normalized = append(normalized, normalizePricing(entry, table.defaultP))
		}
		table.models[model] = normalized
	}
	return table, nil
}

func unmarshalPricingYAML(raw []byte, parsed *pricingFile) error {
	type yamlRoot struct {
		Version   string               `yaml:"version"`
		UpdatedAt string               `yaml:"updated_at"`
		Default   ModelPricing         `yaml:"default"`
		Models    map[string]yaml.Node `yaml:"models"`
	}
	var root yamlRoot
	if err := yaml.Unmarshal(raw, &root); err != nil {
		return err
	}
	parsed.Version = root.Version
	parsed.UpdatedAt = root.UpdatedAt
	parsed.Default = root.Default
	parsed.Models = make(map[string][]ModelPricing)
	for model, node := range root.Models {
		var multi []ModelPricing
		if err := node.Decode(&multi); err == nil && len(multi) > 0 && node.Kind == yaml.SequenceNode {
			parsed.Models[model] = multi
			continue
		}
		var single ModelPricing
		if err := node.Decode(&single); err == nil {
			parsed.Models[model] = []ModelPricing{single}
		}
	}
	return nil
}

func defaultModelPricing() ModelPricing {
	return ModelPricing{Input: 0.000001, Output: 0.000002}
}

func DefaultPricingPath() string {
	if v := os.Getenv("GATEWAY_PRICING_FILE"); v != "" {
		return v
	}
	return filepath.Join("internal", "metering", "pricing.yaml")
}

func (t *PricingTable) SetLocalFallback(fallback *PricingTable) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.localFallback = fallback
}

func (t *PricingTable) Version() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.version
}

// ApplySnapshot replaces the active pricing table from admin snapshot bytes (JSON or YAML).
func (t *PricingTable) ApplySnapshot(raw []byte, version string) error {
	next, err := parsePricingTableBytes(raw, version)
	if err != nil {
		return err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if strings.TrimSpace(version) != "" {
		next.version = strings.TrimSpace(version)
	}
	t.version = next.version
	t.models = next.models
	t.defaultP = next.defaultP
	return nil
}

func (t *PricingTable) ForModel(model string) ModelPricing {
	return t.ForModelAt(model, time.Now().UTC())
}

func (t *PricingTable) ForModelAt(model string, at time.Time) ModelPricing {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if entries, ok := t.models[model]; ok {
		if picked, ok := pickEffectivePricing(entries, at); ok {
			return normalizePricing(picked, t.defaultP)
		}
	}
	return normalizePricing(t.defaultP, t.defaultP)
}

func pickEffectivePricing(entries []ModelPricing, at time.Time) (ModelPricing, bool) {
	if len(entries) == 0 {
		return ModelPricing{}, false
	}
	type dated struct {
		pricing ModelPricing
		at      time.Time
		hasDate bool
	}
	datedEntries := make([]dated, 0, len(entries))
	for _, entry := range entries {
		d := dated{pricing: entry}
		if ts, ok := parseEffectiveDate(entry.EffectiveDate); ok {
			d.at = ts
			d.hasDate = true
		}
		datedEntries = append(datedEntries, d)
	}
	sort.SliceStable(datedEntries, func(i, j int) bool {
		if datedEntries[i].hasDate != datedEntries[j].hasDate {
			return datedEntries[i].hasDate
		}
		if !datedEntries[i].hasDate {
			return false
		}
		return datedEntries[i].at.Before(datedEntries[j].at)
	})
	var picked *ModelPricing
	for i := range datedEntries {
		entry := datedEntries[i]
		if !entry.hasDate {
			picked = &entry.pricing
			continue
		}
		if !entry.at.After(at) {
			picked = &entry.pricing
		}
	}
	if picked == nil {
		picked = &datedEntries[len(datedEntries)-1].pricing
	}
	return *picked, true
}

func parseEffectiveDate(value string) (time.Time, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, false
	}
	layouts := []string{time.RFC3339, "2006-01-02T15:04:05Z07:00", "2006-01-02"}
	for _, layout := range layouts {
		if ts, err := time.Parse(layout, trimmed); err == nil {
			return ts.UTC(), true
		}
	}
	return time.Time{}, false
}

func normalizePricing(p, fallback ModelPricing) ModelPricing {
	if p.Input == 0 && p.InputPerM == 0 {
		p.Input = fallback.Input
	}
	if p.Output == 0 && p.OutputPerM == 0 {
		p.Output = fallback.Output
	}
	if p.CachedInput == 0 {
		p.CachedInput = inputRate(p) * 0.1
	}
	if p.CacheCreation == 0 {
		p.CacheCreation = inputRate(p)
	}
	if p.CacheRead == 0 {
		p.CacheRead = p.CachedInput
	}
	if p.ReasoningOutput == 0 && p.ReasoningPerM == 0 {
		p.ReasoningOutput = outputRate(p)
	}
	return p
}

func inputRate(p ModelPricing) float64 {
	if p.InputPerM > 0 {
		return p.InputPerM / 1_000_000
	}
	return p.Input
}

func outputRate(p ModelPricing) float64 {
	if p.OutputPerM > 0 {
		return p.OutputPerM / 1_000_000
	}
	return p.Output
}

func reasoningRate(p ModelPricing) float64 {
	if p.ReasoningPerM > 0 {
		return p.ReasoningPerM / 1_000_000
	}
	return p.ReasoningOutput
}

// ComputeCostUSD calculates multi-dimensional cache-aware cost at the current time.
func (t *PricingTable) ComputeCostUSD(model string, usage openai.Usage) float64 {
	return t.ComputeCost(model, usage, CostContext{At: time.Now().UTC()}).CostUSD
}

// ComputeCost calculates cost with optional complexity context.
func (t *PricingTable) ComputeCost(model string, usage openai.Usage, ctx CostContext) CostResult {
	if ctx.At.IsZero() {
		ctx.At = time.Now().UTC()
	}
	p := t.ForModelAt(model, ctx.At)
	n := NormalizeUsage(usage)
	regularInput := n.PromptTokens - n.CachedTokens - n.CacheReadInputTokens
	if regularInput < 0 {
		regularInput = 0
	}
	inRate := inputRate(p)
	outRate := outputRate(p)
	reasonRate := reasoningRate(p)

	inputCost := float64(regularInput)*inRate +
		float64(n.CachedTokens)*p.CachedInput +
		float64(n.CacheCreationInputTokens)*p.CacheCreation +
		float64(n.CacheReadInputTokens)*p.CacheRead
	outputCost := float64(n.CompletionTokens) * outRate
	reasoningCost := float64(n.ReasoningTokens) * reasonRate
	base := inputCost + outputCost + reasoningCost

	surcharge := applySurcharges(p.Surcharges, n, ctx, inputCost, outputCost, reasoningCost, base)

	version := t.Version()
	if version == "" {
		version = "local"
	}
	return CostResult{CostUSD: base + surcharge, PricingVersion: version}
}

func applySurcharges(rules []SurchargeRule, n NormalizedUsage, ctx CostContext, inputCost, outputCost, reasoningCost, base float64) float64 {
	added := 0.0
	for _, rule := range rules {
		if !matchesSurchargeWhen(rule.When, n, ctx) {
			continue
		}
		applyTo := strings.ToLower(strings.TrimSpace(rule.ApplyTo))
		if applyTo == "" {
			applyTo = "total"
		}
		targetCost := base
		tokenCount := n.TotalTokens
		switch applyTo {
		case "input":
			targetCost = inputCost
			tokenCount = n.PromptTokens
		case "output":
			targetCost = outputCost
			tokenCount = n.CompletionTokens
		case "reasoning":
			targetCost = reasoningCost
			tokenCount = n.ReasoningTokens
		}
		if rule.AddPerM > 0 {
			added += float64(tokenCount) / 1_000_000 * rule.AddPerM
		}
		if rule.MultiplierPct > 0 {
			added += targetCost * (rule.MultiplierPct / 100)
		}
	}
	return added
}

func matchesSurchargeWhen(w SurchargeWhen, n NormalizedUsage, ctx CostContext) bool {
	if w.ContextTokensGte > 0 && n.PromptTokens < w.ContextTokensGte {
		return false
	}
	if w.HasReasoning != nil {
		has := n.ReasoningTokens > 0
		if *w.HasReasoning != has {
			return false
		}
	}
	if w.ToolCallsGte > 0 && ctx.ToolCalls < w.ToolCallsGte {
		return false
	}
	return true
}
