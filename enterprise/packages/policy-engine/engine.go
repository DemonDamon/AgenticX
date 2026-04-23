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
	result := EvaluateResult{
		Blocked:      false,
		RedactedText: text,
		Hits:         []HitEvent{},
	}

	for _, compiled := range e.rules {
		switch compiled.rule.Kind {
		case RuleKindKeyword:
			hits := compiled.trie.findAll(result.RedactedText)
			for _, hit := range hits {
				result = applyHit(result, compiled.rule, stage, hit)
			}
		case RuleKindRegex:
			hits := compiled.compiled.FindAllString(result.RedactedText, -1)
			for _, hit := range hits {
				result = applyHit(result, compiled.rule, stage, hit)
			}
		case RuleKindPII:
			hits := compiled.piiRegexp.FindAllString(result.RedactedText, -1)
			for _, hit := range hits {
				result = applyHit(result, compiled.rule, stage, hit)
			}
		}
	}
	return result
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
