package virtualmodel

import (
	"math/rand"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/channel"
)

func TestPlanWeightDistribution(t *testing.T) {
	targets := []Target{
		{Model: "light", Weight: 1, Priority: 0},
		{Model: "heavy", Weight: 3, Priority: 0},
	}
	rng := rand.New(rand.NewSource(1))
	const n = 10000
	counts := map[string]int{}
	for i := 0; i < n; i++ {
		order := Plan(targets, func(string) bool { return true }, rng)
		if len(order) == 0 {
			t.Fatal("empty plan")
		}
		counts[order[0]]++
	}
	light := counts["light"]
	heavy := counts["heavy"]
	if light+heavy != n {
		t.Fatalf("counts = %#v", counts)
	}
	// 25% and 75%, tolerance ±5 percentage points.
	if light < 2000 || light > 3000 {
		t.Fatalf("light hits = %d, want 2500±500", light)
	}
	if heavy < 7000 || heavy > 8000 {
		t.Fatalf("heavy hits = %d, want 7500±500", heavy)
	}
}

func TestPlanSkipsCooledPreferredTarget(t *testing.T) {
	stats := channel.NewStatsStore()
	reg := channel.NewRegistry(nil, nil)
	reg.SetSnapshot([]channel.Channel{
		{ID: "a", TenantID: "t1", Status: channel.StatusActive, SupportedModels: []string{"real-a"}, Weight: 1},
		{ID: "b", TenantID: "t1", Status: channel.StatusActive, SupportedModels: []string{"real-b"}, Weight: 1},
	})
	picker := channel.NewPicker(reg, stats, nil)
	picker.MarkFailure(channel.Channel{ID: "a"}, "cooled", 30*time.Second)
	if picker.HasRoutableChannel("t1", "real-a") {
		t.Fatal("cooled channel should not be routable")
	}
	order := Plan([]Target{
		{Model: "real-a", Weight: 1, Priority: 0},
		{Model: "real-b", Weight: 1, Priority: 1},
	}, func(model string) bool {
		return picker.HasRoutableChannel("t1", model)
	}, rand.New(rand.NewSource(1)))
	if len(order) == 0 || order[0] != "real-b" {
		t.Fatalf("order = %#v, want real-b first", order)
	}
}

func TestLookupMissReturnsOriginal(t *testing.T) {
	loader := New(nil)
	loader.SetSnapshot([]Model{{
		TenantID: "t1",
		Name:     "virt",
		Enabled:  true,
		Targets:  []Target{{Model: "real-a", Weight: 1, Priority: 0}},
	}})
	order, virtualName, ok := loader.Plan("t1", "real-a", func(string) bool { return true })
	if ok || virtualName != "" || order != nil {
		t.Fatalf("non-virtual plan = %#v %q %v", order, virtualName, ok)
	}
	if _, _, ok := loader.Plan("t1", "virt", func(string) bool { return true }); !ok {
		t.Fatal("expected virtual hit")
	}
	disabled := New(nil)
	disabled.SetSnapshot([]Model{{
		TenantID: "t1",
		Name:     "virt",
		Enabled:  false,
		Targets:  []Target{{Model: "real-a", Weight: 1, Priority: 0}},
	}})
	if _, _, ok := disabled.Plan("t1", "virt", func(string) bool { return true }); ok {
		t.Fatal("disabled virtual model should pass through")
	}
}
