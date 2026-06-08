package server

import (
	"context"
	"net/http"

	"github.com/agenticx/enterprise/gateway/internal/mcp"
	"github.com/go-chi/chi/v5"
)

func (s *Server) initMCPProxy() {
	if !mcp.HostingEnabled() {
		return
	}
	reg := mcp.NewRegistry()
	s.mcpRegistry = reg
	s.mcpLoader = mcp.NewLoader(s.logger, reg)
	s.mcpLoader.Start(context.Background())
	s.mcpProxy = mcp.NewHandler(reg, s.quotaTracker, s.audit, s.logger)
	s.logger.Info("MCP upstream proxy enabled", "config", s.mcpLoader.Path())
}

func (s *Server) registerMCPProxyRoutes(r chi.Router) {
	if !mcp.HostingEnabled() || s.mcpProxy == nil {
		return
	}
	r.Handle("/v1/mcp/{server_id}/*", http.HandlerFunc(s.handleMCPProxy))
}

func (s *Server) handleMCPProxy(w http.ResponseWriter, r *http.Request) {
	identity, err := s.identityFromRequest(r)
	if err != nil {
		writeMCPAuthError(w, err)
		return
	}
	if s.patVerifier != nil && identity.AuthViaPAT && identity.APITokenID > 0 {
		s.patVerifier.NoteUsed(identity.APITokenID)
	}
	ctx := mcp.WithIdentity(r.Context(), mcp.CallerIdentity{
		TenantID:     identity.TenantID,
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		SessionID:    identity.SessionID,
		APITokenID:   identity.APITokenID,
		AuthViaPAT:   identity.AuthViaPAT,
		ClientIP:     r.RemoteAddr,
	})
	s.mcpProxy.ServeHTTP(w, r.WithContext(ctx))
}
