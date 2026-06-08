package channel

import (
	"math/rand"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func testRegistryWithChannels(channels []Channel) *Registry {
	reg := &Registry{}
	reg.current.Store(&channels)
	return reg
}

func TestPickLatencyAwarePrefersLowLatency(t *testing.T) {
	reg := testRegistryWithChannels([]Channel{
		{ID: "fast", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "slow", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	})
	stats := NewStatsStore()
	for i := 0; i < 20; i++ {
		stats.RecordSuccess("fast", 20)
		stats.RecordSuccess("slow", 800)
	}
	p := NewPicker(reg, stats, NewAffinityStore(time.Minute))
	p.policy = LBLatencyAware
	p.rng = rand.New(rand.NewSource(7))

	counts := map[string]int{"fast": 0, "slow": 0}
	const n = 500
	for i := 0; i < n; i++ {
		ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1"}, nil, nil)
		if !ok {
			t.Fatal("expected pick ok")
		}
		if decision.Reason != "latency" {
			t.Fatalf("expected latency reason, got %q", decision.Reason)
		}
		counts[ch.ID]++
	}
	ratioFast := float64(counts["fast"]) / float64(n)
	if ratioFast < 0.75 {
		t.Fatalf("expected fast channel to dominate, ratio=%.2f counts=%v", ratioFast, counts)
	}
}

func TestPickLatencyAwareFallsBackWhenNoSamples(t *testing.T) {
	reg := testRegistryWithChannels([]Channel{
		{ID: "a", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "b", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	})
	stats := NewStatsStore()
	p := NewPicker(reg, stats, NewAffinityStore(time.Minute))
	p.policy = LBLatencyAware
	p.rng = rand.New(rand.NewSource(99))

	for i := 0; i < 100; i++ {
		ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1"}, nil, nil)
		if !ok {
			t.Fatal("expected pick ok")
		}
		if decision.Reason != "latency" {
			t.Fatalf("expected latency reason with weight fallback, got %q", decision.Reason)
		}
		if ch.ID != "a" && ch.ID != "b" {
			t.Fatalf("unexpected channel %q", ch.ID)
		}
	}
}

func TestPickPrefixCacheStableForSameMessages(t *testing.T) {
	reg := testRegistryWithChannels([]Channel{
		{ID: "c1", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "c2", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "c3", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	})
	p := NewPicker(reg, NewStatsStore(), NewAffinityStore(time.Minute))
	p.policy = LBPrefixCache
	msgs := []openai.ChatMessage{
		{Role: "user", Content: "explain gateway load balancing"},
		{Role: "assistant", Content: "ok"},
		{Role: "user", Content: "with prefix affinity"},
	}

	var firstID string
	for i := 0; i < 20; i++ {
		ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1"}, nil, msgs)
		if !ok {
			t.Fatal("expected pick ok")
		}
		if decision.Reason != "prefix" || decision.Policy != LBPrefixCache {
			t.Fatalf("expected prefix policy, got %+v", decision)
		}
		if firstID == "" {
			firstID = ch.ID
			continue
		}
		if ch.ID != firstID {
			t.Fatalf("expected stable prefix channel %q, got %q", firstID, ch.ID)
		}
	}
}

func TestPickPrefixBeforeAffinity(t *testing.T) {
	reg := testRegistryWithChannels([]Channel{
		{ID: "c1", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "c2", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	})
	aff := NewAffinityStore(time.Minute)
	aff.Set("sess1", "m1", "c2")
	p := NewPicker(reg, NewStatsStore(), aff)
	p.policy = LBPrefixCache
	msgs := []openai.ChatMessage{{Role: "user", Content: "prefix wins over affinity"}}

	ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1", SessionID: "sess1"}, nil, msgs)
	if !ok {
		t.Fatal("expected pick ok")
	}
	if decision.Reason != "prefix" {
		t.Fatalf("expected prefix before affinity, got %+v channel=%q", decision, ch.ID)
	}
}

func TestPickDefaultWeightUnchanged(t *testing.T) {
	t.Setenv("GATEWAY_AI_LB_POLICY", "")
	reg := testRegistryWithChannels([]Channel{
		{ID: "a", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "b", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	})
	aff := NewAffinityStore(time.Minute)
	aff.Set("sess1", "m1", "b")
	p := NewPicker(reg, NewStatsStore(), aff)
	ch, ok := p.Pick("m1", Identity{TenantID: "t1", SessionID: "sess1"}, nil)
	if !ok || ch.ID != "b" {
		t.Fatalf("expected affinity channel b with default weight policy, got %+v ok=%v", ch, ok)
	}
}
