package server

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

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
