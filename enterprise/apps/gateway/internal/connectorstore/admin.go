// admin.go 管理面扩展：mcp_servers 入口行保障与连接管理视图。
package connectorstore

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// ConnectorServerName 连接器网关在 mcp_servers 注册表中的入口名（工具端点
// /mcp/connector/streamable-http）；工具面为 5 个固定发现型工具，无需 mcp_tools 行。
const ConnectorServerName = "connector"

// ConnectionAdminView 连接管理视图（含状态，管理面专用；凭据永不出现）。
type ConnectionAdminView struct {
	ID           string    `json:"id"`
	ConnectorID  string    `json:"connectorId"`
	Name         string    `json:"name"`
	AuthType     string    `json:"authType"`
	GrantedScopes []string `json:"grantedScopes"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

// EnsureConnectorServer 确保租户存在 backend_type='connector' 的 mcp_servers 行
// （幂等；已存在则不动，列默认值补齐 config/scopes/rate_limit）。
func (s *Store) EnsureConnectorServer(ctx context.Context, tenantID string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connectorstore: 数据库不可用")
	}
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return fmt.Errorf("tenant_id 不能为空")
	}
	query := `
INSERT INTO mcp_servers (id, tenant_id, name, display_name, transport, backend_type)
VALUES (?, ?, ?, '连接器网关', 'streamable-http', 'connector')
ON CONFLICT (tenant_id, name) DO NOTHING`
	args := []any{newServerID(), tenantID, ConnectorServerName}
	if s.db.Dialect == database.MySQL {
		query = `
INSERT IGNORE INTO mcp_servers (id, tenant_id, name, display_name, transport, backend_type)
VALUES (?, ?, ?, '连接器网关', 'streamable-http', 'connector')`
	}
	if _, err := s.db.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("写入连接器 mcp_servers 入口失败: %w", err)
	}
	return nil
}

// ListConnectionsForConnector 列出租户某连接器的全部连接（含 revoked，管理视图）。
func (s *Store) ListConnectionsForConnector(ctx context.Context, tenantID, connectorID string) ([]ConnectionAdminView, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("connectorstore: 数据库不可用")
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT id, connector_id, name, auth_type, granted_scopes, status, created_at
FROM connector_connections
WHERE tenant_id = ? AND connector_id = ?
ORDER BY created_at ASC, id ASC`,
		strings.TrimSpace(tenantID), strings.TrimSpace(connectorID))
	if err != nil {
		return nil, fmt.Errorf("查询连接失败: %w", err)
	}
	defer rows.Close()
	out := []ConnectionAdminView{}
	for rows.Next() {
		var (
			id, connectorID, name, authType, status string
			scopesRaw                               []byte
			createdAt                               time.Time
		)
		if err := rows.Scan(&id, &connectorID, &name, &authType, &scopesRaw, &status, &createdAt); err != nil {
			return nil, fmt.Errorf("读取连接失败: %w", err)
		}
		out = append(out, ConnectionAdminView{
			ID:            id,
			ConnectorID:   connectorID,
			Name:          name,
			AuthType:      authType,
			GrantedScopes: decodeScopesJSON(scopesRaw),
			Status:        status,
			CreatedAt:     createdAt.UTC(),
		})
	}
	return out, rows.Err()
}

// newServerID 生成 26 字符 id（与 mcp_servers.id varchar(26) 对齐）。
func newServerID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("srv%d", time.Now().UnixNano())
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
}
