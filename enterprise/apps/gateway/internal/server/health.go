package server

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

type readinessCheck struct {
	Status  string `json:"status"`
	Detail  string `json:"detail,omitempty"`
	Skipped bool   `json:"skipped,omitempty"`
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    "00000",
		"message": "ok",
		"data": map[string]any{
			"service": "agenticx-gateway",
			"status":  "healthy",
			"time":    time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	checks, ready := s.runReadinessChecks(ctx)
	statusCode := http.StatusOK
	overall := "ready"
	if !ready {
		statusCode = http.StatusServiceUnavailable
		overall = "not_ready"
	}
	writeJSON(w, statusCode, map[string]any{
		"code":    "00000",
		"message": overall,
		"data": map[string]any{
			"service": "agenticx-gateway",
			"status":  overall,
			"checks":  checks,
			"time":    time.Now().UTC().Format(time.RFC3339),
		},
	})
}

func (s *Server) runReadinessChecks(ctx context.Context) (map[string]readinessCheck, bool) {
	checks := make(map[string]readinessCheck)
	ready := true

	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	dialect := strings.TrimSpace(os.Getenv("DATABASE_DIALECT"))
	if dialect == "" {
		dialect = "postgresql"
	}
	if dbURL == "" {
		checks["database"] = readinessCheck{Status: "skipped", Skipped: true, Detail: "DATABASE_URL unset"}
		checks["postgres"] = readinessCheck{Status: "skipped", Skipped: true, Detail: "DATABASE_URL unset"}
	} else if s.database == nil {
		checks["database"] = readinessCheck{Status: "fail", Detail: "handle unavailable"}
		checks["postgres"] = readinessCheck{Status: "fail", Detail: "handle unavailable"}
		ready = false
	} else if err := s.database.Ping(ctx); err != nil {
		checks["database"] = readinessCheck{Status: "fail", Detail: err.Error()}
		checks["postgres"] = readinessCheck{Status: "fail", Detail: err.Error()}
		ready = false
	} else {
		detail := "dialect=" + string(s.database.Dialect)
		if detail == "dialect=" {
			detail = "dialect=" + dialect
		}
		checks["database"] = readinessCheck{Status: "ok", Detail: detail}
		checks["postgres"] = readinessCheck{Status: "ok", Detail: "deprecated; use database"}
	}

	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		checks["redis"] = readinessCheck{Status: "skipped", Skipped: true, Detail: "REDIS_URL unset"}
	} else if s.redisStore == nil {
		checks["redis"] = readinessCheck{Status: "fail", Detail: "redis store unavailable"}
		ready = false
	} else if err := s.redisStore.Ping(ctx); err != nil {
		checks["redis"] = readinessCheck{Status: "fail", Detail: err.Error()}
		ready = false
	} else {
		checks["redis"] = readinessCheck{Status: "ok"}
	}

	if s.policy == nil {
		checks["policy"] = readinessCheck{Status: "fail", Detail: "policy engine not loaded"}
		ready = false
	} else if detail, ok := s.policySnapshotReady(); !ok {
		checks["policy"] = readinessCheck{Status: "fail", Detail: detail}
		ready = false
	} else {
		checks["policy"] = readinessCheck{Status: "ok", Detail: detail}
	}

	return checks, ready
}

func (s *Server) policySnapshotReady() (string, bool) {
	if s == nil {
		return "server nil", false
	}
	snap := strings.TrimSpace(s.policySnapshot)
	if snap == "" {
		return "manifest fallback", true
	}
	if gatewayinternal.IsHTTPURL(snap) {
		return "remote snapshot configured", true
	}
	info, err := os.Stat(snap)
	if err != nil {
		if os.IsNotExist(err) {
			if strings.TrimSpace(s.policyManifest) != "" {
				return "snapshot missing; manifest fallback", true
			}
			return "snapshot file missing: " + snap, false
		}
		return err.Error(), false
	}
	if info.IsDir() {
		return "snapshot path is directory", false
	}
	return snap, true
}
