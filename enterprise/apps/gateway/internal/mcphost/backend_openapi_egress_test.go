package mcphost

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/egress"
)

const pingOpenAPI = `{"openapi":"3.0.3","paths":{"/ping":{"get":{"operationId":"ping"}}}}`

type memAudit struct {
	mu     sync.Mutex
	events []audit.Event
}

func (m *memAudit) Write(ev *audit.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if ev != nil {
		m.events = append(m.events, *ev)
	}
	return nil
}

func (m *memAudit) hasStatus(status string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ev := range m.events {
		if ev.MCPStatus == status {
			return true
		}
	}
	return false
}

func newLoopbackServer(t *testing.T, h http.Handler) *httptest.Server {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewUnstartedServer(h)
	srv.Listener = ln
	srv.Start()
	return srv
}

func TestOpenAPIEgressAuditAllowsLoopback(t *testing.T) {
	t.Setenv("GATEWAY_EGRESS_GUARD_MODE", "audit")
	t.Setenv("GATEWAY_EGRESS_ALLOWLIST", "")
	var hits int
	srv := newLoopbackServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	var got egress.Decision
	var called bool
	aw := &memAudit{}
	b := NewOpenAPIBackend()
	b.SetDecisionHook(func(d egress.Decision) {
		called = true
		got = d
	})
	b.SetAuditWriter(aw)

	res, err := b.CallTool(context.Background(), pingRecord(srv.URL), "ping", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("unexpected error result: %+v", res)
	}
	if len(res.Content) == 0 || !strings.Contains(res.Content[0].Text, "ok") {
		t.Fatalf("body %+v", res.Content)
	}
	if hits != 1 {
		t.Fatalf("upstream hits %d", hits)
	}
	if !called || !got.WouldBlock || got.Blocked {
		t.Fatalf("decision called=%v %+v", called, got)
	}
	if !aw.hasStatus("egress_would_block") {
		t.Fatalf("audit events %+v", aw.events)
	}
}

func TestOpenAPIEgressEnforceBlocksLoopback(t *testing.T) {
	t.Setenv("GATEWAY_EGRESS_GUARD_MODE", "enforce")
	t.Setenv("GATEWAY_EGRESS_ALLOWLIST", "")
	var hits int
	srv := newLoopbackServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	b := NewOpenAPIBackend()
	res, err := b.CallTool(context.Background(), pingRecord(srv.URL), "ping", nil)
	if err != nil {
		t.Fatalf("CallTool error = %v, want nil with IsError text", err)
	}
	if !res.IsError || len(res.Content) == 0 || !strings.Contains(res.Content[0].Text, "egress:forbidden") {
		t.Fatalf("result %+v", res)
	}
	if hits != 0 {
		t.Fatalf("upstream hits %d, want 0", hits)
	}
}

func TestOpenAPIEgressEnforceAllowlistPermitsLoopback(t *testing.T) {
	t.Setenv("GATEWAY_EGRESS_GUARD_MODE", "enforce")
	t.Setenv("GATEWAY_EGRESS_ALLOWLIST", "127.0.0.1/32")
	srv := newLoopbackServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	called := false
	b := NewOpenAPIBackend()
	b.SetDecisionHook(func(d egress.Decision) { called = true })
	res, err := b.CallTool(context.Background(), pingRecord(srv.URL), "ping", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("unexpected error result: %+v", res)
	}
	if called {
		t.Fatal("allowlisted dial should not callback")
	}
}

func TestNewHostOpenAPIWritesEgressAudit(t *testing.T) {
	t.Setenv("GATEWAY_EGRESS_GUARD_MODE", "audit")
	t.Setenv("GATEWAY_EGRESS_ALLOWLIST", "")
	srv := newLoopbackServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	aw := &memAudit{}
	host := NewHost(nil, nil, nil, aw, nil)
	backend, ok := host.backends[BackendOpenAPI].(*OpenAPIBackend)
	if !ok || backend == nil || backend.audit == nil {
		t.Fatal("OpenAPI backend was not given the host audit writer")
	}
	res, err := backend.CallTool(context.Background(), pingRecord(srv.URL), "ping", nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.IsError {
		t.Fatalf("unexpected error result: %+v", res)
	}
	if !aw.hasStatus("egress_would_block") {
		t.Fatalf("audit events %+v", aw.events)
	}
}

func pingRecord(baseURL string) *ServerRecord {
	return &ServerRecord{
		Name: "pet",
		BackendConfig: map[string]any{
			"base_url":     baseURL,
			"openapi_json": pingOpenAPI,
		},
	}
}
