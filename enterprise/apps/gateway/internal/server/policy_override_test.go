package server

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/config"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

func testEvalContext() policyengine.EvalContext {
	return policyengine.EvalContext{
		TenantID:   "tenant_default",
		UserID:     "user_test",
		DeptIDs:    []string{"*"},
		RoleCodes:  []string{"*"},
		ClientType: "web-portal",
		Stage:      "request",
	}
}

func TestNew_AppliesPolicyOverrideFile(t *testing.T) {
	dir := t.TempDir()
	packDir := filepath.Join(dir, "moderation-test")
	if err := os.MkdirAll(packDir, 0o700); err != nil {
		t.Fatalf("mkdir pack dir: %v", err)
	}
	manifestPath := filepath.Join(packDir, "manifest.yaml")
	if err := os.WriteFile(manifestPath, []byte(`
name: moderation-test
version: 0.1.0
type: rule-pack
description: test pack
rules:
  - id: block-secret
    kind: keyword
    action: block
    severity: high
    message: blocked
    keywords:
      - secret
`), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	overridePath := filepath.Join(dir, "policy-overrides.json")
	if err := os.WriteFile(overridePath, []byte(`{"disabledPacks":["moderation-test"]}`), 0o600); err != nil {
		t.Fatalf("write override: %v", err)
	}
	t.Setenv("GATEWAY_POLICY_OVERRIDE_FILE", overridePath)
	t.Setenv("GATEWAY_QUOTA_CONFIG_FILE", filepath.Join(dir, "quotas.json"))
	t.Setenv("GATEWAY_QUOTA_USAGE_FILE", filepath.Join(dir, "quota-usage.json"))
	t.Setenv("GATEWAY_USAGE_LOG", filepath.Join(dir, "usage.jsonl"))
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", filepath.Join(dir, "providers.json"))

	srv, err := New(config.Config{
		HTTPAddr:       ":0",
		PolicyManifest: filepath.Join(dir, "moderation-*", "manifest.yaml"),
		AuditDir:       filepath.Join(dir, "audit"),
	}, slog.New(slog.NewTextHandler(os.Stderr, nil)))
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}

	result := srv.evaluatePolicy("secret", testEvalContext())
	if result.Blocked {
		t.Fatalf("expected disabled pack not to block request, got hits: %+v", result.Hits)
	}
}

func TestNew_DisabledParentPolicyPackIsNotInheritedByChildPack(t *testing.T) {
	dir := t.TempDir()
	baseDir := filepath.Join(dir, "moderation-base")
	childDir := filepath.Join(dir, "moderation-child")
	if err := os.MkdirAll(baseDir, 0o700); err != nil {
		t.Fatalf("mkdir base dir: %v", err)
	}
	if err := os.MkdirAll(childDir, 0o700); err != nil {
		t.Fatalf("mkdir child dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(baseDir, "manifest.yaml"), []byte(`
name: moderation-base
version: 0.1.0
type: rule-pack
description: base pack
rules:
  - id: block-secret
    kind: keyword
    action: block
    severity: high
    message: blocked
    keywords:
      - secret
`), 0o600); err != nil {
		t.Fatalf("write base manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(childDir, "manifest.yaml"), []byte(`
name: moderation-child
version: 0.1.0
type: rule-pack
description: child pack
extends: moderation-base
rules:
  - id: block-child
    kind: keyword
    action: block
    severity: high
    message: blocked
    keywords:
      - child-only
`), 0o600); err != nil {
		t.Fatalf("write child manifest: %v", err)
	}
	overridePath := filepath.Join(dir, "policy-overrides.json")
	if err := os.WriteFile(overridePath, []byte(`{"disabledPacks":["moderation-base"]}`), 0o600); err != nil {
		t.Fatalf("write override: %v", err)
	}
	t.Setenv("GATEWAY_POLICY_OVERRIDE_FILE", overridePath)
	t.Setenv("GATEWAY_QUOTA_CONFIG_FILE", filepath.Join(dir, "quotas.json"))
	t.Setenv("GATEWAY_QUOTA_USAGE_FILE", filepath.Join(dir, "quota-usage.json"))
	t.Setenv("GATEWAY_USAGE_LOG", filepath.Join(dir, "usage.jsonl"))
	t.Setenv("GATEWAY_ADMIN_PROVIDERS_FILE", filepath.Join(dir, "providers.json"))

	srv, err := New(config.Config{
		HTTPAddr:       ":0",
		PolicyManifest: filepath.Join(dir, "moderation-*", "manifest.yaml"),
		AuditDir:       filepath.Join(dir, "audit"),
	}, slog.New(slog.NewTextHandler(os.Stderr, nil)))
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}

	if result := srv.evaluatePolicy("secret", testEvalContext()); result.Blocked {
		t.Fatalf("expected disabled parent pack not to be inherited, got hits: %+v", result.Hits)
	}
	if result := srv.evaluatePolicy("child-only", testEvalContext()); !result.Blocked {
		t.Fatalf("expected enabled child pack to remain active")
	}
}
