package policyengine

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	FieldTargetRequest  = "request"
	FieldTargetResponse = "response"

	FieldActionAllow  = "allow"
	FieldActionDeny   = "deny"
	FieldActionRedact = "redact"
)

type fieldMatch struct {
	parent map[string]any
	key    string
	value  any
}

// EvaluateJSONFields applies field rules to JSON payload for the given stage (request/response).
func (e *Engine) EvaluateJSONFields(raw []byte, ctx EvalContext) ([]byte, EvaluateResult) {
	result := EvaluateResult{
		Blocked:      false,
		RedactedText: string(raw),
		Hits:         []HitEvent{},
	}
	if len(raw) == 0 {
		return raw, result
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return raw, result
	}
	stage := strings.TrimSpace(ctx.Stage)
	if stage == "" {
		stage = FieldTargetRequest
	}

	for _, compiled := range e.rules {
		if compiled.rule.Kind != RuleKindField {
			continue
		}
		if strings.TrimSpace(compiled.rule.TenantID) != "" && strings.TrimSpace(ctx.TenantID) != "" &&
			!strings.EqualFold(strings.TrimSpace(compiled.rule.TenantID), strings.TrimSpace(ctx.TenantID)) {
			continue
		}
		if !matchesAppliesTo(compiled.rule.AppliesTo, ctx) {
			continue
		}
		target := strings.ToLower(strings.TrimSpace(compiled.rule.FieldTarget))
		if target == "" {
			target = FieldTargetResponse
		}
		if target != stage {
			continue
		}
		path := strings.TrimSpace(compiled.rule.JSONPath)
		if path == "" {
			continue
		}
		matches := collectFieldMatches(root, splitJSONPath(path))
		for _, match := range matches {
			matched := fmt.Sprintf("%v", match.value)
			fieldAction := normalizeFieldAction(compiled.rule)
			switch fieldAction {
			case FieldActionDeny:
				if match.value != nil && matched != "" {
					result = applyHit(result, compiled.rule, ctx.Stage, matched)
					result.Blocked = true
				}
			case FieldActionRedact:
				if match.parent != nil {
					match.parent[match.key] = "[REDACTED]"
					result = applyHit(result, compiled.rule, ctx.Stage, matched)
				}
			case FieldActionAllow:
				// explicit allow: record hit only, no mutation
			}
		}
	}

	out, err := json.Marshal(root)
	if err != nil {
		return raw, result
	}
	result.RedactedText = string(out)
	return out, result
}

func normalizeFieldAction(rule Rule) string {
	if action := strings.ToLower(strings.TrimSpace(rule.FieldAction)); action != "" {
		return action
	}
	switch rule.Action {
	case ActionBlock:
		return FieldActionDeny
	case ActionRedact:
		return FieldActionRedact
	default:
		return FieldActionAllow
	}
}

func splitJSONPath(path string) []string {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	var segments []string
	for _, part := range strings.Split(path, ".") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.HasSuffix(part, "[*]") {
			base := strings.TrimSuffix(part, "[*]")
			if base != "" {
				segments = append(segments, base)
			}
			segments = append(segments, "[*]")
			continue
		}
		segments = append(segments, part)
	}
	return segments
}

func collectFieldMatches(node any, segments []string) []fieldMatch {
	if len(segments) == 0 {
		return nil
	}
	seg := segments[0]
	if seg == "[*]" {
		arr, ok := node.([]any)
		if !ok {
			return nil
		}
		out := make([]fieldMatch, 0)
		for _, item := range arr {
			out = append(out, collectFieldMatches(item, segments[1:])...)
		}
		return out
	}
	if len(segments) == 1 {
		m, ok := node.(map[string]any)
		if !ok {
			return nil
		}
		v, ok := m[seg]
		if !ok {
			return nil
		}
		return []fieldMatch{{parent: m, key: seg, value: v}}
	}
	m, ok := node.(map[string]any)
	if !ok {
		return nil
	}
	child, ok := m[seg]
	if !ok {
		return nil
	}
	return collectFieldMatches(child, segments[1:])
}
