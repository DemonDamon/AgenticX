package metering

import (
	"os"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func loadTestTable(t *testing.T, yaml string) *PricingTable {
	t.Helper()
	path := t.TempDir() + "/pricing.yaml"
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatalf("write pricing: %v", err)
	}
	table, err := LoadPricingTable(path)
	if err != nil {
		t.Fatalf("load pricing: %v", err)
	}
	return table
}

func usage(prompt, completion int) openai.Usage {
	return openai.Usage{PromptTokens: prompt, CompletionTokens: completion, TotalTokens: prompt + completion}
}

// 私有化部署是固定成本，不按量付费。这条用例锁的是「0 表示免费」，而不是
// normalizePricing 眼里的「没填 → 用默认价」。
func TestBillingMultiplierZeroMakesAModelFree(t *testing.T) {
	table := loadTestTable(t, `
default:
  input: 0.000001
  output: 0.000002
models:
  cmccfund/qwen3:
    billing_multiplier: 0
`)
	cost := table.ComputeCostForProvider("cmccfund", "qwen3", usage(100000, 50000), CostContext{At: time.Now().UTC()})
	if cost.CostUSD != 0 {
		t.Fatalf("private deployment should not accrue cost, got %v", cost.CostUSD)
	}
}

// 这是不加这个字段时会发生的事：input: 0 被当成「没填」，替换成 default 的价，
// 于是"设为 0"反而按默认费率计费——和意图正好相反。
func TestPlainZeroRateFallsBackToDefaultPrice(t *testing.T) {
	table := loadTestTable(t, `
default:
  input: 0.000001
  output: 0.000002
models:
  legacy-zero:
    input: 0
    output: 0
`)
	cost := table.ComputeCost("legacy-zero", usage(1000, 0), CostContext{At: time.Now().UTC()})
	if cost.CostUSD == 0 {
		t.Fatal("expected the zero-means-unset trap to still be present for plain rates")
	}
}

func TestBillingMultiplierScalesAndDefaultsToOne(t *testing.T) {
	table := loadTestTable(t, `
default:
  input: 0.000001
  output: 0.000002
models:
  tenth:
    input: 0.00001
    output: 0.00001
    billing_multiplier: 0.1
  plain:
    input: 0.00001
    output: 0.00001
`)
	full := table.ComputeCost("plain", usage(1000, 1000), CostContext{At: time.Now().UTC()}).CostUSD
	tenth := table.ComputeCost("tenth", usage(1000, 1000), CostContext{At: time.Now().UTC()}).CostUSD
	if full <= 0 {
		t.Fatalf("baseline cost should be positive, got %v", full)
	}
	if diff := tenth - full*0.1; diff > 1e-12 || diff < -1e-12 {
		t.Fatalf("multiplier 0.1 should bill a tenth: full=%v tenth=%v", full, tenth)
	}
}

// 负数不该变成"返现"。
func TestNegativeBillingMultiplierIsClampedToZero(t *testing.T) {
	table := loadTestTable(t, `
default:
  input: 0.000001
  output: 0.000002
models:
  weird:
    input: 0.00001
    billing_multiplier: -5
`)
	if cost := table.ComputeCost("weird", usage(1000, 0), CostContext{At: time.Now().UTC()}).CostUSD; cost != 0 {
		t.Fatalf("negative multiplier must not credit back, got %v", cost)
	}
}
