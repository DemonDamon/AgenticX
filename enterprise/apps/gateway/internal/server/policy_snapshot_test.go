package server

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/configstatus"
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

const publishedKeepSnapshot = `{
  "updatedAt": "2026-11-09T00:00:00Z",
  "tenants": {
    "tenant-a": {
      "version": 3,
      "publishId": "pub-keep",
      "publishedAt": "2026-11-09T00:00:00Z",
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
              "payload": { "keywords": ["marker-word"] }
            }
          ]
        }
      ]
    }
  }
}`

func writeFallbackManifest(t *testing.T, dir string) string {
	t.Helper()
	manifestDir := filepath.Join(dir, "moderation-fallback")
	if err := os.MkdirAll(manifestDir, 0o700); err != nil {
		t.Fatal(err)
	}
	body := []byte(`
name: moderation-fallback
version: 0.1.0
type: rule-pack
rules:
  - id: fallback-rule
    kind: keyword
    action: block
    severity: low
    message: fallback
    keywords:
      - fallback-marker
`)
	if err := os.WriteFile(filepath.Join(manifestDir, "manifest.yaml"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "moderation-*", "manifest.yaml")
}

func policyHit(engine *policyengine.Engine, text string) bool {
	result := engine.EvaluateWithContext(text, policyengine.EvalContext{
		TenantID:   "tenant-a",
		UserID:     "u1",
		DeptIDs:    []string{"*"},
		RoleCodes:  []string{"*"},
		ClientType: "web-portal",
		Stage:      "request",
	})
	return result.Blocked
}

func policyDomain(t *testing.T, status *configstatus.Registry) configstatus.Outcome {
	t.Helper()
	for _, item := range status.Snapshot() {
		if item.Domain == configstatus.DomainPolicy {
			return item
		}
	}
	t.Fatal("missing policy domain")
	return configstatus.Outcome{}
}

func TestReloadPolicyKeepsSnapshotOnInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	manifest := writeFallbackManifest(t, dir)
	snapshotPath := filepath.Join(dir, "policy-snapshot.json")
	if err := os.WriteFile(snapshotPath, []byte(publishedKeepSnapshot), 0o600); err != nil {
		t.Fatal(err)
	}
	status := configstatus.NewRegistry(nil)
	s := &Server{
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		policyManifest: manifest,
		policySnapshot: snapshotPath,
		configStatus:   status,
	}
	s.reloadPolicyIfNeeded()
	if !policyHit(s.policy, "marker-word") {
		t.Fatal("expected published rule to block")
	}
	if policyHit(s.policy, "fallback-marker") {
		t.Fatal("published snapshot must not use the builtin pack")
	}
	if err := os.WriteFile(snapshotPath, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(snapshotPath, future, future); err != nil {
		t.Fatal(err)
	}
	s.reloadPolicyIfNeeded()
	if !policyHit(s.policy, "marker-word") {
		t.Fatal("invalid json replaced the published snapshot")
	}
	if policyHit(s.policy, "fallback-marker") {
		t.Fatal("invalid json fell back to the builtin pack")
	}
	got := policyDomain(t, status)
	if got.LastError == "" {
		t.Fatal("expected LastError")
	}
	if !strings.Contains(got.Version, "pub-keep") {
		t.Fatalf("version = %q", got.Version)
	}
}

func TestReloadPolicyKeepsPublishedSnapshotOnRemote404(t *testing.T) {
	dir := t.TempDir()
	manifest := writeFallbackManifest(t, dir)
	var missing bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if missing {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(publishedKeepSnapshot))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_POLICY_REMOTE_RELOAD_INTERVAL", "0")

	engine, mod, hash, overrideMod, snapStatus, err := buildPolicyEngine(manifest, srv.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	status := configstatus.NewRegistry(nil)
	s := &Server{
		logger:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		policy:               engine,
		policyManifest:       manifest,
		policySnapshot:       srv.URL,
		policySnapshotMod:    mod,
		policyOverrideMod:    overrideMod,
		policySnapBodyHash:   hash,
		policySnapshotStatus: snapStatus,
		configStatus:         status,
	}
	if !policyHit(s.policy, "marker-word") {
		t.Fatal("expected published rule before 404")
	}
	missing = true
	s.reloadPolicyIfNeeded()
	if !policyHit(s.policy, "marker-word") {
		t.Fatal("remote 404 replaced the published snapshot")
	}
	if policyHit(s.policy, "fallback-marker") {
		t.Fatal("remote 404 fell back to the builtin pack")
	}
	if !strings.Contains(policyDomain(t, status).LastError, "remote 404") {
		t.Fatalf("LastError = %q", policyDomain(t, status).LastError)
	}
}

func TestReloadPolicyRemote404BeforePublishUsesBuiltin(t *testing.T) {
	dir := t.TempDir()
	manifest := writeFallbackManifest(t, dir)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_POLICY_REMOTE_RELOAD_INTERVAL", "0")

	engine, mod, hash, overrideMod, snapStatus, err := buildPolicyEngine(manifest, srv.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	status := configstatus.NewRegistry(nil)
	s := &Server{
		logger:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		policy:               engine,
		policyManifest:       manifest,
		policySnapshot:       srv.URL,
		policySnapshotMod:    mod,
		policyOverrideMod:    overrideMod,
		policySnapBodyHash:   hash,
		policySnapshotStatus: snapStatus,
		configStatus:         status,
	}
	s.reloadPolicyIfNeeded()
	if !policyHit(s.policy, "fallback-marker") {
		t.Fatal("expected builtin pack when a snapshot was never loaded")
	}
	if strings.Contains(policyLastError(status), "remote 404") {
		t.Fatalf("never-loaded 404 should keep the builtin fallback, LastError=%q", policyLastError(status))
	}
}

func policyLastError(status *configstatus.Registry) string {
	for _, item := range status.Snapshot() {
		if item.Domain == configstatus.DomainPolicy {
			return item.LastError
		}
	}
	return ""
}
