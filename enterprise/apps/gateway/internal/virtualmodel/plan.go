package virtualmodel

import (
	"math/rand"
	"sort"
	"strings"
)

// Target is one real model behind a virtual name.
// Priority uses the same rule as channel tiers: smaller numbers are preferred.
type Target struct {
	Model    string `json:"model"`
	Weight   int    `json:"weight"`
	Priority int    `json:"priority"`
}

// Model is one tenant's virtual model from the snapshot.
type Model struct {
	TenantID    string   `json:"tenantId"`
	Name        string   `json:"name"`
	DisplayName string   `json:"displayName"`
	Enabled     bool     `json:"enabled"`
	Targets     []Target `json:"targets"`
}

type indexedTarget struct {
	Target
	index int
}

// Plan orders real models for a virtual name.
// The first entry is a weighted sample of the lowest available priority tier.
// A target is available when available(model) is true. When every tier is
// unavailable, the lowest priority tier is sampled anyway so the caller can
// fall through to the existing channel picker.
// Remaining targets follow in ascending priority, stable by input order.
// An empty result means there is no usable target.
func Plan(targets []Target, available func(model string) bool, rng *rand.Rand) []string {
	cleaned := normalizeTargets(targets)
	if len(cleaned) == 0 {
		return nil
	}
	if available == nil {
		available = func(string) bool { return true }
	}
	if rng == nil {
		rng = rand.New(rand.NewSource(1))
	}

	tiers := groupByPriority(cleaned)
	chosen := -1
	for _, tier := range tiers {
		ready := filterAvailable(tier, available)
		if len(ready) == 0 {
			continue
		}
		chosen = weightedSample(ready, rng).index
		break
	}
	if chosen < 0 {
		chosen = weightedSample(tiers[0], rng).index
	}

	order := []string{cleaned[chosen].Model}
	rest := make([]indexedTarget, 0, len(cleaned)-1)
	for _, target := range cleaned {
		if target.index == chosen {
			continue
		}
		rest = append(rest, target)
	}
	sort.SliceStable(rest, func(i, j int) bool {
		if rest[i].Priority != rest[j].Priority {
			return rest[i].Priority < rest[j].Priority
		}
		return rest[i].index < rest[j].index
	})
	for _, target := range rest {
		order = append(order, target.Model)
	}
	return order
}

func normalizeTargets(targets []Target) []indexedTarget {
	out := make([]indexedTarget, 0, len(targets))
	for _, target := range targets {
		model := strings.TrimSpace(target.Model)
		if model == "" {
			continue
		}
		target.Model = model
		out = append(out, indexedTarget{Target: target, index: len(out)})
	}
	return out
}

func groupByPriority(targets []indexedTarget) [][]indexedTarget {
	if len(targets) == 0 {
		return nil
	}
	priorities := make([]int, 0, len(targets))
	seen := map[int]struct{}{}
	for _, target := range targets {
		if _, ok := seen[target.Priority]; ok {
			continue
		}
		seen[target.Priority] = struct{}{}
		priorities = append(priorities, target.Priority)
	}
	sort.Ints(priorities)
	tiers := make([][]indexedTarget, 0, len(priorities))
	for _, priority := range priorities {
		tier := make([]indexedTarget, 0)
		for _, target := range targets {
			if target.Priority == priority {
				tier = append(tier, target)
			}
		}
		tiers = append(tiers, tier)
	}
	return tiers
}

func filterAvailable(tier []indexedTarget, available func(string) bool) []indexedTarget {
	out := make([]indexedTarget, 0, len(tier))
	for _, target := range tier {
		if available(target.Model) {
			out = append(out, target)
		}
	}
	return out
}

func weightedSample(items []indexedTarget, rng *rand.Rand) indexedTarget {
	if len(items) == 1 {
		return items[0]
	}
	weights := make([]int, len(items))
	total := 0
	for i, item := range items {
		weight := item.Weight
		if weight < 1 {
			weight = 0
		}
		weights[i] = weight
		total += weight
	}
	if total == 0 {
		return items[rng.Intn(len(items))]
	}
	pick := rng.Intn(total)
	acc := 0
	for i, weight := range weights {
		acc += weight
		if pick < acc {
			return items[i]
		}
	}
	return items[len(items)-1]
}
