package metering

import (
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestPricingCacheCost(t *testing.T) {
	table := &PricingTable{
		version: "test",
		models: map[string][]ModelPricing{
			"gpt-4o": {{Input: 1, Output: 2, CachedInput: 0.1}},
		},
		defaultP: ModelPricing{Input: 1, Output: 2, CachedInput: 0.1},
	}
	usage := NormalizeOpenAI(map[string]any{
		"prompt_tokens":         100,
		"completion_tokens":     10,
		"prompt_tokens_details": map[string]any{"cached_tokens": 60},
	})
	cost := table.ComputeCostUSD("gpt-4o", usage)
	// regular input 40 *1 + cached 60 *0.1 + output 10*2 = 40+6+20=66
	if cost < 65.9 || cost > 66.1 {
		t.Fatalf("unexpected cost %v", cost)
	}
}

func TestDynamicPricingReasoningAndLongContextSurcharge(t *testing.T) {
	hasReasoning := true
	table := &PricingTable{
		version: "dynamic-v1",
		models: map[string][]ModelPricing{
			"gpt-4o": {{
				Input:  1,
				Output: 2,
				Surcharges: []SurchargeRule{
					{
						Name:    "long-context",
						When:    SurchargeWhen{ContextTokensGte: 1000},
						AddPerM: 10,
						ApplyTo: "input",
					},
					{
						Name:          "reasoning-premium",
						When:          SurchargeWhen{HasReasoning: &hasReasoning},
						MultiplierPct: 20,
						ApplyTo:       "reasoning",
					},
				},
			}},
		},
		defaultP: ModelPricing{Input: 1, Output: 2},
	}
	usage := openai.Usage{
		PromptTokens:     2000,
		CompletionTokens: 100,
		TotalTokens:      2200,
		ReasoningTokens:  50,
	}
	result := table.ComputeCost("gpt-4o", usage, CostContext{At: time.Now().UTC()})
	// base: input 2000*1 + output 100*2 + reasoning 50*2 = 2000+200+100=2300
	// long-context surcharge: 2000/1e6*10 = 0.02
	// reasoning premium: reasoningCost(100)*0.2 = 20
	expected := 2300.0 + 0.02 + 20.0
	if result.CostUSD < expected-0.01 || result.CostUSD > expected+0.01 {
		t.Fatalf("expected cost ~%v got %v", expected, result.CostUSD)
	}
	if result.PricingVersion != "dynamic-v1" {
		t.Fatalf("expected pricing version dynamic-v1 got %q", result.PricingVersion)
	}
}

func TestPricingSnapshotFallbackToLocal(t *testing.T) {
	local := &PricingTable{
		version: "local-v1",
		models: map[string][]ModelPricing{
			"gpt-4o-mini": {{Input: 0.5, Output: 1}},
		},
		defaultP: ModelPricing{Input: 0.5, Output: 1},
	}
	active := &PricingTable{models: make(map[string][]ModelPricing), defaultP: defaultModelPricing()}
	raw := []byte(`{"version":"remote-v2","default":{"input":9,"output":9},"models":{"gpt-4o-mini":[{"input":3,"output":3}]}}`)
	if err := active.ApplySnapshot(raw, "remote-v2"); err != nil {
		t.Fatalf("apply remote snapshot: %v", err)
	}
	if active.ForModel("gpt-4o-mini").Input != 3 {
		t.Fatalf("expected remote input price")
	}

	// simulate failed remote: fallback to cached local bytes
	localRaw := []byte(`{"version":"local-v1","default":{"input":0.5,"output":1},"models":{"gpt-4o-mini":[{"input":0.5,"output":1}]}}`)
	active = &PricingTable{models: make(map[string][]ModelPricing), defaultP: defaultModelPricing()}
	_ = active.ApplySnapshot(localRaw, local.Version())
	if active.ForModel("gpt-4o-mini").Input != 0.5 {
		t.Fatalf("expected local fallback input 0.5 got %v", active.ForModel("gpt-4o-mini").Input)
	}
}

func TestEffectiveDateSelection(t *testing.T) {
	table := &PricingTable{
		models: map[string][]ModelPricing{
			"gpt-4o": {
				{Input: 1, EffectiveDate: "2026-01-01"},
				{Input: 2, EffectiveDate: "2026-06-01"},
			},
		},
		defaultP: defaultModelPricing(),
	}
	may := time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)
	june := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)
	if table.ForModelAt("gpt-4o", may).Input != 1 {
		t.Fatalf("expected January pricing in May")
	}
	if table.ForModelAt("gpt-4o", june).Input != 2 {
		t.Fatalf("expected June pricing in June")
	}
}

func TestParsePricingTableFromLegacyYAML(t *testing.T) {
	raw := []byte(`
default:
  input: 0.000001
  output: 0.000002
models:
  gpt-4o:
    input: 0.0000025
    output: 0.00001
`)
	table, err := parsePricingTableBytes(raw, "legacy")
	if err != nil {
		t.Fatalf("parse legacy yaml: %v", err)
	}
	if table.ForModel("gpt-4o").Input != 0.0000025 {
		t.Fatalf("unexpected gpt-4o input %v", table.ForModel("gpt-4o").Input)
	}
}
