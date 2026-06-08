package mcp

import (
	"os"
	"path/filepath"
	"testing"
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
