package mcp

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/go-chi/chi/v5"
)

func TestHandlerProxyForwardsRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer upstream-token" {
			t.Fatalf("missing upstream auth: %q", r.Header.Get("Authorization"))
		}
		if r.URL.Path != "/mcp/v1/messages" {
			t.Fatalf("path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	reg := NewRegistry()
	reg.Replace([]MCPServer{{
		ID:          "demo",
		Name:        "Demo",
		UpstreamURL: upstream.URL + "/mcp",
		AuthHeader:  "Authorization: Bearer upstream-token",
		Enabled:     true,
	}})
	h := NewHandler(reg, nil, audit.NewFileWriter(t.TempDir()), nil)

	r := chi.NewRouter()
	r.Handle("/v1/mcp/{server_id}/*", h)
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{}}}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/mcp/demo/v1/messages", bytes.NewReader(body))
	req = req.WithContext(WithIdentity(req.Context(), CallerIdentity{TenantID: "t1", UserID: "u1"}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
}

func TestHandlerNotFoundWhenDisabled(t *testing.T) {
	reg := NewRegistry()
	reg.Replace([]MCPServer{{ID: "off", Enabled: false, UpstreamURL: "http://127.0.0.1:1"}})
	h := NewHandler(reg, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/v1/mcp/off/", nil)
	req = req.WithContext(WithIdentity(req.Context(), CallerIdentity{}))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("server_id", "off")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d", w.Code)
	}
}

func TestHandlerRateLimited(t *testing.T) {
	reg := NewRegistry()
	reg.Replace([]MCPServer{{
		ID:            "lim",
		Enabled:       true,
		UpstreamURL:   "http://127.0.0.1:1",
		ToolRateLimit: 2,
	}})
	tr := quota.NewTracker("", "", nil)
	h := NewHandler(reg, tr, audit.NewFileWriter(t.TempDir()), nil)
	id := CallerIdentity{TenantID: "t", UserID: "u-rate"}
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/", io.NopCloser(bytes.NewReader([]byte(`{}`))))
		req = req.WithContext(WithIdentity(req.Context(), id))
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("server_id", "lim")
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("unexpected 429 on call %d", i+1)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/", io.NopCloser(bytes.NewReader([]byte(`{}`))))
	req = req.WithContext(WithIdentity(req.Context(), id))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("server_id", "lim")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w.Code)
	}
}

func TestHostingEnabledDefaultOff(t *testing.T) {
	t.Setenv("GATEWAY_MCP_HOSTING", "")
	if HostingEnabled() {
		t.Fatal("expected off")
	}
	t.Setenv("GATEWAY_MCP_HOSTING", "on")
	if !HostingEnabled() {
		t.Fatal("expected on")
	}
}
