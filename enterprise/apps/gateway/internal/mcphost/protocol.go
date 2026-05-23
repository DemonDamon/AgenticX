package mcphost

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      any       `json:"id,omitempty"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

type toolsCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

func parseJSONRPC(raw []byte) (jsonRPCRequest, error) {
	var req jsonRPCRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return req, err
	}
	if req.JSONRPC == "" {
		req.JSONRPC = "2.0"
	}
	return req, nil
}

func rpcOK(id any, result any) jsonRPCResponse {
	return jsonRPCResponse{JSONRPC: "2.0", ID: id, Result: result}
}

func rpcErr(id any, code int, msg string) jsonRPCResponse {
	return jsonRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error:   &rpcError{Code: code, Message: msg},
	}
}

func handleInitialize(id any, _ json.RawMessage) jsonRPCResponse {
	return rpcOK(id, map[string]any{
		"protocolVersion": "2024-11-05",
		"capabilities": map[string]any{
			"tools":     map[string]any{"listChanged": false},
			"prompts":   map[string]any{"listChanged": false},
			"resources": map[string]any{"listChanged": false},
		},
		"serverInfo": map[string]any{
			"name":    "agenticx-gateway-mcp",
			"version": "1.0.0",
		},
	})
}

func (h *Host) dispatchRPC(ctx context.Context, rec *ServerRecord, identity Identity, req jsonRPCRequest) jsonRPCResponse {
	switch req.Method {
	case "initialize":
		return handleInitialize(req.ID, req.Params)
	case "ping":
		return rpcOK(req.ID, map[string]any{})
	case "notifications/initialized":
		return jsonRPCResponse{JSONRPC: "2.0"}
	case "tools/list":
		if !CanListTools(identity.Scopes, rec.Name, rec.RequiredScopes) {
			return rpcErr(req.ID, -32003, "mcp:forbidden: missing read scope")
		}
		tools, err := h.listTools(ctx, rec)
		if err != nil {
			return rpcErr(req.ID, -32603, err.Error())
		}
		items := make([]map[string]any, 0, len(tools))
		for _, t := range tools {
			item := map[string]any{
				"name":        t.Name,
				"description": t.Description,
				"inputSchema": json.RawMessage(t.InputSchema),
			}
			items = append(items, item)
		}
		return rpcOK(req.ID, map[string]any{"tools": items})
	case "tools/call":
		var params toolsCallParams
		if len(req.Params) > 0 {
			_ = json.Unmarshal(req.Params, &params)
		}
		if strings.TrimSpace(params.Name) == "" {
			return rpcErr(req.ID, -32602, "tools/call: name required")
		}
		toolMeta := h.toolMetadata(rec, params.Name)
		if !CanInvokeTool(identity.Scopes, rec.Name, rec.RequiredScopes, toolMeta) {
			return rpcErr(req.ID, -32003, "mcp:forbidden: missing invoke scope")
		}
		result, status, err := h.invokeTool(ctx, rec, identity, params.Name, params.Arguments)
		if err != nil {
			if status == "rate_limited" {
				return rpcErr(req.ID, -32029, "mcp:rate_limited")
			}
			return rpcErr(req.ID, -32603, err.Error())
		}
		return rpcOK(req.ID, result)
	case "prompts/list":
		return rpcOK(req.ID, map[string]any{"prompts": []any{}})
	case "resources/list":
		return rpcOK(req.ID, map[string]any{"resources": []any{}})
	default:
		return rpcErr(req.ID, -32601, fmt.Sprintf("method not found: %s", req.Method))
	}
}
