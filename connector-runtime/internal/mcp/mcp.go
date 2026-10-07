// Package mcp 实现 MCP 工具面的 JSON-RPC 2.0 协议层（无状态 Streamable HTTP）：
// 协议信封在此，5 个发现型工具的调度逻辑复用公共 api.Tools（与企业网关内嵌
// 形态共享同一核心）。
package mcp

import (
	"context"
	"encoding/json"

	"github.com/agenticx/connector-runtime/api"
	"github.com/agenticx/connector-runtime/internal/audit"
	"github.com/agenticx/connector-runtime/internal/catalog"
	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/executor"
	"github.com/agenticx/connector-runtime/internal/policy"
)

// 协议版本：客户端请求的版本受支持则回显，否则回落到最新支持版本。
const (
	latestProtocolVersion = "2025-06-18"
	serverName            = "connector-runtime"
)

var supportedProtocolVersions = map[string]bool{
	"2024-11-05": true,
	"2025-03-26": true,
	"2025-06-18": true,
}

// JSON-RPC 错误码。
const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
)

// request / response（JSON-RPC 2.0）。
type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

// Outcome 单次 MCP 请求的处理结果（供 HTTP 层写回）。
type Outcome struct {
	Status int // 200 / 202 / 400
	Body   any // nil 表示空 body（202）
}

// Server MCP 工具面（JSON-RPC 协议层）。
type Server struct {
	tools *api.Tools
}

// New 构造 MCP 面：具体存储为本地文件形态，经 api 缝隙注入。
func New(cat *catalog.Store, conns *connection.Store, pol *policy.Policy, exec *executor.Executor, aud *audit.Logger) *Server {
	return &Server{tools: api.NewTools(cat, conns, pol, exec, aud)}
}

// Handle 处理一条 JSON-RPC 报文。
func (s *Server) Handle(ctx context.Context, raw []byte) Outcome {
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		return Outcome{Status: 400, Body: errResponse(nil, codeParseError, "报文解析失败")}
	}
	if req.JSONRPC != "2.0" || req.Method == "" {
		return Outcome{Status: 400, Body: errResponse(req.ID, codeInvalidRequest, "非法 JSON-RPC 请求")}
	}
	// JSON-RPC 语义：通知（无 id）一律不回 body
	if len(req.ID) == 0 || string(req.ID) == "null" {
		return Outcome{Status: 202}
	}

	switch req.Method {
	case "initialize":
		return Outcome{Status: 200, Body: okResponse(req.ID, s.initialize(req.Params))}
	case "ping":
		return Outcome{Status: 200, Body: okResponse(req.ID, map[string]any{})}
	case "tools/list":
		return Outcome{Status: 200, Body: okResponse(req.ID, map[string]any{"tools": api.Definitions()})}
	case "tools/call":
		res, rpcErr := s.toolsCall(ctx, req.Params)
		if rpcErr != nil {
			return Outcome{Status: 200, Body: errResponse(req.ID, rpcErr.code, rpcErr.msg)}
		}
		return Outcome{Status: 200, Body: okResponse(req.ID, res)}
	default:
		return Outcome{Status: 200, Body: errResponse(req.ID, codeMethodNotFound, "方法不存在: "+req.Method)}
	}
}

func (s *Server) initialize(params json.RawMessage) map[string]any {
	version := latestProtocolVersion
	var p struct {
		ProtocolVersion string `json:"protocolVersion"`
	}
	if len(params) > 0 {
		_ = json.Unmarshal(params, &p)
	}
	if supportedProtocolVersions[p.ProtocolVersion] {
		version = p.ProtocolVersion
	}
	return map[string]any{
		"protocolVersion": version,
		"capabilities":    map[string]any{"tools": map[string]any{}},
		"serverInfo":      map[string]any{"name": serverName, "version": Version},
	}
}

type rpcErrorValue struct {
	code int
	msg  string
}

func (s *Server) toolsCall(ctx context.Context, params json.RawMessage) (any, *rpcErrorValue) {
	var p struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, &rpcErrorValue{codeInvalidRequest, "params 解析失败"}
	}
	args := map[string]any{}
	if len(p.Arguments) > 0 {
		if err := json.Unmarshal(p.Arguments, &args); err != nil {
			return nil, &rpcErrorValue{codeInvalidParams, "arguments 须为对象"}
		}
	}
	res, perr := s.tools.Call(ctx, p.Name, args)
	if perr != nil {
		return nil, &rpcErrorValue{perr.Code, perr.Message}
	}
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": res.Text}},
		"isError": res.IsError,
	}, nil
}

func okResponse(id json.RawMessage, result any) *response {
	return &response{JSONRPC: "2.0", ID: id, Result: result}
}

func errResponse(id json.RawMessage, code int, msg string) *response {
	return &response{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: msg}}
}

// Version 由构建注入（cmd 层设置）。
var Version = "0.1.0"
