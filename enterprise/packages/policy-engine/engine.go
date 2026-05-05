package policyengine

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

type compiledRule struct {
	rule      Rule
	trie      *keywordTrie
	compiled  *regexp.Regexp
	piiRegexp *regexp.Regexp
}

type Engine struct {
	rules []compiledRule
}

func NewEngine(manifests []RulePackManifest) (*Engine, error) {
	rules := make([]compiledRule, 0)
	for _, manifest := range manifests {
		for _, rule := range manifest.Rules {
			if rule.AppliesTo == nil {
				rule.AppliesTo = manifest.AppliesTo
			}
			compiled, err := compileRule(rule)
			if err != nil {
				return nil, fmt.Errorf("compile rule %s failed: %w", rule.ID, err)
			}
			rules = append(rules, compiled)
		}
	}
	return &Engine{rules: rules}, nil
}

func compileRule(rule Rule) (compiledRule, error) {
	out := compiledRule{rule: rule}
	switch rule.Kind {
	case RuleKindKeyword:
		out.trie = newKeywordTrie(rule.Keywords)
	case RuleKindRegex:
		re, err := regexp.Compile(rule.Pattern)
		if err != nil {
			return compiledRule{}, err
		}
		out.compiled = re
	case RuleKindPII:
		re, ok := baselinePIIRegex(rule.PIIType)
		if !ok {
			return compiledRule{}, fmt.Errorf("unsupported pii type: %s", rule.PIIType)
		}
		out.piiRegexp = re
	default:
		return compiledRule{}, fmt.Errorf("unsupported rule kind: %s", rule.Kind)
	}
	return out, nil
}

func (e *Engine) Evaluate(text string, stage string) EvaluateResult {
	return e.EvaluateWithContext(text, EvalContext{
		Stage:      stage,
		ClientType: "*",
		DeptIDs:    []string{"*"},
		RoleCodes:  []string{"*"},
		UserID:     "*",
	})
}

func (e *Engine) EvaluateWithContext(text string, ctx EvalContext) EvaluateResult {
	result := EvaluateResult{
		Blocked:      false,
		RedactedText: text,
		Hits:         []HitEvent{},
	}
	if strings.TrimSpace(ctx.Stage) == "" {
		ctx.Stage = "request"
	}

	for _, compiled := range e.rules {
		if strings.TrimSpace(compiled.rule.TenantID) != "" && strings.TrimSpace(ctx.TenantID) != "" &&
			!strings.EqualFold(strings.TrimSpace(compiled.rule.TenantID), strings.TrimSpace(ctx.TenantID)) {
			continue
		}
		if !matchesAppliesTo(compiled.rule.AppliesTo, ctx) {
			continue
		}
		switch compiled.rule.Kind {
		case RuleKindKeyword:
			hits := compiled.trie.findAll(result.RedactedText)
			for _, hit := range hits {
				result = applyHit(result, compiled.rule, ctx.Stage, hit)
			}
		case RuleKindRegex:
			hits := compiled.compiled.FindAllString(result.RedactedText, -1)
			for _, hit := range hits {
				result = applyHit(result, compiled.rule, ctx.Stage, hit)
			}
		case RuleKindPII:
			hits := compiled.piiRegexp.FindAllString(result.RedactedText, -1)
			for _, hit := range hits {
				result = applyHit(result, compiled.rule, ctx.Stage, hit)
			}
		}
	}
	return result
}

func matchesAppliesTo(applies *AppliesTo, ctx EvalContext) bool {
	if applies == nil {
		return true
	}
	if contains(applies.UserExcludeIDs, ctx.UserID) {
		return false
	}
	if !matchesDim(applies.Stages, ctx.Stage) {
		return false
	}
	if !matchesDim(applies.ClientTypes, ctx.ClientType) {
		return false
	}
	if len(applies.UserIDs) > 0 && !contains(applies.UserIDs, ctx.UserID) {
		return false
	}
	deptMatch := matchesAny(applies.DepartmentIDs, ctx.DeptIDs)
	roleMatch := matchesAny(applies.RoleCodes, ctx.RoleCodes)
	return deptMatch || roleMatch
}

func matchesAny(configured []string, actual []string) bool {
	if len(configured) == 0 || contains(configured, "*") {
		return true
	}
	for _, item := range actual {
		if contains(configured, item) {
			return true
		}
	}
	return false
}

func matchesDim(configured []string, actual string) bool {
	if len(configured) == 0 || contains(configured, "*") {
		return true
	}
	return contains(configured, actual)
}

func contains(items []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, item := range items {
		if strings.EqualFold(strings.TrimSpace(item), target) {
			return true
		}
	}
	return false
}

func applyHit(result EvaluateResult, rule Rule, stage string, hit string) EvaluateResult {
	event := HitEvent{
		RuleID:    rule.ID,
		Kind:      string(rule.Kind),
		Action:    rule.Action,
		Severity:  rule.Severity,
		Message:   rule.Message,
		Matched:   hit,
		Stage:     stage,
		PIIType:   rule.PIIType,
		Timestamp: time.Now().UnixMilli(),
	}
	result.Hits = append(result.Hits, event)

	switch rule.Action {
	case ActionBlock:
		result.Blocked = true
	case ActionRedact:
		result.RedactedText = strings.ReplaceAll(result.RedactedText, hit, "[REDACTED]")
	case ActionWarn:
		// warn 仅记录命中事件，不改变文本。
	}
	return result
}

func baselinePIIRegex(kind string) (*regexp.Regexp, bool) {
	patterns := map[string]string{
		"mobile":    `(?:(?:\+?86)?1[3-9]\d{9})`,
		"email":     `[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}`,
		"id-card":   `\b\d{17}[\dXx]\b`,
		"bank-card": `\b\d{16,19}\b`,
		"api-key":   `(?i)\b(?:sk|ak|pk|token)[-_]?[a-z0-9]{16,}\b`,
	}
	pattern, ok := patterns[strings.ToLower(strings.TrimSpace(kind))]
	if !ok {
		return nil, false
	}
	return regexp.MustCompile(pattern), true
}
