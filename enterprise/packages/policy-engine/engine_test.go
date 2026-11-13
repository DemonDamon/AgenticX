package policyengine

import "testing"

func TestEngineEvaluateBlockAndRedact(t *testing.T) {
	engine, err := NewEngine([]RulePackManifest{
		{
			Name: "test-pack",
			Rules: []Rule{
				{ID: "r1", Kind: RuleKindKeyword, Action: ActionBlock, Keywords: []string{"内幕交易"}},
				{ID: "r2", Kind: RuleKindPII, Action: ActionRedact, PIIType: "email"},
			},
		},
	})
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}

	result := engine.Evaluate("请发送内幕交易报告到 demo@corp.com", "request")
	if !result.Blocked {
		t.Fatalf("expected blocked")
	}
	if result.RedactedText == "" || result.RedactedText == "请发送内幕交易报告到 demo@corp.com" {
		t.Fatalf("expected redacted text, got: %s", result.RedactedText)
	}
	if len(result.Hits) < 2 {
		t.Fatalf("expected >=2 hits, got %d", len(result.Hits))
	}
}

func TestEngineCategoryPassthrough(t *testing.T) {
	engine, err := NewEngine([]RulePackManifest{
		{
			Name: "compliance-pack",
			Rules: []Rule{
				{ID: "compliance-porn-1", Kind: RuleKindKeyword, Action: ActionBlock, Severity: "high", Category: "porn", Keywords: []string{"裸聊"}},
				{ID: "compliance-ad-1", Kind: RuleKindRegex, Action: ActionWarn, Severity: "medium", Category: "ad", Pattern: `加微信\d+`},
				{ID: "no-category-rule", Kind: RuleKindKeyword, Action: ActionWarn, Keywords: []string{"裸聊"}},
			},
		},
	})
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}

	result := engine.Evaluate("裸聊 加微信12345", "request")
	categorized := map[string]string{}
	for _, hit := range result.Hits {
		categorized[hit.RuleID] = hit.Category
	}
	if categorized["compliance-porn-1"] != "porn" {
		t.Fatalf("expected category porn on compliance-porn-1, got: %q", categorized["compliance-porn-1"])
	}
	if categorized["compliance-ad-1"] != "ad" {
		t.Fatalf("expected category ad on compliance-ad-1, got: %q", categorized["compliance-ad-1"])
	}
	if categorized["no-category-rule"] != "" {
		t.Fatalf("expected empty category on no-category-rule, got: %q", categorized["no-category-rule"])
	}
}
