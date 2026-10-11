package connectorstore

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	connectorapi "github.com/agenticx/connector-runtime/api"
)

// 连接状态。
const (
	ConnectionActive  = "active"
	ConnectionRevoked = "revoked"
)

// CreateConnectionInput 新建连接（授权）输入。
type CreateConnectionInput struct {
	ConnectorID   string
	Name          string
	GrantedScopes []string
	APIKey        string // api_key 认证时必填；none 认证必须为空
}

// RotateConnectionInput 轮转凭据输入。
type RotateConnectionInput struct {
	APIKey string
}

// tenantConnections 租户视图：实现 core 的 api.Connections 缝隙，
// 仅暴露活跃连接，全部查询带租户条件。
type tenantConnections struct {
	store  *Store
	tenant string
}

// ConnectionsFor 返回租户的连接存储视图（凭据仅在 Reveal 时解出）。
func (s *Store) ConnectionsFor(tenantID string) connectorapi.Connections {
	return &tenantConnections{store: s, tenant: strings.TrimSpace(tenantID)}
}

func (t *tenantConnections) List(ctx context.Context) []connectorapi.ConnectionProjection {
	rows, err := t.store.db.QueryContext(ctx, `
SELECT id, connector_id, name, auth_type, granted_scopes, created_at
FROM connector_connections
WHERE tenant_id = ? AND status = 'active'
ORDER BY created_at ASC, id ASC`, t.tenant)
	if err != nil {
		return []connectorapi.ConnectionProjection{}
	}
	defer rows.Close()
	out := []connectorapi.ConnectionProjection{}
	for rows.Next() {
		p, err := scanProjection(rows)
		if err != nil {
			continue
		}
		out = append(out, p)
	}
	return out
}

func (t *tenantConnections) Get(ctx context.Context, id string) (connectorapi.ConnectionProjection, bool) {
	row, err := t.store.db.QueryRowContext(ctx, `
SELECT id, connector_id, name, auth_type, granted_scopes, created_at
FROM connector_connections
WHERE tenant_id = ? AND id = ? AND status = 'active'
LIMIT 1`, t.tenant, strings.TrimSpace(id))
	if err != nil {
		return connectorapi.ConnectionProjection{}, false
	}
	p, err := scanProjection(row)
	if err != nil {
		return connectorapi.ConnectionProjection{}, false
	}
	return p, true
}

func (t *tenantConnections) Reveal(ctx context.Context, id string) (connectorapi.ConnectionSecret, error) {
	row, err := t.store.db.QueryRowContext(ctx, `
SELECT encrypted_secret FROM connector_connections
WHERE tenant_id = ? AND id = ? AND status = 'active'
LIMIT 1`, t.tenant, strings.TrimSpace(id))
	if err != nil {
		return connectorapi.ConnectionSecret{}, fmt.Errorf("连接不存在")
	}
	var enc sql.NullString
	if err := row.Scan(&enc); err != nil || !enc.Valid || strings.TrimSpace(enc.String) == "" {
		return connectorapi.ConnectionSecret{}, fmt.Errorf("连接凭据不可用")
	}
	c, err := t.store.cipher()
	if err != nil {
		return connectorapi.ConnectionSecret{}, fmt.Errorf("连接凭据不可用")
	}
	pt, err := c.DecryptString(enc.String)
	if err != nil {
		return connectorapi.ConnectionSecret{}, fmt.Errorf("连接凭据不可用")
	}
	var sec connectorapi.ConnectionSecret
	if err := json.Unmarshal([]byte(pt), &sec); err != nil {
		return connectorapi.ConnectionSecret{}, fmt.Errorf("连接凭据不可用")
	}
	return sec, nil
}

// scanner 兼容 *sql.Row 与 *sql.Rows 的 Scan。
type scanner interface {
	Scan(dest ...any) error
}

func scanProjection(sc scanner) (connectorapi.ConnectionProjection, error) {
	var (
		id, connectorID, name, authType string
		scopesRaw                       []byte
		createdAt                       time.Time
	)
	if err := sc.Scan(&id, &connectorID, &name, &authType, &scopesRaw, &createdAt); err != nil {
		return connectorapi.ConnectionProjection{}, err
	}
	return connectorapi.ConnectionProjection{
		ID:            id,
		ConnectorID:   connectorID,
		Name:          name,
		AuthType:      authType,
		GrantedScopes: decodeScopesJSON(scopesRaw),
		CreatedAt:     createdAt.UTC(),
	}, nil
}

