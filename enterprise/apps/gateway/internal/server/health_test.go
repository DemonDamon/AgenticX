package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	policyengine "github.com/agenticx/enterprise/policy-engine"
)

func TestHandleHealth(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	s.handleHealth(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz status = %d", rec.Code)
	}
}

func TestHandleReadyWithoutDependencies(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	s := &Server{policy: &policyengine.Engine{}}
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	s.handleReady(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("readyz status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRunReadinessChecksSkipsUnsetDeps(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("REDIS_URL", "")
	s := &Server{policy: &policyengine.Engine{}, logger: slog.Default()}
	checks, ready := s.runReadinessChecks(context.Background())
	if !ready {
		t.Fatalf("expected ready without deps, checks=%v", checks)
	}
	if checks["postgres"].Status != "skipped" {
		t.Fatalf("postgres check = %+v", checks["postgres"])
	}
	if checks["database"].Status != "skipped" {
		t.Fatalf("database check = %+v", checks["database"])
	}
	if checks["redis"].Status != "skipped" {
		t.Fatalf("redis check = %+v", checks["redis"])
	}
}

func TestPolicySnapshotReadyMissingFileWithManifest(t *testing.T) {
	s := &Server{
		policy:         &policyengine.Engine{},
		policySnapshot: t.TempDir() + "/missing-snapshot.json",
		policyManifest: "../../plugins/moderation-*/manifest.yaml",
	}
	detail, ok := s.policySnapshotReady()
	if !ok {
		t.Fatalf("expected manifest fallback to pass, detail=%q", detail)
	}
	if detail == "" {
		t.Fatal("expected detail message")
	}
}

func TestPolicySnapshotReadyRemoteURL(t *testing.T) {
	s := &Server{
		policy:         &policyengine.Engine{},
		policySnapshot: "https://admin.example/internal/policy-snapshot.json",
	}
	detail, ok := s.policySnapshotReady()
	if !ok {
		t.Fatalf("remote snapshot should be ready, detail=%q", detail)
	}
}

func TestPolicySnapshotReadyExistingFile(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/policy-snapshot.json"
	if err := os.WriteFile(path, []byte(`{"tenants":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &Server{policy: &policyengine.Engine{}, policySnapshot: path}
	detail, ok := s.policySnapshotReady()
	if !ok {
		t.Fatalf("existing snapshot should be ready, detail=%q", detail)
	}
}

func TestHandleInternalPolicyStatusRequiresToken(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "internal-secret")
	s := &Server{policy: &policyengine.Engine{}}
	req := httptest.NewRequest(http.MethodGet, "/internal/policy-status?tenant_id=tenant-a", nil)
	rec := httptest.NewRecorder()

	s.handleInternalPolicyStatus(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("policy status without token = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandleInternalPolicyStatusReturnsLoadedTenantVersion(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "internal-secret")
	now := time.Now().UTC()
	s := &Server{
		policy:                &policyengine.Engine{},
		policySnapshot:        "https://admin.example/api/internal/policy-snapshot",
		policyRemoteCheckedAt: now,
		policySnapshotStatus: policySnapshotRuntimeStatus{
			UpdatedAt: "2026-08-07T12:00:00Z",
			Tenants: map[string]policySnapshotTenantStatus{
				"tenant-a": {
					TenantID:    "tenant-a",
					Version:     4,
					PublishID:   "publish-4",
					PublishedAt: "2026-08-07T12:00:00Z",
				},
				"tenant-b": {
					TenantID:  "tenant-b",
					Version:   9,
					PublishID: "publish-9",
				},
			},
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/internal/policy-status?tenant_id=tenant-a", nil)
	req.Header.Set("Authorization", "Bearer internal-secret")
	rec := httptest.NewRecorder()

	s.handleInternalPolicyStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("policy status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			Source string                      `json:"source"`
			Tenant *policySnapshotTenantStatus `json:"tenant"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode policy status: %v", err)
	}
	if body.Data.Source != "remote" {
		t.Fatalf("source = %q", body.Data.Source)
	}
	if body.Data.Tenant == nil || body.Data.Tenant.Version != 4 || body.Data.Tenant.PublishID != "publish-4" {
		t.Fatalf("unexpected tenant status: %+v", body.Data.Tenant)
	}
	if strings.Contains(rec.Body.String(), "tenant-b") || strings.Contains(rec.Body.String(), "publish-9") {
		t.Fatalf("policy status leaked another tenant: %s", rec.Body.String())
	}
}
