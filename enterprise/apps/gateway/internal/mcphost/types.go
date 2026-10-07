package mcphost

import (
	"context"
	"encoding/json"
	"net/http"
)

// Tool is an MCP tool definition exposed by a hosted server.
type Tool struct {
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	InputSchema  json.RawMessage `json:"inputSchema"`
	OutputSchema json.RawMessage `json:"outputSchema,omitempty"`
	Enabled      bool            `json:"-"`
	Metadata     map[string]any  `json:"-"`
}

// CallResult is the MCP tools/call result payload.
type CallResult struct {
	Content []ContentBlock `json:"content"`
	IsError bool           `json:"isError,omitempty"`
	// Metadata 携带 backend → 审计链路的维度信息（连接器执行 id/动作/连接），
	// 不参与 MCP 序列化。
	Metadata map[string]any `json:"-"`
}

type ContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// ServerRecord is the resolved MCP server configuration.
type ServerRecord struct {
	ID              string
	TenantID        string
	Name            string
	DisplayName     string
	Transport       string
	BackendType     string
	BackendConfig   map[string]any
	RequiredScopes  []string
	Status          string
	ToolCallsPerMin int
	Tools           []Tool
	Builtin         bool
}

// Backend executes tool calls for a hosted MCP server.
type Backend interface {
	Name() string
	ListTools(ctx context.Context, rec *ServerRecord) ([]Tool, error)
	CallTool(ctx context.Context, rec *ServerRecord, name string, args map[string]any) (CallResult, error)
}

// Transport serves MCP protocol over a wire format.
type Transport interface {
	Name() string
	Handle(w http.ResponseWriter, r *http.Request, host *Host, rec *ServerRecord, identity Identity) error
}

// Identity is the authenticated caller for MCP requests.
type Identity struct {
	TenantID     string
	UserID       string
	UserEmail    string
	DepartmentID string
	Scopes       []string
	APITokenID   int64
	AuthViaPAT   bool
	ClientIP     string
}
