package policyengine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadRulePacksResolveExtends(t *testing.T) {
	root := t.TempDir()
	basePath := filepath.Join(root, "base.yaml")
	childPath := filepath.Join(root, "child.yaml")

	baseContent := []byte(`
name: base
version: 0.1.0
type: rule-pack
rules:
  - id: base-rule
    kind: keyword
    action: warn
    keywords: ["a"]
`)
	childContent := []byte(`
name: child
version: 0.1.0
type: rule-pack
extends: base
rules:
  - id: child-rule
    kind: regex
    action: block
    pattern: "x+"
`)
	if err := os.WriteFile(basePath, baseContent, 0o600); err != nil {
		t.Fatalf("write base: %v", err)
	}
	if err := os.WriteFile(childPath, childContent, 0o600); err != nil {
		t.Fatalf("write child: %v", err)
	}

	packs, err := LoadRulePacks(filepath.Join(root, "*.yaml"))
	if err != nil {
		t.Fatalf("load packs: %v", err)
	}
	var child RulePackManifest
	for _, pack := range packs {
		if pack.Name == "child" {
			child = pack
		}
	}
	if child.Name == "" {
		t.Fatalf("child manifest not found")
	}
	if len(child.Rules) != 2 {
		t.Fatalf("expected inherited+own rules, got %d", len(child.Rules))
	}
}
