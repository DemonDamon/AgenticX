package policyengine

import (
	"encoding/json"
	"testing"
)

func TestEvaluateJSONFieldsRedactSSN(t *testing.T) {
	engine, err := NewEngine([]RulePackManifest{
		{
			Name: "field-pack",
			Rules: []Rule{
				{
					ID:          "f1",
					Kind:        RuleKindField,
					Action:      ActionRedact,
					FieldAction: FieldActionRedact,
					JSONPath:    "metadata.ssn",
					FieldTarget: FieldTargetResponse,
					Severity:    "high",
					Message:     "ssn redact",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	raw := []byte(`{"metadata":{"ssn":"123456789012345678"},"choices":[{"message":{"content":"ok"}}]}`)
	out, result := engine.EvaluateJSONFields(raw, EvalContext{Stage: FieldTargetResponse})
	if result.Blocked {
		t.Fatalf("redact should not block")
	}
	if len(result.Hits) != 1 {
		t.Fatalf("expected 1 hit, got %d", len(result.Hits))
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	meta, _ := parsed["metadata"].(map[string]any)
	if meta["ssn"] != "[REDACTED]" {
		t.Fatalf("expected redacted ssn, got %v", meta["ssn"])
	}
}

func TestEvaluateJSONFieldsDenyBlocks(t *testing.T) {
	engine, err := NewEngine([]RulePackManifest{
		{
			Name: "field-pack",
			Rules: []Rule{
				{
					ID:          "f-deny",
					Kind:        RuleKindField,
					Action:      ActionBlock,
					FieldAction: FieldActionDeny,
					JSONPath:    "metadata.secret",
					FieldTarget: FieldTargetResponse,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	raw := []byte(`{"metadata":{"secret":"top"}}`)
	_, result := engine.EvaluateJSONFields(raw, EvalContext{Stage: FieldTargetResponse})
	if !result.Blocked {
		t.Fatal("expected deny block")
	}
}

func TestFieldRuleWrongStageNoOp(t *testing.T) {
	engine, err := NewEngine([]RulePackManifest{
		{
			Name: "field-pack",
			Rules: []Rule{
				{
					ID:          "f1",
					Kind:        RuleKindField,
					FieldAction: FieldActionRedact,
					JSONPath:    "metadata.ssn",
					FieldTarget: FieldTargetResponse,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	raw := []byte(`{"metadata":{"ssn":"123"}}`)
	out, result := engine.EvaluateJSONFields(raw, EvalContext{Stage: FieldTargetRequest})
	if len(result.Hits) != 0 {
		t.Fatalf("expected no hits on request stage, got %d", len(result.Hits))
	}
	if string(out) != string(raw) {
		t.Fatalf("expected unchanged payload")
	}
}
