// Package mcp 实现 MCP 工具面：无状态 Streamable HTTP 上的 JSON-RPC 2.0，
// 固定 5 个发现型工具（list_apps / list_connections / search_actions /
// get_action_guide / execute_action），以「搜索-发现-执行」收纳任意规模动作目录。
package mcp

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"github.com/agenticx/connector-runtime/internal/audit"
	"github.com/agenticx/connector-runtime/internal/catalog"
	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/executor"
	"github.com/agenticx/connector-runtime/internal/model"
	"github.com/agenticx/connector-runtime/internal/policy"
)

// 协议版本：客户端请求的版本受支持则回显，否则回落到最新支持版本。
const (
	latestProtocolVersion  = "2025-06-18"
	serverName             = "connector-runtime"
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

// Server MCP 工具面。
type Server struct {
	cat   *catalog.Store
	conns *connection.Store
	pol   *policy.Policy
	exec  *executor.Executor
	audit *audit.Logger
}

// New 构造 MCP 面。
func New(cat *catalog.Store, conns *connection.Store, pol *policy.Policy, exec *executor.Executor, aud *audit.Logger) *Server {
	return &Server{cat: cat, conns: conns, pol: pol, exec: exec, audit: aud}
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
		return Outcome{Status: 200, Body: okResponse(req.ID, map[string]any{"tools": toolDefs()})}
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

// ---- 5 工具定义 ----

type toolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func toolDefs() []toolDef {
	return []toolDef{
		{Name: "list_apps", Description: "列出可用的连接器应用（含动作数量与认证类型）",
			InputSchema: objSchema(nil, nil)},
		{Name: "list_connections", Description: "列出已建立的连接（不含凭据）",
			InputSchema: objSchema(nil, nil)},
		{Name: "search_actions", Description: "按关键词搜索动作（匹配动作 id/标题/描述/分类）",
			InputSchema: objSchema(map[string]any{
				"query":       map[string]any{"type": "string", "description": "关键词，空则返回全部"},
				"connectorId": map[string]any{"type": "string", "description": "可选，限定连接器"},
			}, nil)},
		{Name: "get_action_guide", Description: "获取单个动作的完整执行指南（含输入 schema 与 scope 要求）",
			InputSchema: objSchema(map[string]any{
				"actionId": map[string]any{"type": "string", "description": "动作 id，如 httpbin.get"},
			}, []string{"actionId"})},
		{Name: "execute_action", Description: "执行动作。api_key 类连接器须传 connectionId",
			InputSchema: objSchema(map[string]any{
				"actionId":    map[string]any{"type": "string"},
				"input":       map[string]any{"type": "object", "description": "动作输入，按 get_action_guide 的 schema 构造"},
				"connectionId": map[string]any{"type": "string", "description": "连接 id（no-auth 连接器可省略）"},
			}, []string{"actionId"})},
	}
}

func objSchema(props map[string]any, required []string) map[string]any {
	s := map[string]any{"type": "object", "properties": props}
	if required != nil {
		s["required"] = required
	}
	return s
}

// ---- 工具实现 ----

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
		return nil, &rpcErrorValue{codeInvalidParams, "params 解析失败"}
	}
	args := map[string]any{}
	if len(p.Arguments) > 0 {
		if err := json.Unmarshal(p.Arguments, &args); err != nil {
			return nil, &rpcErrorValue{codeInvalidParams, "arguments 须为对象"}
		}
	}
	switch p.Name {
	case "list_apps":
		return toolResult(s.cat.Apps()), nil
	case "list_connections":
		return toolResult(s.conns.List()), nil
	case "search_actions":
		q, _ := args["query"].(string)
		cid, _ := args["connectorId"].(string)
		if cid != "" {
			if _, ok := s.cat.Connector(cid); !ok {
				return nil, &rpcErrorValue{codeInvalidParams, "未知 connectorId: " + cid}
			}
		}
		return toolResult(s.cat.Actions(q, cid)), nil
	case "get_action_guide":
		id, _ := args["actionId"].(string)
		if id == "" {
			return nil, &rpcErrorValue{codeInvalidParams, "缺少 actionId"}
		}
		return s.getGuide(id)
	case "execute_action":
		return s.executeAction(ctx, args)
	default:
		return nil, &rpcErrorValue{codeInvalidParams, "未知工具: " + p.Name}
	}
}

func (s *Server) getGuide(actionID string) (any, *rpcErrorValue) {
	act, conn, ok := s.cat.Action(actionID)
	if !ok {
		return errorToolResult("unknown_action", "未知动作: "+actionID), nil
	}
	return toolResult(map[string]any{
		"id":             act.ID,
		"title":          act.Title,
		"description":    act.Description,
		"operationType":  act.OperationType,
		"inputSchema":    act.InputSchema,
		"outputSchema":   act.OutputSchema,
		"requiredScopes": act.RequiredScopes,
		"connector": map[string]any{
			"id": conn.ID, "displayName": conn.DisplayName, "authType": string(conn.Auth.Type),
		},
	}), nil
}

