package mcp

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/configstatus"
)

func TestLoaderReloadFromFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mcp-servers.json")
	if err := os.WriteFile(path, []byte(`{"servers":[{"id":"s1","name":"One","upstreamUrl":"http://127.0.0.1:9","enabled":true}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_MCP_SERVERS_FILE", path)
	t.Setenv("GATEWAY_REMOTE_MCP_SERVERS_URL", "")

	reg := NewRegistry()
	loader := NewLoader(nil, reg)
	if err := loader.reload(); err != nil {
		t.Fatal(err)
	}
	if _, ok := reg.Get("s1"); !ok {
		t.Fatal("expected s1")
	}
}

func TestReloadKeepsMCPServersOnInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mcp-servers.json")
	body := []byte(`{"servers":[{"id":"s-keep","name":"One","upstreamUrl":"http://127.0.0.1:9","enabled":true}]}`)
	if err := os.WriteFile(path, body, 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_MCP_SERVERS_FILE", path)
	t.Setenv("GATEWAY_REMOTE_MCP_SERVERS_URL", "")
	status := configstatus.NewRegistry(nil)
	reg := NewRegistry()
	loader := NewLoader(nil, reg)
	loader.SetConfigStatus(status)
	if err := loader.reload(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := loader.reload(); err == nil {
		t.Fatal("expected parse error")
	}
	if _, ok := reg.Get("s-keep"); !ok {
		t.Fatal("invalid json cleared the last snapshot")
	}
	if mcpLastError(t, status) == "" {
		t.Fatal("expected LastError")
	}
}

func TestReloadKeepsMCPServersOnRemote404(t *testing.T) {
	var hits atomic.Int32
	good := []byte(`{"servers":[{"id":"s-keep","name":"One","upstreamUrl":"http://127.0.0.1:9","enabled":true}]}`)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if hits.Add(1) == 1 {
			_, _ = w.Write(good)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GATEWAY_REMOTE_MCP_SERVERS_URL", srv.URL)
	t.Setenv("GATEWAY_MCP_SERVERS_FILE", "")
	status := configstatus.NewRegistry(nil)
	reg := NewRegistry()
	loader := NewLoader(nil, reg)
	loader.SetConfigStatus(status)
	if err := loader.reload(); err != nil {
		t.Fatal(err)
	}
	err := loader.reload()
	if err == nil || !strings.Contains(err.Error(), "remote 404") {
		t.Fatalf("reload err = %v", err)
	}
	if _, ok := reg.Get("s-keep"); !ok {
		t.Fatal("remote 404 cleared the last snapshot")
	}
	if !strings.Contains(mcpLastError(t, status), "remote 404") {
		t.Fatalf("LastError = %q", mcpLastError(t, status))
	}
}

func mcpLastError(t *testing.T, status *configstatus.Registry) string {
	t.Helper()
	for _, item := range status.Snapshot() {
		if item.Domain == configstatus.DomainMCPServers {
			return item.LastError
		}
	}
	t.Fatal("missing mcp_servers domain")
	return ""
}
