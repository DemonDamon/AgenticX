package transform

import (
	"regexp"
	"strings"
)

// DerivedModel captures suffix-derived upstream parameters.
type DerivedModel struct {
	UpstreamModel   string
	ReasoningEffort string
	ThinkingBudget  int
	ThinkingEnabled bool
}

var (
	reOpenAIEffort = regexp.MustCompile(`(?i)^(.*)-(high|medium|low)$`)
	reGeminiThink  = regexp.MustCompile(`(?i)^(gemini-[\d.]+-(?:flash|pro))-thinking(?:-(\d+))?$`)
	reGeminiEffort = regexp.MustCompile(`(?i)^(gemini-[\d.]+-(?:flash|pro))-(high|medium|low)$`)
)

// ResolveModel strips client-facing suffixes and returns upstream model + injected params.
func ResolveModel(model string) DerivedModel {
	model = strings.TrimSpace(model)
	if model == "" {
		return DerivedModel{}
	}
	lower := strings.ToLower(model)

	if strings.Contains(lower, "claude") && strings.Contains(lower, "thinking") {
		base := strings.TrimSuffix(strings.TrimSuffix(lower, "-thinking"), "_thinking")
		if base == lower {
			base = model
		}
		return DerivedModel{
			UpstreamModel:   base,
			ThinkingEnabled: true,
			ThinkingBudget:  8192,
		}
	}

	if m := reGeminiThink.FindStringSubmatch(model); len(m) >= 2 {
		budget := 8192
		if len(m) >= 3 && strings.TrimSpace(m[2]) != "" {
			if n, ok := parseInt(m[2]); ok {
				budget = n
			}
		}
		return DerivedModel{
			UpstreamModel:   m[1],
			ThinkingEnabled: true,
			ThinkingBudget:  budget,
		}
	}
	if m := reGeminiEffort.FindStringSubmatch(model); len(m) >= 3 {
		budget := geminiBudgetFromEffort(m[2])
		return DerivedModel{
			UpstreamModel:   m[1],
			ThinkingEnabled: true,
			ThinkingBudget:  budget,
		}
	}

	if m := reOpenAIEffort.FindStringSubmatch(model); len(m) >= 3 {
		return DerivedModel{
			UpstreamModel:   strings.TrimSpace(m[1]),
			ReasoningEffort: strings.ToLower(m[2]),
		}
	}

	return DerivedModel{UpstreamModel: model}
}

func geminiBudgetFromEffort(effort string) int {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "high":
		return 8192
	case "medium":
		return 4096
	default:
		return 2048
	}
}

func parseInt(s string) (int, bool) {
	n := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, false
		}
		n = n*10 + int(c-'0')
	}
	return n, true
}
