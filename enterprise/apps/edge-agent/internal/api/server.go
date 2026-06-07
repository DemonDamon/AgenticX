package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/agenticx/enterprise/edge-agent/internal/runner"
	"github.com/agenticx/enterprise/edge-agent/internal/trace"
)

type Server struct {
	runner *runner.Runner
	store  *trace.Store
	token  string
}

func NewServer(r *runner.Runner, store *trace.Store, token string) *Server {
	return &Server{runner: r, store: store, token: strings.TrimSpace(token)}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /v1/tasks/run", s.handleRunTask)
	mux.HandleFunc("GET /v1/traces", s.handleListTraces)
	mux.HandleFunc("GET /v1/traces/{id}", s.handleGetTrace)
	return s.authMiddleware(mux)
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.token == "" || r.URL.Path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		auth := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.EqualFold(auth, "Bearer "+s.token) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "time": time.Now().UTC().Format(time.RFC3339)})
}

func (s *Server) handleRunTask(w http.ResponseWriter, r *http.Request) {
	var req runner.RunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json"})
		return
	}
	result, err := s.runner.Run(r.Context(), req)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleListTraces(w http.ResponseWriter, _ *http.Request) {
	ids, err := s.store.ListTraceIDs(100)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"trace_ids": ids})
}

func (s *Server) handleGetTrace(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "trace id required"})
		return
	}
	tr, ok, err := s.store.GetTrace(id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "trace not found"})
		return
	}
	writeJSON(w, http.StatusOK, tr)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
