package server

import (
	"os"
	"path/filepath"
	"testing"

	policyengine "github.com/agenticx/enterprise/policy-engine"
)

func TestBuildPolicyEngine_PrefersSnapshotAndFiltersTenant(t *testing.T) {
	dir := t.TempDir()
	manifestDir := filepath.Join(dir, "moderation-fallback")
	if err := os.MkdirAll(manifestDir, 0o700); err != nil {
		t.Fatalf("mkdir fallback: %v", err)
	}
	if err := os.WriteFile(filepath.Join(manifestDir, "manifest.yaml"), []byte(`
name: moderation-fallback
version: 0.1.0
type: rule-pack
rules:
  - id: fallback-rule
    kind: keyword
    action: warn
    severity: low
    message: fallback
    keywords:
      - fallback
`), 0o600); err != nil {
		t.Fatalf("write fallback manifest: %v", err)
	}

	snapshotPath := filepath.Join(dir, "policy-snapshot.json")
	if err := os.WriteFile(snapshotPath, []byte(`{
  "updatedAt": "2026-05-05T00:00:00Z",
  "tenants": {
    "tenant-a": {
      "version": 3,
      "publishId": "publish-3",
      "publishedAt": "2026-05-05T00:00:00Z",
      "packs": [
        {
          "code": "snapshot-pack",
          "name": "snapshot-pack",
          "source": "custom",
          "appliesTo": {
            "version": 1,
            "departmentIds": ["*"],
            "departmentRecursive": true,
            "roleCodes": ["*"],
            "userIds": [],
            "userExcludeIds": [],
            "clientTypes": ["web-portal"],
            "stages": ["request"]
          },
          "rules": [
            {
              "id": "r1",
              "code": "snapshot-block",
              "kind": "keyword",
              "action": "block",
              "severity": "high",
              "message": "blocked",
              "payload": { "keywords": ["secret"] }
            }
          ]
        }
      ]
    }
  }
}`), 0o600); err != nil {
		t.Fatalf("write snapshot: %v", err)
	}

	engine, _, _, _, status, err := buildPolicyEngine(filepath.Join(dir, "moderation-*", "manifest.yaml"), snapshotPath, "")
	if err != nil {
		t.Fatalf("build engine: %v", err)
	}
	tenantStatus, ok := status.Tenants["tenant-a"]
	if !ok {
		t.Fatal("expected tenant-a runtime snapshot status")
	}
	if tenantStatus.Version != 3 || tenantStatus.PublishID != "publish-3" {
		t.Fatalf("unexpected runtime snapshot status: %+v", tenantStatus)
	}

	matched := engine.EvaluateWithContext("contains secret", policyengine.EvalContext{
		TenantID:   "tenant-a",
		UserID:     "u1",
		DeptIDs:    []string{"*"},
		RoleCodes:  []string{"*"},
		ClientType: "web-portal",
		Stage:      "request",
	})
	if !matched.Blocked {
		t.Fatalf("expected tenant-a request to be blocked by snapshot rule")
	}

	otherTenant := engine.EvaluateWithContext("contains secret", policyengine.EvalContext{
		TenantID:   "tenant-b",
		UserID:     "u1",
		DeptIDs:    []string{"*"},
		RoleCodes:  []string{"*"},
		ClientType: "web-portal",
		Stage:      "request",
	})
	if otherTenant.Blocked {
		t.Fatalf("expected tenant mismatch to skip snapshot rule")
	}

	otherStage := engine.EvaluateWithContext("contains secret", policyengine.EvalContext{
		TenantID:   "tenant-a",
		UserID:     "u1",
		DeptIDs:    []string{"*"},
		RoleCodes:  []string{"*"},
		ClientType: "web-portal",
		Stage:      "response",
	})
	if otherStage.Blocked {
		t.Fatalf("expected stage mismatch to skip snapshot rule")
	}

	if err := os.WriteFile(snapshotPath, []byte(`{
  "updatedAt": "2026-05-05T01:00:00Z",
  "tenants": {
    "tenant-a": {
      "version": 4,
      "publishId": "publish-4",
      "publishedAt": "2026-05-05T01:00:00Z",
      "packs": []
    }
  }
}`), 0o600); err != nil {
		t.Fatalf("write empty authoritative snapshot: %v", err)
	}
	emptyEngine, _, _, _, emptyStatus, err := buildPolicyEngine(filepath.Join(dir, "moderation-*", "manifest.yaml"), snapshotPath, "")
	if err != nil {
		t.Fatalf("build empty authoritative snapshot: %v", err)
	}
	if emptyStatus.Tenants["tenant-a"].PublishID != "publish-4" {
		t.Fatalf("unexpected empty snapshot status: %+v", emptyStatus.Tenants["tenant-a"])
	}
	fallbackResult := emptyEngine.EvaluateWithContext("fallback", policyengine.EvalContext{
		TenantID:   "tenant-a",
		UserID:     "u1",
		DeptIDs:    []string{"*"},
		RoleCodes:  []string{"*"},
		ClientType: "web-portal",
		Stage:      "request",
	})
	if len(fallbackResult.Hits) != 0 {
		t.Fatalf("empty published snapshot must not resurrect fallback manifests: %+v", fallbackResult.Hits)
	}
}
