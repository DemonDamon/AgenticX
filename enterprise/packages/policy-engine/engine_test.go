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
