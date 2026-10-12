// Package connectorstore 连接器网关的企业存储层：连接器定义与连接（凭据
// AES-GCM 加密后入 PG 加密列，密钥不落业务表明文），多实例共享。
// 主密钥来自环境变量（KMS 分发后注入），未配置时凭据类连接不可用。
package connectorstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	connectorapi "github.com/agenticx/connector-runtime/api"
	"github.com/agenticx/enterprise/gateway/internal/database"
)

// MasterKeyEnv 主密钥环境变量：base64(std) 编码的 32 字节 AES-256 密钥。
const MasterKeyEnv = "GATEWAY_CONNECTOR_MASTER_KEY"

// Store 连接器定义与连接的 PG 存储。
type Store struct {
	db    *database.Handle
	logger *slog.Logger

	cipherOnce sync.Once
	cipherVal  *connectorapi.Cipher
	cipherErr  error
}

// New 构造存储。db 为 nil 时所有方法返回错误（宿主未启用数据库）。
func New(db *database.Handle, logger *slog.Logger) *Store {
	if logger == nil {
		logger = slog.Default()
	}
	return &Store{db: db, logger: logger}
}

// cipher 惰性加载主密钥并构造 AES-GCM 加解密器。
func (s *Store) cipher() (*connectorapi.Cipher, error) {
	s.cipherOnce.Do(func() {
		key := strings.TrimSpace(envMasterKey())
		if key == "" {
			s.cipherErr = fmt.Errorf("连接器主密钥未配置（%s，base64 编码 32 字节）", MasterKeyEnv)
			return
		}
		raw, err := decodeBase64Key(key)
		if err != nil {
			s.cipherErr = fmt.Errorf("连接器主密钥解码失败: %w", err)
			return
		}
		c, err := connectorapi.NewCipher(raw)
		if err != nil {
			s.cipherErr = err
			return
		}
		s.cipherVal = c
	})
	return s.cipherVal, s.cipherErr
}

// ---- 连接器定义 ----

// ListDefinitions 列出租户的全部活跃连接器定义（目录构建用）。
// 单行损坏时跳过并告警，不阻断整个目录。
func (s *Store) ListDefinitions(ctx context.Context, tenantID string) ([]*connectorapi.Connector, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("connectorstore: 数据库不可用")
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT definition FROM connector_definitions
WHERE tenant_id = ? AND status = 'active'
ORDER BY connector_id ASC`, strings.TrimSpace(tenantID))
	if err != nil {
		return nil, fmt.Errorf("查询连接器定义失败: %w", err)
	}
	defer rows.Close()
	out := []*connectorapi.Connector{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("读取连接器定义失败: %w", err)
		}
		def, err := connectorapi.ParseConnector(raw)
		if err != nil {
			s.logger.Warn("跳过损坏的连接器定义", "tenant", tenantID, "error", err)
			continue
		}
		out = append(out, def)
	}
	return out, rows.Err()
}

// UpsertDefinition 写入（或更新）连接器定义。
func (s *Store) UpsertDefinition(ctx context.Context, tenantID string, def *connectorapi.Connector) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connectorstore: 数据库不可用")
	}
	if def == nil {
		return fmt.Errorf("连接器定义为空")
	}
	if err := def.Validate(); err != nil {
		return err
	}
	raw, err := json.Marshal(def)
	if err != nil {
		return fmt.Errorf("序列化连接器定义失败: %w", err)
	}
	tenantID = strings.TrimSpace(tenantID)
	query := `
INSERT INTO connector_definitions (tenant_id, connector_id, definition, status, created_at, updated_at)
VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, connector_id) DO UPDATE
SET definition = ?, status = 'active', updated_at = CURRENT_TIMESTAMP`
	args := []any{tenantID, def.ID, raw, raw}
	if s.db.Dialect == database.MySQL {
		query = `
INSERT INTO connector_definitions (tenant_id, connector_id, definition, status, created_at, updated_at)
VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE definition = ?, status = 'active', updated_at = CURRENT_TIMESTAMP`
	}
	if _, err := s.db.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("写入连接器定义失败: %w", err)
	}
	return nil
}

// DeleteDefinition 删除连接器定义（返回是否确实删除）。
func (s *Store) DeleteDefinition(ctx context.Context, tenantID, connectorID string) (bool, error) {
	if s == nil || s.db == nil {
		return false, fmt.Errorf("connectorstore: 数据库不可用")
	}
	res, err := s.db.ExecContext(ctx, `
DELETE FROM connector_definitions WHERE tenant_id = ? AND connector_id = ?`,
		strings.TrimSpace(tenantID), strings.TrimSpace(connectorID))
	if err != nil {
		return false, fmt.Errorf("删除连接器定义失败: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
