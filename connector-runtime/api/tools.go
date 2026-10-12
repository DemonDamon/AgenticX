package api

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

// ProtocolError 协议级错误（未知工具/参数不合法），宿主自行映射为各自协议的错误形态。
const CodeInvalidParams = -32602

// ProtocolError 协议级错误。
type ProtocolError struct {
	Code    int
	Message string
}

func (e *ProtocolError) Error() string { return e.Message }

// ToolDef 发现型工具定义（宿主转换为各自的工具注册形态）。
type ToolDef struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// ExecutionRecord execute_action 的执行元数据：宿主审计链路据此贯穿
// executionId / 动作 / 连接维度（「谁何时用哪个连接执行了什么」）。
type ExecutionRecord struct {
	ExecutionID  string `json:"executionId"`
	ActionID     string `json:"actionId"`
	ConnectorID  string `json:"connectorId"`
	ConnectionID string `json:"connectionId,omitempty"`
	Status       string `json:"status"` // ok | error | denied
	ErrorCode    string `json:"errorCode,omitempty"`
	DurationMS   int64  `json:"durationMs"`
}

// CallResult 工具调用结果：Text 为 MCP text content（JSON 编码负载），
// IsError 表示工具级错误（负载为 {"error":{code,message}}）。
type CallResult struct {
	Text    string
	IsError bool
	Exec    *ExecutionRecord // 仅 execute_action 填充
}

// Tools 5 个发现型工具的程序化调度：以「搜索-发现-执行」收纳任意规模动作目录，
// 工具数与目录规模解耦。独立进程形态（JSON-RPC 层）与企业网关内嵌形态（mcphost
// backend）共用本实现。
type Tools struct {
	cat   *catalog.Store
	conns Connections
	pol   ActionPolicy
	exec  *executor.Executor
	aud   AuditSink
}

// NewTools 构造工具面。cat 必须非空；conns 为空时 list_connections 返回空、
// 凭据连接无法执行；pol 为空视为放行；exec 为空时执行动作报内部错误；
// aud 为空时跳过内置审计（宿主从 CallResult.Exec 提取）。
func NewTools(cat *CatalogStore, conns Connections, pol ActionPolicy, exec *Executor, aud AuditSink) *Tools {
	return &Tools{cat: cat, conns: conns, pol: pol, exec: exec, aud: aud}
}

