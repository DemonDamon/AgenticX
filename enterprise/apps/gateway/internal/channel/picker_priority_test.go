package channel

import (
	"math/rand"
	"testing"
	"time"
)

func priorityTierChannels() []Channel {
	return []Channel{
		{ID: "A", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1, Priority: 0},
		{ID: "B", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 1, Priority: 0},
		{ID: "C", TenantID: "t1", Status: StatusActive, SupportedModels: []string{"m1"}, Weight: 100, Priority: 1},
	}
}

func TestPickStaysInHighestPriorityTier(t *testing.T) {
	p := NewPicker(testRegistryWithChannels(priorityTierChannels()), NewStatsStore(), NewAffinityStore(time.Minute))
	p.rng = rand.New(rand.NewSource(1))
	counts := map[string]int{"A": 0, "B": 0, "C": 0}
	const n = 1000
	for i := 0; i < n; i++ {
		ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1"}, nil, nil)
		if !ok {
			t.Fatal("expected pick")
		}
		if decision.Priority != 0 {
			t.Fatalf("expected priority 0, got %d", decision.Priority)
		}
		if decision.Reason != "weight" {
			t.Fatalf("expected weight reason, got %q", decision.Reason)
		}
		counts[ch.ID]++
	}
	if counts["C"] != 0 {
		t.Fatalf("low priority channel C was selected %d times", counts["C"])
	}
	if counts["A"]+counts["B"] != n {
		t.Fatalf("expected all picks in tier 0, counts=%v", counts)
	}
}

func TestPickFallsBackWhenHigherTierUnavailable(t *testing.T) {
	stats := NewStatsStore()
	p := NewPicker(testRegistryWithChannels(priorityTierChannels()), stats, NewAffinityStore(time.Minute))
	p.MarkFailure(Channel{ID: "A"}, "upstream unavailable", 30*time.Second)
	p.MarkFailure(Channel{ID: "B"}, "upstream unavailable", 30*time.Second)
	ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1"}, nil, nil)
	if !ok || ch.ID != "C" || decision.Priority != 1 || decision.Reason != "weight" {
		t.Fatalf("expected C after higher tier cooldown, got id=%s priority=%d reason=%s ok=%v", ch.ID, decision.Priority, decision.Reason, ok)
	}

	p2 := NewPicker(testRegistryWithChannels(priorityTierChannels()), NewStatsStore(), NewAffinityStore(time.Minute))
	ch, decision, ok = p2.PickWithPrefix("m1", Identity{TenantID: "t1"}, map[string]struct{}{"A": {}, "B": {}}, nil)
	if !ok || ch.ID != "C" || decision.Priority != 1 {
		t.Fatalf("expected C when A and B are excluded, got id=%s priority=%d ok=%v", ch.ID, decision.Priority, ok)
	}
}

func TestPickAllCooldownStaysOnHighestTier(t *testing.T) {
	p := NewPicker(testRegistryWithChannels(priorityTierChannels()), NewStatsStore(), NewAffinityStore(time.Minute))
	p.rng = rand.New(rand.NewSource(2))
	for _, id := range []string{"A", "B", "C"} {
		p.MarkFailure(Channel{ID: id}, "upstream unavailable", 30*time.Second)
	}
	counts := map[string]int{"A": 0, "B": 0, "C": 0}
	const n = 100
	for i := 0; i < n; i++ {
		ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1"}, nil, nil)
		if !ok {
			t.Fatal("expected pick while every channel is cooling down")
		}
		if decision.Priority != 0 {
			t.Fatalf("cooldown fallback must stay on priority 0, got %d", decision.Priority)
		}
		counts[ch.ID]++
	}
	if counts["C"] != 0 || counts["A"]+counts["B"] != n {
		t.Fatalf("expected only the highest tier after full cooldown, counts=%v", counts)
	}
}

func TestPickAffinityDoesNotCrossPriorityTier(t *testing.T) {
	aff := NewAffinityStore(time.Minute)
	aff.Set("sess1", "m1", "C")
	p := NewPicker(testRegistryWithChannels(priorityTierChannels()), NewStatsStore(), aff)
	p.rng = rand.New(rand.NewSource(3))
	const n = 50
	for i := 0; i < n; i++ {
		ch, decision, ok := p.PickWithPrefix("m1", Identity{TenantID: "t1", SessionID: "sess1"}, nil, nil)
		if !ok {
			t.Fatal("expected pick")
		}
		if ch.ID != "A" && ch.ID != "B" {
			t.Fatalf("affinity must not select C, got %s", ch.ID)
		}
		if decision.Reason == "affinity" {
			t.Fatalf("reason must not be affinity when the sticky channel is outside the tier, got %+v", decision)
		}
		if decision.Priority != 0 {
			t.Fatalf("expected priority 0, got %d", decision.Priority)
		}
	}
}