func decodeScopesJSON(raw []byte) []string {
	empty := []string{}
	if len(raw) == 0 {
		return empty
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil || len(out) == 0 {
		return empty
	}
	return out
}

// CreateConnection 新建连接（授权）：凭据加密后写入 PG。
// 先校验连接器存在且认证类型匹配。
func (s *Store) CreateConnection(ctx context.Context, tenantID string, in CreateConnectionInput) (*connectorapi.ConnectionProjection, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("connectorstore: 数据库不可用")
	}
	tenantID = strings.TrimSpace(tenantID)
	def, err := s.definition(ctx, tenantID, in.ConnectorID)
	if err != nil {
		return nil, err
	}
	var enc string
	switch def.Auth.Type {
	case connectorapi.AuthAPIKey:
		if strings.TrimSpace(in.APIKey) == "" {
			return nil, fmt.Errorf("apiKey 不能为空")
		}
		enc, err = s.encryptSecret(connectorapi.ConnectionSecret{APIKey: in.APIKey})
		if err != nil {
			return nil, err
		}
	case connectorapi.AuthNone:
		if strings.TrimSpace(in.APIKey) != "" {
			return nil, fmt.Errorf("none 认证连接器不接受 apiKey（可创建仅授权 scope 的连接）")
		}
	default:
		return nil, fmt.Errorf("暂不支持的认证类型: %s", def.Auth.Type)
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, fmt.Errorf("连接名称不能为空")
	}

	id := newConnectionID()
	scopes := []string{}
	scopes = append(scopes, in.GrantedScopes...)
	scopesRaw, _ := json.Marshal(scopes)
	if _, err := s.db.ExecContext(ctx, `
INSERT INTO connector_connections (id, tenant_id, connector_id, name, auth_type, granted_scopes, encrypted_secret, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		id, tenantID, def.ID, strings.TrimSpace(in.Name), string(def.Auth.Type), scopesRaw, nullString(enc)); err != nil {
		return nil, fmt.Errorf("写入连接失败: %w", err)
	}
	return &connectorapi.ConnectionProjection{
		ID:            id,
		ConnectorID:   def.ID,
		Name:          strings.TrimSpace(in.Name),
		AuthType:      string(def.Auth.Type),
		GrantedScopes: scopes,
		CreatedAt:     time.Now().UTC(),
	}, nil
}

// RotateConnectionSecret 轮转连接凭据（保持连接 id 与授权不变）。
func (s *Store) RotateConnectionSecret(ctx context.Context, tenantID, id string, in RotateConnectionInput) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connectorstore: 数据库不可用")
	}
	if strings.TrimSpace(in.APIKey) == "" {
		return fmt.Errorf("apiKey 不能为空")
	}
	enc, err := s.encryptSecret(connectorapi.ConnectionSecret{APIKey: in.APIKey})
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE connector_connections
SET encrypted_secret = ?, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = ? AND id = ? AND status = 'active'`,
		enc, strings.TrimSpace(tenantID), strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("轮转凭据失败: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("连接不存在或已撤销")
	}
	return nil
}

// RevokeConnection 撤销连接（保留行以供审计回溯，状态置 revoked）。
func (s *Store) RevokeConnection(ctx context.Context, tenantID, id string) (bool, error) {
	if s == nil || s.db == nil {
		return false, fmt.Errorf("connectorstore: 数据库不可用")
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE connector_connections
SET status = 'revoked', updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = ? AND id = ? AND status = 'active'`,
		strings.TrimSpace(tenantID), strings.TrimSpace(id))
	if err != nil {
		return false, fmt.Errorf("撤销连接失败: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// definition 查询单个连接器定义。
func (s *Store) definition(ctx context.Context, tenantID, connectorID string) (*connectorapi.Connector, error) {
	row, err := s.db.QueryRowContext(ctx, `
SELECT definition FROM connector_definitions
WHERE tenant_id = ? AND connector_id = ? AND status = 'active'
LIMIT 1`, tenantID, strings.TrimSpace(connectorID))
	if err != nil {
		return nil, fmt.Errorf("连接器不存在: %s", connectorID)
	}
	var raw []byte
	if err := row.Scan(&raw); err != nil {
		return nil, fmt.Errorf("连接器不存在: %s", connectorID)
	}
	def, err := connectorapi.ParseConnector(raw)
	if err != nil {
		return nil, fmt.Errorf("连接器定义损坏: %w", err)
	}
	return def, nil
}

// encryptSecret 加密连接凭据：AES-GCM，base64(nonce||ct)。
func (s *Store) encryptSecret(sec connectorapi.ConnectionSecret) (string, error) {
	c, err := s.cipher()
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(sec)
	if err != nil {
		return "", fmt.Errorf("序列化凭据失败: %w", err)
	}
	return c.EncryptString(string(raw))
}

// DecryptSecretString 解密 base64(nonce||ct) 形态的凭据（供测试与导入校验）。
func DecryptSecretString(c *connectorapi.Cipher, enc string) (connectorapi.ConnectionSecret, error) {
	if c == nil {
		return connectorapi.ConnectionSecret{}, errors.New("cipher 不可用")
	}
	pt, err := c.DecryptString(enc)
	if err != nil {
		return connectorapi.ConnectionSecret{}, err
	}
	var sec connectorapi.ConnectionSecret
	if err := json.Unmarshal([]byte(pt), &sec); err != nil {
		return connectorapi.ConnectionSecret{}, err
	}
	return sec, nil
}

func nullString(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func newConnectionID() string {
	b := make([]byte, 8)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return fmt.Sprintf("conn-%d", time.Now().UnixNano())
	}
	return "conn-" + hex.EncodeToString(b)
}
