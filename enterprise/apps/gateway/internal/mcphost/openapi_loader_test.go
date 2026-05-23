package mcphost

import (
	"encoding/json"
	"testing"
)

const petstoreFixture = `{
  "openapi": "3.0.3",
  "servers": [{"url": "https://petstore3.swagger.io/api/v3"}],
  "paths": {
    "/pet/findByStatus": {
      "get": {
        "operationId": "findPetsByStatus",
        "summary": "Finds Pets by status",
        "parameters": [{
          "name": "status",
          "in": "query",
          "required": true,
          "schema": {"type": "string"}
        }]
      }
    },
    "/pet/{petId}": {
      "get": {
        "operationId": "getPetById",
        "summary": "Find pet by ID",
        "parameters": [{
          "name": "petId",
          "in": "path",
          "required": true,
          "schema": {"type": "integer"}
        }]
      }
    }
  }
}`

func TestParseOpenAPISpecPetstore(t *testing.T) {
	spec, err := ParseOpenAPISpec([]byte(petstoreFixture))
	if err != nil {
		t.Fatal(err)
	}
	if spec.BaseURL != "https://petstore3.swagger.io/api/v3" {
		t.Fatalf("base url: %s", spec.BaseURL)
	}
	allowed := map[string]struct{}{"findPetsByStatus": {}}
	tools := spec.Tools(allowed)
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
	if tools[0].Name != "findPetsByStatus" {
		t.Fatalf("tool name %s", tools[0].Name)
	}
	var schema map[string]any
	if err := json.Unmarshal(tools[0].InputSchema, &schema); err != nil {
		t.Fatal(err)
	}
	props, _ := schema["properties"].(map[string]any)
	if props["status"] == nil {
		t.Fatal("expected status property")
	}
}

func TestEchoBackendCallTool(t *testing.T) {
	b := &EchoBackend{}
	res, err := b.CallTool(t.Context(), &ServerRecord{}, "echo", map[string]any{"message": "hi"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Content[0].Text != "hi" {
		t.Fatalf("echo: %q", res.Content[0].Text)
	}
}

func TestScopeInvoke(t *testing.T) {
	scopes := []string{"mcp:server:demo:invoke", "mcp:server:demo:read"}
	if !CanInvokeTool(scopes, "demo", nil, nil) {
		t.Fatal("expected invoke allowed")
	}
	if CanInvokeTool([]string{"mcp:server:demo:read"}, "demo", nil, nil) {
		t.Fatal("read-only should not invoke")
	}
}
