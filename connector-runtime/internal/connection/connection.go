// Package connection 管理连接记录：凭据以 AES-GCM 加密落盘，明文只在 Reveal 时解出。
package connection

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/agenticx/connector-runtime/internal/secret"
)

// Secret 连接凭据（解密后的形态，仅在网关进程内使用，绝不进入 Agent）。
type Secret struct {
	APIKey string `json:"apiKey,omitempty"`
}

// Connection 连接记录（存储形态：含加密后的凭据密文）。
type Connection struct {
	ID              string    `json:"id"`
	ConnectorID     string    `json:"connectorId"`
	Name            string    `json:"name"`
	AuthType        string    `json:"authType"`
	GrantedScopes   []string  `json:"grantedScopes,omitempty"`
	EncryptedSecret string    `json:"encryptedSecret"` // base64(nonce||ct)
	CreatedAt       time.Time `json:"createdAt"`
}

// Projection 连接对外的列表/查询投影：不含任何凭据材料（连密文也不出）。
type Projection struct {
	ID            string    `json:"id"`
	ConnectorID   string    `json:"connectorId"`
	Name          string    `json:"name"`
	AuthType      string    `json:"authType"`
	GrantedScopes []string  `json:"grantedScopes,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Store 连接存储：单文件 JSON + 内存索引。
type Store struct {
	path   string
	cipher *secret.Cipher
	conns  map[string]*Connection
}

// Open 打开（或初始化）数据目录下的连接存储。
func Open(dir string, c *secret.Cipher) (*Store, error) {
	s := &Store{
		path:   filepath.Join(dir, "connections.json"),
		cipher: c,
		conns:  map[string]*Connection{},
	}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if len(b) == 0 {
		return s, nil
	}
	var list []*Connection
	if err := json.Unmarshal(b, &list); err != nil {
		return nil, fmt.Errorf("连接存储损坏: %w", err)
	}
	for _, c := range list {
		s.conns[c.ID] = c
	}
	return s, nil
}

// Create 新建连接：凭据加密后落盘。
func (s *Store) Create(connectorID, name, authType string, grantedScopes []string, sec Secret) (*Projection, error) {
	if strings.TrimSpace(connectorID) == "" || strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("connectorID 与 name 不能为空")
	}
	secJSON, err := json.Marshal(sec)
	if err != nil {
		return nil, err
	}
	enc, err := s.cipher.EncryptString(string(secJSON))
	if err != nil {
		return nil, err
	}
	c := &Connection{
		ID:              newID(),
		ConnectorID:     connectorID,
		Name:            name,
		AuthType:        authType,
		GrantedScopes:   grantedScopes,
		EncryptedSecret: enc,
		CreatedAt:       time.Now().UTC(),
	}
	s.conns[c.ID] = c
	if err := s.save(); err != nil {
		delete(s.conns, c.ID)
		return nil, err
	}
	p := c.projection()
	return &p, nil
}

// Get 按 id 查询投影。
func (s *Store) Get(id string) (Projection, bool) {
	c, ok := s.conns[id]
	if !ok {
		return Projection{}, false
	}
	return c.projection(), true
}

// List 全量投影（按创建时间排序）。
func (s *Store) List() []Projection {
	out := make([]Projection, 0, len(s.conns))
	for _, c := range s.conns {
		out = append(out, c.projection())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// Delete 删除连接；不存在返回 false。
func (s *Store) Delete(id string) bool {
	if _, ok := s.conns[id]; !ok {
		return false
	}
	delete(s.conns, id)
	if err := s.save(); err != nil {
		return false // 尽力而为：内存已删，落盘失败下次启动会恢复，极端情况由审计兜底
	}
	return true
}

// Reveal 解密凭据（仅执行器调用）。
func (s *Store) Reveal(id string) (Secret, error) {
	c, ok := s.conns[id]
	if !ok {
		return Secret{}, os.ErrNotExist
	}
	pt, err := s.cipher.DecryptString(c.EncryptedSecret)
	if err != nil {
		return Secret{}, fmt.Errorf("凭据解密失败: %w", err)
	}
	var sec Secret
	if err := json.Unmarshal([]byte(pt), &sec); err != nil {
		return Secret{}, fmt.Errorf("凭据格式损坏: %w", err)
	}
	return sec, nil
}

func (c *Connection) projection() Projection {
	return Projection{
		ID:            c.ID,
		ConnectorID:   c.ConnectorID,
		Name:          c.Name,
		AuthType:      c.AuthType,
		GrantedScopes: c.GrantedScopes,
		CreatedAt:     c.CreatedAt,
	}
}

func (s *Store) save() error {
	list := make([]*Connection, 0, len(s.conns))
	for _, c := range s.conns {
		list = append(list, c)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt.Before(list[j].CreatedAt) })
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(s.path, b, 0o600)
}

func newID() string {
	b := make([]byte, 8)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic(err)
	}
	return "conn-" + hex.EncodeToString(b)
}