func (s *Server) executeAction(ctx context.Context, args map[string]any) (any, *rpcErrorValue) {
	actionID, _ := args["actionId"].(string)
	if actionID == "" {
		return nil, &rpcErrorValue{codeInvalidParams, "缺少 actionId"}
	}
	input, _ := args["input"].(map[string]any)
	connectionID, _ := args["connectionId"].(string)
	executionID := newExecutionID()

	act, conn, ok := s.cat.Action(actionID)
	if !ok {
		s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, Status: audit.StatusDenied, ErrorCode: "unknown_action"})
		return errorToolResult("unknown_action", "未知动作: "+actionID), nil
	}

	// 1. 动作级策略
	if d := s.pol.Evaluate(actionID); !d.Allowed {
		s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, ConnectorID: conn.ID, Status: audit.StatusDenied, ErrorCode: d.Code})
		return errorToolResult(d.Code, d.Reason), nil
	}

	// 2. 连接解析
	var connProj *connection.Projection
	var sec connection.Secret
	if conn.Auth.Type == model.AuthNone {
		if connectionID != "" {
			if p, ok := s.conns.Get(connectionID); ok && p.ConnectorID == conn.ID {
				connProj = &p
			}
		}
	} else {
		if connectionID == "" {
			msg := "该连接器需要连接（connectionId）才能执行"
			s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, ConnectorID: conn.ID, Status: audit.StatusDenied, ErrorCode: "connection_not_found"})
			return errorToolResult("connection_not_found", msg), nil
		}
		p, ok := s.conns.Get(connectionID)
		if !ok || p.ConnectorID != conn.ID {
			s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, ConnectorID: conn.ID, ConnectionID: connectionID, Status: audit.StatusDenied, ErrorCode: "connection_not_found"})
			return errorToolResult("connection_not_found", "连接不存在或不属于该连接器"), nil
		}
		connProj = &p
		dec, err := s.conns.Reveal(connectionID)
		if err != nil {
			s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, ConnectorID: conn.ID, ConnectionID: connectionID, Status: audit.StatusDenied, ErrorCode: "connection_not_found"})
			return errorToolResult("connection_not_found", "连接凭据不可用"), nil
		}
		sec = dec
	}

	// 3. 连接级 scope 授权
	var granted []string
	if connProj != nil {
		granted = connProj.GrantedScopes
	}
	if d := policy.EvaluateConnection(act, granted); !d.Allowed {
		s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, ConnectorID: conn.ID, ConnectionID: connectionID, Status: audit.StatusDenied, ErrorCode: d.Code})
		return errorToolResult(d.Code, d.Reason), nil
	}

	// 4. 执行
	res, execErr := s.exec.Execute(ctx, conn, act, input, sec)
	var connIDForAudit string
	if connProj != nil {
		connIDForAudit = connProj.ID
	}
	if execErr != nil {
		s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, ConnectorID: conn.ID, ConnectionID: connIDForAudit,
			Status: audit.StatusError, ErrorCode: execErr.Code, DurationMS: 0})
		return errorToolResult(execErr.Code, execErr.Message), nil
	}
	s.auditEntry(audit.Entry{ExecutionID: executionID, Action: actionID, ConnectorID: conn.ID, ConnectionID: connIDForAudit,
		Status: audit.StatusOK, DurationMS: res.DurationMS})

	// body：合法 JSON 原样嵌入，否则作为字符串
	var body any = string(res.Body)
	if json.Valid(res.Body) {
		body = json.RawMessage(res.Body)
	}
	return toolResult(map[string]any{
		"executionId": executionID,
		"statusCode":  res.StatusCode,
		"durationMs":  res.DurationMS,
		"body":        body,
	}), nil
}

func (s *Server) auditEntry(e audit.Entry) {
	if s.audit == nil {
		return
	}
	_ = s.audit.Log(e)
}

// ---- 工具结果（MCP content 形态） ----

func toolResult(payload any) map[string]any {
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": mustJSON(payload)}},
		"isError": false,
	}
}

func errorToolResult(code, message string) map[string]any {
	return map[string]any{
		"content": []map[string]any{{"type": "text", "text": mustJSON(map[string]any{
			"error": map[string]any{"code": code, "message": audit.RedactString(message)},
		})}},
		"isError": true,
	}
}

func okResponse(id json.RawMessage, result any) *response {
	return &response{JSONRPC: "2.0", ID: id, Result: result}
}

func errResponse(id json.RawMessage, code int, msg string) *response {
	return &response{JSONRPC: "2.0", ID: id, Error: &rpcError{Code: code, Message: msg}}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":{"code":"internal","message":"结果序列化失败"}}`
	}
	return string(b)
}

// newExecutionID 生成执行 id（审计贯穿用）。
func newExecutionID() string {
	b := make([]byte, 8)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return fmt.Sprintf("exec-%d", time.Now().UnixNano())
	}
	return "exec-" + hex.EncodeToString(b)
}

// Version 由构建注入（cmd 层设置）。
var Version = "0.1.0"
