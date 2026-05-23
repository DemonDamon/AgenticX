package mcphost

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/audit"
)

func TestStreamableHTTPDemoEcho(t *testing.T) {
	t.Setenv("GATEWAY_MCP_HOSTING", "on")
	host := NewHost(nil, nil, nil, audit.NewFileWriter(t.TempDir()), nil)
	rec, ok := builtinServer("demo")
	if !ok {
		t.Fatal("demo server missing")
	}
	identity := Identity{
		TenantID: "tenant-a",
		UserID:   "user-a",
		Scopes:   []string{"mcp:*"},
	}
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      "echo",
			"arguments": map[string]any{"message": "hello-mcp"},
		},
	})
	req := httptest.NewRequest(http.MethodPost, "/mcp/demo/streamable-http", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	if err := (StreamableHTTPTransport{}).Handle(w, req, host, rec, identity); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	var resp jsonRPCResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Error != nil {
		t.Fatalf("rpc error: %+v", resp.Error)
	}
}

func TestStreamableHTTPUnauthorizedScopes(t *testing.T) {
	host := NewHost(nil, nil, nil, audit.NewFileWriter(t.TempDir()), nil)
	rec, _ := builtinServer("demo")
	identity := Identity{TenantID: "t", UserID: "u", Scopes: []string{"workspace:chat"}}
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/list",
	})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	w := httptest.NewRecorder()
	_ = (StreamableHTTPTransport{}).Handle(w, req, host, rec, identity)
	var resp jsonRPCResponse
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Error == nil || resp.Error.Code != -32003 {
		t.Fatalf("expected forbidden, got %+v", resp)
	}
}

func TestHostingEnabledEnv(t *testing.T) {
	os.Unsetenv("GATEWAY_MCP_HOSTING")
	if HostingEnabled() {
		t.Fatal("expected disabled by default")
	}
	t.Setenv("GATEWAY_MCP_HOSTING", "on")
	if !HostingEnabled() {
		t.Fatal("expected enabled")
	}
}

func TestDispatchInitialize(t *testing.T) {
	host := NewHost(nil, nil, nil, nil, nil)
	rec, _ := builtinServer("demo")
	resp := host.dispatchRPC(context.Background(), rec, Identity{Scopes: []string{"mcp:*"}}, jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "initialize",
	})
	if resp.Error != nil {
		t.Fatalf("init error: %+v", resp.Error)
	}
}
