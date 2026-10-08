// Package catalog 提供目录视图：连接器定义为源生成的内存投影（搜索/发现用），
// schema 等执行细节不出现在投影中；ETag 供缓存协商。
package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/agenticx/connector-runtime/internal/model"
)

// AppSummary 连接器目录卡片投影。
type AppSummary struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"displayName"`
	Description string   `json:"description,omitempty"`
	HomepageURL string   `json:"homepageUrl,omitempty"`
	Categories  []string `json:"categories,omitempty"`
	AuthType    string   `json:"authType"`
	ActionCount int      `json:"actionCount"`
	// Origin 定义来源：builtin（内置/启动目录）| user（运行时登记，可更新/注销）。
	Origin string `json:"origin,omitempty"`
	// BaseURL 仅 user 来源投影（便于管理面展示/去重）；内置连接器不输出。
	BaseURL string `json:"baseUrl,omitempty"`
}

// 定义来源。
const (
	OriginBuiltin = "builtin"
	OriginUser    = "user"
)

// ActionSummary 动作目录投影（无 schema）。
type ActionSummary struct {
	ID             string   `json:"id"`
	ConnectorID    string   `json:"connectorId"`
	Title          string   `json:"title"`
	Description    string   `json:"description,omitempty"`
	OperationType  string   `json:"operationType"`
	Categories     []string `json:"categories,omitempty"`
	RequiredScopes []string `json:"requiredScopes,omitempty"`
}

// snapshot 目录的一个不可变版本（Replace 时整体替换，读侧无锁拷贝指针）。
type snapshot struct {
	connectors  []*model.Connector
	actionsByID map[string]*model.Action
	origins     map[string]string
	etag        string
}

// Store 目录存储：内存视图，支持运行时整体替换（用户登记的连接器热加载）。
// 同一 *Store 指针被 MCP/工具层持有，Replace 后立即对新请求生效。
type Store struct {
	mu   sync.RWMutex
	snap *snapshot
}

// New 构建目录；连接器 id 重复视为错误（防漂移）。来源默认 builtin。
func New(connectors []*model.Connector) (*Store, error) {
	snap, err := build(connectors, nil)
	if err != nil {
		return nil, err
	}
	return &Store{snap: snap}, nil
}

// Replace 以新的连接器全集替换目录（origins: id→来源，缺省 builtin）。
// 校验失败时保持原目录不变。
func (s *Store) Replace(connectors []*model.Connector, origins map[string]string) error {
	snap, err := build(connectors, origins)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.snap = snap
	s.mu.Unlock()
	return nil
}

// Origin 返回连接器来源（不存在返回空串）。
func (s *Store) Origin(id string) string {
	sn := s.cur()
	for _, c := range sn.connectors {
		if c.ID == id {
			return originOf(sn, id)
		}
	}
	return ""
}

func (s *Store) cur() *snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snap
}

func originOf(sn *snapshot, id string) string {
	if o := sn.origins[id]; o != "" {
		return o
	}
	return OriginBuiltin
}

func build(connectors []*model.Connector, origins map[string]string) (*snapshot, error) {
	s := &snapshot{connectors: make([]*model.Connector, 0, len(connectors)), actionsByID: map[string]*model.Action{}, origins: map[string]string{}}
	for k, v := range origins {
		s.origins[k] = v
	}
	seen := map[string]bool{}
	for _, c := range connectors {
		if seen[c.ID] {
			return nil, fmt.Errorf("连接器 id 重复: %s", c.ID)
		}
		seen[c.ID] = true
		cc := c
		s.connectors = append(s.connectors, cc)
		for i := range cc.Actions {
			a := &cc.Actions[i]
			if _, dup := s.actionsByID[a.ID]; dup {
				return nil, fmt.Errorf("action id 重复: %s", a.ID)
			}
			s.actionsByID[a.ID] = a
		}
	}
	s.etag = computeETag(s)
	return s, nil
}

// Apps 全量连接器投影（按 id 排序，输出稳定）。
func (s *Store) Apps() []AppSummary { return appsOf(s.cur()) }

func appsOf(sn *snapshot) []AppSummary {
	out := make([]AppSummary, 0, len(sn.connectors))
	for _, c := range sn.connectors {
		origin := originOf(sn, c.ID)
		sum := AppSummary{
			ID:          c.ID,
			DisplayName: c.DisplayName,
			Description: c.Description,
			HomepageURL: c.HomepageURL,
			Categories:  c.Categories,
			AuthType:    string(c.Auth.Type),
			ActionCount: len(c.Actions),
			Origin:      origin,
		}
		if origin == OriginUser {
			sum.BaseURL = c.BaseURL
		}
		out = append(out, sum)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Actions 动作投影，可按连接器过滤；query 为空返回全部，否则子串匹配
// id / title / description / categories（大小写不敏感）。
func (s *Store) Actions(query, connectorID string) []ActionSummary {
	return actionsOf(s.cur(), query, connectorID)
}

func actionsOf(sn *snapshot, query, connectorID string) []ActionSummary {
	q := strings.ToLower(strings.TrimSpace(query))
	out := []ActionSummary{}
	for _, c := range sn.connectors {
		if connectorID != "" && c.ID != connectorID {
			continue
		}
		for i := range c.Actions {
			a := &c.Actions[i]
			if q != "" && !actionMatches(a, c, q) {
				continue
			}
			out = append(out, ActionSummary{
				ID:             a.ID,
				ConnectorID:    c.ID,
				Title:          a.Title,
				Description:    a.Description,
				OperationType:  a.OperationType,
				Categories:     c.Categories,
				RequiredScopes: a.RequiredScopes,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Action 精确查找动作，返回动作与所属连接器。
func (s *Store) Action(id string) (model.Action, *model.Connector, bool) {
	sn := s.cur()
	a, ok := sn.actionsByID[id]
	if !ok {
		return model.Action{}, nil, false
	}
	for _, c := range sn.connectors {
		if strings.HasPrefix(a.ID, c.ID+".") {
			return *a, c, true
		}
	}
	return model.Action{}, nil, false // 不可达：actionsByID 与 connectors 同源
}

// Connector 按 id 查找连接器。
func (s *Store) Connector(id string) (*model.Connector, bool) {
	for _, c := range s.cur().connectors {
		if c.ID == id {
			return c, true
		}
	}
	return nil, false
}

// ETag 目录内容指纹（排序后哈希，内容不变则稳定）。
func (s *Store) ETag() string { return s.cur().etag }

// Count 连接器数量。
func (s *Store) Count() int { return len(s.cur().connectors) }

// All 当前全部连接器（只读，调用方不得修改）。
func (s *Store) All() []*model.Connector {
	sn := s.cur()
	out := make([]*model.Connector, len(sn.connectors))
	copy(out, sn.connectors)
	return out
}

func actionMatches(a *model.Action, c *model.Connector, q string) bool {
	hay := strings.ToLower(a.ID + " " + a.Title + " " + a.Description + " " + strings.Join(c.Categories, " "))
	return strings.Contains(hay, q)
}

func computeETag(s *snapshot) string {
	payload := struct {
		Apps    []AppSummary    `json:"apps"`
		Actions []ActionSummary `json:"actions"`
	}{Apps: appsOf(s), Actions: actionsOf(s, "", "")}
	b, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(b)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}