// Definitions 返回 5 个发现型工具定义。
func Definitions() []ToolDef {
	return []ToolDef{
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
		{Name: "execute_action", Description: "执行动作。需凭据的连接器传 connectionId（该连接器仅一个连接时可省略）",
			InputSchema: objSchema(map[string]any{
				"actionId":     map[string]any{"type": "string"},
				"input":        map[string]any{"type": "object", "description": "动作输入，按 get_action_guide 的 schema 构造"},
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

// Call 调度一次工具调用。args 为 nil 视为空参数。
func (t *Tools) Call(ctx context.Context, name string, args map[string]any) (CallResult, *ProtocolError) {
	if args == nil {
		args = map[string]any{}
	}
	switch name {
	case "list_apps":
		return okResult(t.cat.Apps()), nil
	case "list_connections":
		if t.conns == nil {
			return okResult([]connection.Projection{}), nil
		}
		return okResult(t.conns.List(ctx)), nil
	case "search_actions":
		q, _ := args["query"].(string)
		cid, _ := args["connectorId"].(string)
		if cid != "" {
			if _, ok := t.cat.Connector(cid); !ok {
				return CallResult{}, &ProtocolError{Code: CodeInvalidParams, Message: "未知 connectorId: " + cid}
			}
		}
		return okResult(t.cat.Actions(q, cid)), nil
	case "get_action_guide":
		id, _ := args["actionId"].(string)
		if id == "" {
			return CallResult{}, &ProtocolError{Code: CodeInvalidParams, Message: "缺少 actionId"}
		}
		return t.getGuide(id), nil
	case "execute_action":
		return t.executeAction(ctx, args)
	default:
		return CallResult{}, &ProtocolError{Code: CodeInvalidParams, Message: "未知工具: " + name}
	}
}

func (t *Tools) getGuide(actionID string) CallResult {
	act, conn, ok := t.cat.Action(actionID)
	if !ok {
		return errResult("unknown_action", "未知动作: "+actionID)
	}
	return okResult(map[string]any{
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
	})
}

func (t *Tools) executeAction(ctx context.Context, args map[string]any) (CallResult, *ProtocolError) {
	actionID, _ := args["actionId"].(string)
	if actionID == "" {
		return CallResult{}, &ProtocolError{Code: CodeInvalidParams, Message: "缺少 actionId"}
	}
	input, _ := args["input"].(map[string]any)
	connectionID, _ := args["connectionId"].(string)
	executionID := newExecutionID()

	act, conn, ok := t.cat.Action(actionID)
	if !ok {
		rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID,
			Status: audit.StatusDenied, ErrorCode: "unknown_action"}
		t.auditRecord(rec)
		return withExec(errResult("unknown_action", "未知动作: "+actionID), rec), nil
	}

	// 1. 动作级策略（nil 视为放行——企业形态在宿主策略链路评估）
	if t.pol != nil {
		if d := t.pol.Evaluate(actionID); !d.Allowed {
			rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
				Status: audit.StatusDenied, ErrorCode: d.Code}
			t.auditRecord(rec)
			return withExec(errResult(d.Code, d.Reason), rec), nil
		}
	}

	// 2. 连接解析
	var connProj *connection.Projection
	var sec connection.Secret
	if conn.Auth.Type == model.AuthNone {
		if connectionID != "" && t.conns != nil {
			if p, ok := t.conns.Get(ctx, connectionID); ok && p.ConnectorID == conn.ID {
				connProj = &p
			}
		}
	} else {
		if connectionID == "" && t.conns != nil {
			// 未传 connectionId 且该连接器恰有一个连接：自动选用（单实例去重后的常见形态）。
			var only []string
			for _, p := range t.conns.List(ctx) {
				if p.ConnectorID == conn.ID {
					only = append(only, p.ID)
				}
			}
			if len(only) == 1 {
				connectionID = only[0]
			}
		}
		if connectionID == "" || t.conns == nil {
			rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
				Status: audit.StatusDenied, ErrorCode: "connection_not_found"}
			t.auditRecord(rec)
			return withExec(errResult("connection_not_found", "该连接器需要连接（connectionId）才能执行"), rec), nil
		}
		p, ok := t.conns.Get(ctx, connectionID)
		if !ok || p.ConnectorID != conn.ID {
			rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
				ConnectionID: connectionID, Status: audit.StatusDenied, ErrorCode: "connection_not_found"}
			t.auditRecord(rec)
			return withExec(errResult("connection_not_found", "连接不存在或不属于该连接器"), rec), nil
		}
		connProj = &p
		dec, err := t.conns.Reveal(ctx, connectionID)
		if err != nil {
			rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
				ConnectionID: connectionID, Status: audit.StatusDenied, ErrorCode: "connection_not_found"}
			t.auditRecord(rec)
			return withExec(errResult("connection_not_found", "连接凭据不可用"), rec), nil
		}
		sec = dec
	}

	// 3. 连接级 scope 授权
	var granted []string
	if connProj != nil {
		granted = connProj.GrantedScopes
	}
	if d := policy.EvaluateConnection(act, granted); !d.Allowed {
		rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
			ConnectionID: connectionID, Status: audit.StatusDenied, ErrorCode: d.Code}
		t.auditRecord(rec)
		return withExec(errResult(d.Code, d.Reason), rec), nil
	}

	// 4. 执行
	if t.exec == nil {
		rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
			Status: audit.StatusError, ErrorCode: "internal"}
		t.auditRecord(rec)
		return withExec(errResult("internal", "执行器不可用"), rec), nil
	}
	res, execErr := t.exec.ExecuteConn(ctx, conn, act, input, sec, connectionID)
	connIDForAudit := ""
	if connProj != nil {
		connIDForAudit = connProj.ID
	}
	if execErr != nil {
		rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
			ConnectionID: connIDForAudit, Status: audit.StatusError, ErrorCode: execErr.Code}
		t.auditRecord(rec)
		return withExec(errResult(execErr.Code, execErr.Message), rec), nil
	}
	rec := &ExecutionRecord{ExecutionID: executionID, ActionID: actionID, ConnectorID: conn.ID,
		ConnectionID: connIDForAudit, Status: audit.StatusOK, DurationMS: res.DurationMS}
	t.auditRecord(rec)

	// body：合法 JSON 原样嵌入，否则作为字符串
	var body any = string(res.Body)
	if json.Valid(res.Body) {
		body = json.RawMessage(res.Body)
	}
	return withExec(okResult(map[string]any{
		"executionId": executionID,
		"statusCode":  res.StatusCode,
		"durationMs":  res.DurationMS,
		"body":        body,
	}), rec), nil
}

// auditRecord 将执行元数据写入审计缝隙（独立形态 JSONL；企业形态通常为 nil，
// 由宿主审计链路从 CallResult.Exec 提取）。
func (t *Tools) auditRecord(rec *ExecutionRecord) {
	if t.aud == nil || rec == nil {
		return
	}
	_ = t.aud.Log(audit.Entry{
		ExecutionID:  rec.ExecutionID,
		Action:       rec.ActionID,
		ConnectorID:  rec.ConnectorID,
		ConnectionID: rec.ConnectionID,
		Status:       rec.Status,
		ErrorCode:    rec.ErrorCode,
		DurationMS:   rec.DurationMS,
	})
}

func okResult(payload any) CallResult {
	return CallResult{Text: mustJSON(payload)}
}

func errResult(code, message string) CallResult {
	return CallResult{
		Text:    mustJSON(map[string]any{"error": map[string]any{"code": code, "message": audit.RedactString(message)}}),
		IsError: true,
	}
}

func withExec(r CallResult, rec *ExecutionRecord) CallResult {
	r.Exec = rec
	return r
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
