package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/mcphost"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/go-chi/chi/v5"
)

func (s *Server) initMCPHost() {
	if !mcphost.HostingEnabled() {
		return
	}
	s.mcpHost = mcphost.NewHost(s.pgPool, s.logger, s.quotaTracker, s.audit, s.evaluatePolicy)
	s.mcpStreamable = mcphost.StreamableHTTPTransport{}
	s.mcpSSE = mcphost.NewSSETransport()
	s.logger.Info("MCP hosting enabled")
}

func (s *Server) registerMCPRoutes(r chi.Router) {
	if !mcphost.HostingEnabled() || s.mcpHost == nil {
		return
	}
	r.Get("/mcp/registry", s.handleMCPRegistry)
	r.Post("/mcp/{server}/streamable-http", s.handleMCPStreamableHTTP)
	r.Get("/mcp/{server}/sse", s.handleMCPSSE)
	r.Post("/mcp/{server}/messages", s.handleMCPMessages)
}

func (s *Server) handleMCPRegistry(w http.ResponseWriter, r *http.Request) {
	identity, err := s.identityFromRequest(r)
	if err != nil {
		writeMCPAuthError(w, err)
		return
	}
	if s.patVerifier != nil && identity.AuthViaPAT && identity.APITokenID > 0 {
		s.patVerifier.NoteUsed(identity.APITokenID)
	}
	mcpID := toMCPIdentity(identity, r)
	entries, err := s.mcpHost.ListRegistry(r.Context(), mcpID)
	if err != nil {
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	base := externalGatewayBase(r)
	for i := range entries {
		for k, path := range entries[i].Endpoints {
			entries[i].Endpoints[k] = base + path
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    "00000",
		"message": "ok",
		"data":    map[string]any{"servers": entries},
	})
}

func externalGatewayBase(r *http.Request) string {
	if v := strings.TrimSpace(os.Getenv("GATEWAY_PUBLIC_BASE_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (s *Server) handleMCPStreamableHTTP(w http.ResponseWriter, r *http.Request) {
	s.serveMCP(w, r, s.mcpStreamable.Handle)
}

func (s *Server) handleMCPSSE(w http.ResponseWriter, r *http.Request) {
	s.serveMCP(w, r, s.mcpSSE.Handle)
}

func (s *Server) handleMCPMessages(w http.ResponseWriter, r *http.Request) {
	s.serveMCP(w, r, s.mcpSSE.HandleMessages)
}

func (s *Server) serveMCP(w http.ResponseWriter, r *http.Request, fn func(http.ResponseWriter, *http.Request, *mcphost.Host, *mcphost.ServerRecord, mcphost.Identity) error) {
	identity, err := s.identityFromRequest(r)
	if err != nil {
		writeMCPAuthError(w, err)
		return
	}
	if s.patVerifier != nil && identity.AuthViaPAT && identity.APITokenID > 0 {
		s.patVerifier.NoteUsed(identity.APITokenID)
	}
	serverName := chi.URLParam(r, "server")
	rec, err := s.mcpHost.ResolveServer(r.Context(), identity.TenantID, serverName)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "40400", "message": "mcp:server_not_found"})
		return
	}
	if rec.Status != "" && rec.Status != "active" {
		writeJSON(w, http.StatusNotFound, map[string]any{"code": "40400", "message": "mcp:server_disabled"})
		return
	}
	mcpID := toMCPIdentity(identity, r)
	if err := fn(w, r, s.mcpHost, rec, mcpID); err != nil {
		s.logger.Warn("mcp transport error", "server", serverName, "error", err)
	}
}

func toMCPIdentity(id requestIdentity, r *http.Request) mcphost.Identity {
	return mcphost.Identity{
		TenantID:     id.TenantID,
		UserID:       id.UserID,
		UserEmail:    id.UserEmail,
		DepartmentID: id.DepartmentID,
		Scopes:       id.Scopes,
		APITokenID:   id.APITokenID,
		AuthViaPAT:   id.AuthViaPAT,
		ClientIP:     r.RemoteAddr,
	}
}

func writeMCPAuthError(w http.ResponseWriter, err error) {
	msg := err.Error()
	if strings.Contains(msg, "auth:pat") {
		writeAPIError(w, openai.Unauthorized(msg))
		return
	}
	writeAPIError(w, openai.Unauthorized("invalid or missing bearer token"))
}

// writeMCPJSON writes raw MCP JSON-RPC (non-envelope).
func writeMCPJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
