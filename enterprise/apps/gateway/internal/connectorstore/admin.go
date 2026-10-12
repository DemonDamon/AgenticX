// admin.go 管理面扩展：mcp_servers 入口行保障与连接管理视图。
package connectorstore

import (
	"context"
	"crypto/rand"
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

// crockfordEncoding 与 config 包的 ULID 字母表一致（不含 I/L/O/U）。
const crockfordEncoding = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// newServerID 生成 Crockford ULID，写入 mcp_servers.id（varchar(26)）。
//
// 以前这里用 encoding/base32（RFC 4648）。那也是 26 字符，但字母表含 I/L/O/U，
// 能力目录按 ULID 拼 mcp:<id> 时会直接抛错，管理页整页打不开。已落库的旧 id
// 仍由解析侧接受，这里只保证新行是 ULID。
func newServerID() string {
	var raw [16]byte
	ms := uint64(time.Now().UnixMilli())
	raw[0] = byte(ms >> 40)
	raw[1] = byte(ms >> 32)
	raw[2] = byte(ms >> 24)
	raw[3] = byte(ms >> 16)
	raw[4] = byte(ms >> 8)
	raw[5] = byte(ms)
	if _, err := rand.Read(raw[6:]); err != nil {
		nano := uint64(time.Now().UnixNano())
		raw[6] = byte(nano >> 56)
		raw[7] = byte(nano >> 48)
		raw[8] = byte(nano >> 40)
		raw[9] = byte(nano >> 32)
		raw[10] = byte(nano >> 24)
		raw[11] = byte(nano >> 16)
		raw[12] = byte(nano >> 8)
		raw[13] = byte(nano)
		raw[14] = raw[5]
		raw[15] = raw[4]
	}
	return encodeULID(raw)
}

func encodeULID(id [16]byte) string {
	dst := make([]byte, 26)
	dst[0] = crockfordEncoding[(id[0]&224)>>5]
	dst[1] = crockfordEncoding[id[0]&31]
	dst[2] = crockfordEncoding[(id[1]&248)>>3]
	dst[3] = crockfordEncoding[((id[1]&7)<<2)|((id[2]&192)>>6)]
	dst[4] = crockfordEncoding[(id[2]&62)>>1]
	dst[5] = crockfordEncoding[((id[2]&1)<<4)|((id[3]&240)>>4)]
	dst[6] = crockfordEncoding[((id[3]&15)<<1)|((id[4]&128)>>7)]
	dst[7] = crockfordEncoding[(id[4]&124)>>2]
	dst[8] = crockfordEncoding[((id[4]&3)<<3)|((id[5]&224)>>5)]
	dst[9] = crockfordEncoding[id[5]&31]
	dst[10] = crockfordEncoding[(id[6]&248)>>3]
	dst[11] = crockfordEncoding[((id[6]&7)<<2)|((id[7]&192)>>6)]
	dst[12] = crockfordEncoding[(id[7]&62)>>1]
	dst[13] = crockfordEncoding[((id[7]&1)<<4)|((id[8]&240)>>4)]
	dst[14] = crockfordEncoding[((id[8]&15)<<1)|((id[9]&128)>>7)]
	dst[15] = crockfordEncoding[(id[9]&124)>>2]
	dst[16] = crockfordEncoding[((id[9]&3)<<3)|((id[10]&224)>>5)]
	dst[17] = crockfordEncoding[id[10]&31]
	dst[18] = crockfordEncoding[(id[11]&248)>>3]
	dst[19] = crockfordEncoding[((id[11]&7)<<2)|((id[12]&192)>>6)]
	dst[20] = crockfordEncoding[(id[12]&62)>>1]
	dst[21] = crockfordEncoding[((id[12]&1)<<4)|((id[13]&240)>>4)]
	dst[22] = crockfordEncoding[((id[13]&15)<<1)|((id[14]&128)>>7)]
	dst[23] = crockfordEncoding[(id[14]&124)>>2]
	dst[24] = crockfordEncoding[((id[14]&3)<<3)|((id[15]&224)>>5)]
	dst[25] = crockfordEncoding[id[15]&31]
	return string(dst)
}
