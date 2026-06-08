package mcp

import "testing"

func TestParseToolName(t *testing.T) {
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{}}}`)
	if got := ParseToolName(body); got != "search" {
		t.Fatalf("got %q", got)
	}
}

func TestParseToolNameMethodFallback(t *testing.T) {
	body := []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize"}`)
	if got := ParseToolName(body); got != "initialize" {
		t.Fatalf("got %q", got)
	}
}
