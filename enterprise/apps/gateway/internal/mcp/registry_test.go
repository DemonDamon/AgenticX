package mcp

import (
	"testing"
)

func TestRegistryReplaceAndGet(t *testing.T) {
	reg := NewRegistry()
	reg.Replace([]MCPServer{
		{ID: "a", Name: "Alpha", UpstreamURL: "https://example.com/mcp", Enabled: true},
		{ID: "b", Name: "Beta", Enabled: false},
	})
	if _, ok := reg.Get("a"); !ok {
		t.Fatal("expected server a")
	}
	if s, ok := reg.Get("b"); !ok || s.Name != "Beta" {
		t.Fatal("expected server b")
	}
	if _, ok := reg.Get("missing"); ok {
		t.Fatal("unexpected server")
	}
	list := reg.List()
	if len(list) != 2 {
		t.Fatalf("list len %d", len(list))
	}
}
