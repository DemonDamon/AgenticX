package mcphost

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"

	connectorapi "github.com/agenticx/connector-runtime/api"
)

// BackendConnector 连接器网关 backend：企业内网的连接器供给与治理入口。
// 注册 5 个发现型工具进既有 tools/call 管线（配额→策略→审计链路不变），
// 目录与连接按租户从 PG 解析，动作执行复用 core 的 SSRF 守护执行器。
const BackendConnector = "connector"

// AllowPrivateNetworkEnv 允许连接器上游为私网/环回地址（内网应用场景），默认拒绝。
const AllowPrivateNetworkEnv = "GATEWAY_CONNECTOR_ALLOW_PRIVATE_NETWORK"

// ConnectorStore 连接器存储缝隙（生产为 connectorstore.Store，测试可注入）。
type ConnectorStore interface {
	ListDefinitions(ctx context.Context, tenantID string) ([]*connectorapi.Connector, error)
	ConnectionsFor(tenantID string) connectorapi.Connections
}

// ConnectorBackend 连接器 backend：按租户装配 core 工具面并调度。
type ConnectorBackend struct {
	store  ConnectorStore
	exec   *connectorapi.Executor
	logger *slog.Logger
}

// NewConnectorBackend 构造连接器 backend。allowPrivate 控制上游私网放行。
func NewConnectorBackend(store ConnectorStore, logger *slog.Logger, allowPrivate bool) *ConnectorBackend {
	if logger == nil {
		logger = slog.Default()
	}
	return &ConnectorBackend{
		store:  store,
		exec:   connectorapi.NewExecutor(connectorapi.ExecOptions{AllowPrivateNetwork: allowPrivate}),
		logger: logger,
	}
}

func (b *ConnectorBackend) Name() string { return BackendConnector }

func (b *ConnectorBackend) ListTools(_ context.Context, _ *ServerRecord) ([]Tool, error) {
	defs := connectorapi.Definitions()
	out := make([]Tool, 0, len(defs))
	for _, d := range defs {
		schema, err := json.Marshal(d.InputSchema)
		if err != nil {
			return nil, err
		}
		out = append(out, Tool{
			Name:        d.Name,
			Description: d.Description,
			InputSchema: schema,
		})
	}
	return out, nil
}

func (b *ConnectorBackend) CallTool(ctx context.Context, rec *ServerRecord, name string, args map[string]any) (CallResult, error) {
	if b.store == nil {
		return textResult("connector backend: 存储不可用", true), nil
	}
	if rec == nil {
		return textResult("connector backend: nil server", true), nil
	}
	defs, err := b.store.ListDefinitions(ctx, rec.TenantID)
	if err != nil {
		b.logger.Warn("connector definitions unavailable", "tenant", rec.TenantID, "error", err)
		return textResult("connector definitions unavailable", true), nil
	}
	cat, err := connectorapi.NewCatalog(defs)
	if err != nil {
		b.logger.Warn("connector catalog build failed", "tenant", rec.TenantID, "error", err)
		return textResult("connector catalog invalid: "+err.Error(), true), nil
	}
	// 动作级策略在宿主 invokeTool 的 connector 阶段评估（带身份维度），此处传 nil 放行。
	tools := connectorapi.NewTools(cat, b.store.ConnectionsFor(rec.TenantID), nil, b.exec, nil)
	res, perr := tools.Call(ctx, name, args)
	if perr != nil {
		return textResult(perr.Message, true), nil
	}
	result := CallResult{
		Content: []ContentBlock{{Type: "text", Text: res.Text}},
		IsError: res.IsError,
	}
	if res.Exec != nil {
		result.Metadata = map[string]any{
			"connector_execution_id":  res.Exec.ExecutionID,
			"connector_action_id":     res.Exec.ActionID,
			"connector_id":            res.Exec.ConnectorID,
			"connector_connection_id": res.Exec.ConnectionID,
			"connector_status":        res.Exec.Status,
			"connector_error_code":    res.Exec.ErrorCode,
		}
	}
	return result, nil
}

// connectorAllowPrivateNetwork 读取私网放行配置（默认拒绝，出网安全基线）。
func connectorAllowPrivateNetwork() bool {
	v := strings.TrimSpace(os.Getenv(AllowPrivateNetworkEnv))
	return strings.EqualFold(v, "on") || strings.EqualFold(v, "1") || strings.EqualFold(v, "true")
}
