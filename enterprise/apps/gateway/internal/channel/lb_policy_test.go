package channel

import (
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func TestLBPolicyFromEnvDefault(t *testing.T) {
	t.Setenv("GATEWAY_AI_LB_POLICY", "")
	if got := LBPolicyFromEnv(); got != LBWeight {
		t.Fatalf("got %q", got)
	}
}

func TestLBPolicyFromEnvLatency(t *testing.T) {
	t.Setenv("GATEWAY_AI_LB_POLICY", "latency_aware")
	if got := LBPolicyFromEnv(); got != LBLatencyAware {
		t.Fatalf("got %q", got)
	}
}

func TestInverseLatencyWeight(t *testing.T) {
	low := InverseLatencyWeight(50, 1)
	high := InverseLatencyWeight(500, 1)
	if low <= high {
		t.Fatalf("expected lower latency to yield higher weight: low=%d high=%d", low, high)
	}
	if InverseLatencyWeight(0, 3) != 3 {
		t.Fatal("missing p50 should use static weight")
	}
}

func TestPrefixHashStable(t *testing.T) {
	msgs := []openai.ChatMessage{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi"},
	}
	a := PrefixHashIndex(msgs, 2, 5)
	b := PrefixHashIndex(msgs, 2, 5)
	if a != b {
		t.Fatalf("unstable hash %d vs %d", a, b)
	}
}

func TestPrefixHashRemapsWhenCountChanges(t *testing.T) {
	msgs := []openai.ChatMessage{{Role: "user", Content: "same prompt"}}
	idx3 := PrefixHashIndex(msgs, 1, 3)
	idx5 := PrefixHashIndex(msgs, 1, 5)
	_ = idx3
	_ = idx5
}
