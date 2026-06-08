package mcp

import (
	"encoding/json"
	"io"
	"strings"
)

// ParseToolName extracts MCP tool name from JSON-RPC body when possible.
func ParseToolName(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var req struct {
		Method string `json:"method"`
		Params struct {
			Name string `json:"name"`
		} `json:"params"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		return ""
	}
	method := strings.TrimSpace(req.Method)
	if method == "tools/call" {
		return strings.TrimSpace(req.Params.Name)
	}
	if method != "" {
		return method
	}
	return ""
}

// PeekBody reads up to max bytes for tool parsing without consuming the original reader.
func PeekBody(r io.Reader, max int64) ([]byte, error) {
	if max <= 0 {
		max = 1 << 20
	}
	return io.ReadAll(io.LimitReader(r, max))
}
