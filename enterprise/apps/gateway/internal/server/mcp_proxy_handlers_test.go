package server

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/mcp"
	"github.com/agenticx/enterprise/gateway/internal/quota"
)

func TestMCPProxyUnauthorized(t *testing.T) {
	t.Setenv("GATEWAY_MCP_HOSTING", "on")
	reg := mcp.NewRegistry()
	reg.Replace([]mcp.MCPServer{{ID: "x", Enabled: true, UpstreamURL: "http://127.0.0.1:1"}})
	tr := quota.NewTracker("", "", nil)
	s := &Server{
		logger:       slog.Default(),
		quotaTracker: tr,
		mcpProxy:     mcp.NewHandler(reg, tr, nil, slog.Default()),
	}
	r := s.Router()

	req := httptest.NewRequest(http.MethodGet, "/v1/mcp/x/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body %s", w.Code, w.Body.String())
	}
}

func TestMCPProxyRouteAbsentWhenHostingOff(t *testing.T) {
	t.Setenv("GATEWAY_MCP_HOSTING", "off")
	s := &Server{logger: slog.Default()}
	r := s.Router()
	req := httptest.NewRequest(http.MethodGet, "/v1/mcp/x/", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when hosting off, got %d", w.Code)
	}
}
