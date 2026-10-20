package policyengine

import (
	"strings"
	"testing"
)

func TestPublicRetrievalKeepsNonPIIAndSecretRules(t *testing.T) {
	engine, err := NewEngine([]RulePackManifest{{Rules: []Rule{
		{ID: "card", Kind: RuleKindPII, PIIType: "bank-card", Action: ActionBlock},
		{ID: "phone", Kind: RuleKindPII, PIIType: "mobile", Action: ActionRedact},
		{ID: "key", Kind: RuleKindPII, PIIType: " API-Key ", Action: ActionBlock},
		{ID: "keyword", Kind: RuleKindKeyword, Keywords: []string{"禁止内容"}, Action: ActionBlock},
		{ID: "regex", Kind: RuleKindRegex, Pattern: "custom-block", Action: ActionBlock},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	text := "https://example.org/article/123456789012345678 13800138000"
	result := engine.EvaluateWithContext(text, EvalContext{Stage: "request", PublicRetrieval: true})
	if result.Blocked || result.RedactedText != text || len(result.Hits) != 2 {
		t.Fatalf("public evidence: %+v", result)
	}
	for _, hit := range result.Hits {
		if hit.Action != ActionWarn {
			t.Fatalf("hit: %+v", hit)
		}
	}
	for _, blocked := range []string{"sk-" + strings.Repeat("a", 20), "禁止内容", "custom-block"} {
		if !engine.EvaluateWithContext(blocked, EvalContext{Stage: "request", PublicRetrieval: true}).Blocked {
			t.Errorf("expected block for %q", blocked)
		}
	}
	if !engine.Evaluate(text, "request").Blocked {
		t.Error("ordinary request policy must remain unchanged")
	}
	response := engine.EvaluateWithContext(text, EvalContext{Stage: "response", PublicRetrieval: true})
	if !response.Blocked {
		t.Fatalf("response PII must not be downgraded: %+v", response)
	}
}
