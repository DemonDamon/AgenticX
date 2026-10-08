// Package connection 管理连接记录：凭据以 AES-GCM 加密落盘，明文只在 Reveal 时解出。
package connection

import (
	"context"
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
	"sync"
	"time"

	"github.com/agenticx/connector-runtime/internal/secret"
)

// Secret 连接凭据（解密后的形态，仅在网关进程内使用，绝不进入 Agent）。
type Secret struct {
	APIKey       string `json:"apiKey,omitempty"`       // api_key / bearer
	AccessKeyID  string `json:"accessKeyId,omitempty"`  // hmac
	SecretKey    string `json:"secretKey,omitempty"`    // hmac
	ClientID     string `json:"clientId,omitempty"`     // oauth2
	ClientSecret string `json:"clientSecret,omitempty"` // oauth2
	RefreshToken string `json:"refreshToken,omitempty"` // oauth2 authorization_code
}

// IsZero 无任何凭据材料。
func (s Secret) IsZero() bool { return s == Secret{} }

// Identity 用于去重的凭据身份（同一连接器下身份相同视为同一连接）。
// oauth2 以 clientId 为身份（refresh_token 会轮换，不参与比较）。
func (s Secret) Identity() string {
	switch {
	case s.AccessKeyID != "":
		return "ak:" + s.AccessKeyID + "\x00" + s.SecretKey
	case s.ClientID != "":
		return "oauth:" + s.ClientID
	case s.APIKey != "":
		return "key:" + s.APIKey
	}
	return ""
}

// ErrDuplicate 同连接器下已存在相同凭据（或同名）连接。
var ErrDuplicate = errors.New("duplicate connection")

// Connection 连接记录（存储形态：含加密后的凭据密文）。
type Connection struct {
	ID              string    `json:"id"`
	ConnectorID     string    `json:"connectorId"`
	Name            string    `json:"name"`
	AuthType        string    `json:"authType"`
	GrantedScopes   []string  `json:"grantedScopes,omitempty"`
	EncryptedSecret string    `json:"encryptedSecret"` // base64(nonce||ct)
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt,omitempty"`
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
	mu     sync.RWMutex
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
	s.mu.Lock()
	defer s.mu.Unlock()
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

// Get 按 id 查询投影。ctx 仅为接口对齐保留（本地文件形态无 IO 发起）。
func (s *Store) Get(_ context.Context, id string) (Projection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c, ok := s.conns[id]
	if !ok {
		return Projection{}, false
	}
	return c.projection(), true
}

// List 全量投影（按创建时间排序）。ctx 仅为接口对齐保留。
func (s *Store) List(_ context.Context) []Projection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Projection, 0, len(s.conns))
	for _, c := range s.conns {
		out = append(out, c.projection())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// Delete 删除连接；不存在返回 false。
func (s *Store) Delete(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.conns[id]; !ok {
		return false
	}
	delete(s.conns, id)
	if err := s.save(); err != nil {
		return false // 尽力而为：内存已删，落盘失败下次启动会恢复，极端情况由审计兜底
	}
	return true
}

// Reveal 解密凭据（仅执行器调用）。ctx 仅为接口对齐保留。
func (s *Store) Reveal(_ context.Context, id string) (Secret, error) {
	s.mu.RLock()
	c, ok := s.conns[id]
	s.mu.RUnlock()
	if !ok {
		return Secret{}, os.ErrNotExist
	}
	return s.decrypt(c)
}

func (s *Store) decrypt(c *Connection) (Secret, error) {
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

// FindDuplicate 查找同连接器下凭据身份相同或同名的连接（去重：一模板一凭据一实例）。
// 返回命中的投影与原因（same_credential / same_name）。
func (s *Store) FindDuplicate(connectorID, name string, sec Secret) (Projection, string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ident := sec.Identity()
	for _, c := range s.conns {
		if c.ConnectorID != connectorID {
			continue
		}
		if ident != "" {
			if old, err := s.decrypt(c); err == nil && old.Identity() == ident {
				return c.projection(), "same_credential", true
			}
		}
		if name != "" && strings.EqualFold(strings.TrimSpace(c.Name), strings.TrimSpace(name)) {
			return c.projection(), "same_name", true
		}
	}
	return Projection{}, "", false
}

// UpdateSecret 替换连接凭据（如 OAuth refresh_token 轮换、用户更新密钥）。
func (s *Store) UpdateSecret(_ context.Context, id string, sec Secret) error {
	secJSON, err := json.Marshal(sec)
	if err != nil {
		return err
	}
	enc, err := s.cipher.EncryptString(string(secJSON))
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.conns[id]
	if !ok {
		return os.ErrNotExist
	}
	prev, prevAt := c.EncryptedSecret, c.UpdatedAt
	c.EncryptedSecret = enc
	c.UpdatedAt = time.Now().UTC()
	if err := s.save(); err != nil {
		c.EncryptedSecret, c.UpdatedAt = prev, prevAt
		return err
	}
	return nil
}

// DeleteByConnector 删除某连接器下全部连接（注销连接器时联动），返回删除数。
func (s *Store) DeleteByConnector(connectorID string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for id, c := range s.conns {
		if c.ConnectorID == connectorID {
			delete(s.conns, id)
			n++
		}
	}
	if n > 0 {
		_ = s.save()
	}
	return n
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
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID() string {
	b := make([]byte, 8)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic(err)
	}
	return "conn-" + hex.EncodeToString(b)
}
