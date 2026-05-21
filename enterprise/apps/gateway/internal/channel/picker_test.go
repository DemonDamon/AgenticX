package channel

import (
	"math/rand"
	"testing"
	"time"
)

func TestWeightedSampleDistribution(t *testing.T) {
	p := NewPicker(nil, NewStatsStore(), NewAffinityStore(time.Minute))
	p.rng = rand.New(rand.NewSource(42))
	cands := []Channel{
		{ID: "a", Weight: 7},
		{ID: "b", Weight: 3},
	}
	counts := map[string]int{"a": 0, "b": 0}
	const n = 1000
	for i := 0; i < n; i++ {
	 picked := p.weightedSample(cands)
		counts[picked.ID]++
	}
	ratioA := float64(counts["a"]) / float64(n)
	if ratioA < 0.65 || ratioA > 0.75 {
		t.Fatalf("expected ~70%% on channel a, got %.2f (counts=%v)", ratioA, counts)
	}
}

func TestPickAffinityPrefersLastSuccess(t *testing.T) {
	reg := &Registry{}
	channels := []Channel{
		{ID: "a", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "b", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	}
	reg.current.Store(&channels)
	stats := NewStatsStore()
	aff := NewAffinityStore(time.Minute)
	aff.Set("sess1", "m1", "b")
	p := NewPicker(reg, stats, aff)
	ch, ok := p.Pick("m1", Identity{TenantID: "t1", SessionID: "sess1"}, nil)
	if !ok || ch.ID != "b" {
		t.Fatalf("expected affinity channel b, got %+v ok=%v", ch, ok)
	}
}

func TestPickExcludesFailedChannels(t *testing.T) {
	reg := &Registry{}
	channels := []Channel{
		{ID: "a", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
		{ID: "b", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1},
	}
	reg.current.Store(&channels)
	p := NewPicker(reg, NewStatsStore(), NewAffinityStore(time.Minute))
	ch, ok := p.Pick("m1", Identity{TenantID: "t1"}, map[string]struct{}{"a": {}})
	if !ok || ch.ID != "b" {
		t.Fatalf("expected channel b after excluding a, got %+v", ch)
	}
}

func TestStatsCooldown(t *testing.T) {
	stats := NewStatsStore()
	now := time.Now()
	stats.RecordFailure("c1", "upstream 503", 30*time.Second)
	if !stats.InCooldown("c1", now) {
		t.Fatal("expected cooldown active")
	}
	if stats.InCooldown("c1", now.Add(31*time.Second)) {
		t.Fatal("expected cooldown expired")
	}
}
