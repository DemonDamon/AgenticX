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
}

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

// Store 目录存储（只读内存视图）。
type Store struct {
	connectors  []*model.Connector
	actionsByID map[string]*model.Action
	etag        string
}

// New 构建目录；连接器 id 重复视为错误（防漂移）。
func New(connectors []*model.Connector) (*Store, error) {
	s := &Store{connectors: make([]*model.Connector, 0, len(connectors)), actionsByID: map[string]*model.Action{}}
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
func (s *Store) Apps() []AppSummary {
	out := make([]AppSummary, 0, len(s.connectors))
	for _, c := range s.connectors {
		out = append(out, AppSummary{
			ID:          c.ID,
			DisplayName: c.DisplayName,
			Description: c.Description,
			HomepageURL: c.HomepageURL,
			Categories:  c.Categories,
			AuthType:    string(c.Auth.Type),
			ActionCount: len(c.Actions),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Actions 动作投影，可按连接器过滤；query 为空返回全部，否则子串匹配
// id / title / description / categories（大小写不敏感）。
func (s *Store) Actions(query, connectorID string) []ActionSummary {
	q := strings.ToLower(strings.TrimSpace(query))
	out := []ActionSummary{}
	for _, c := range s.connectors {
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
	a, ok := s.actionsByID[id]
	if !ok {
		return model.Action{}, nil, false
	}
	for _, c := range s.connectors {
		if strings.HasPrefix(a.ID, c.ID+".") {
			return *a, c, true
		}
	}
	return model.Action{}, nil, false // 不可达：actionsByID 与 connectors 同源
}

// Connector 按 id 查找连接器。
func (s *Store) Connector(id string) (*model.Connector, bool) {
	for _, c := range s.connectors {
		if c.ID == id {
			return c, true
		}
	}
	return nil, false
}

// ETag 目录内容指纹（排序后哈希，内容不变则稳定）。
func (s *Store) ETag() string { return s.etag }

// Count 连接器数量。
func (s *Store) Count() int { return len(s.connectors) }

func actionMatches(a *model.Action, c *model.Connector, q string) bool {
	hay := strings.ToLower(a.ID + " " + a.Title + " " + a.Description + " " + strings.Join(c.Categories, " "))
	return strings.Contains(hay, q)
}

func computeETag(s *Store) string {
	payload := struct {
		Apps    []AppSummary      `json:"apps"`
		Actions []ActionSummary   `json:"actions"`
	}{Apps: s.Apps(), Actions: s.Actions("", "")}
	b, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(b)
	return `"` + hex.EncodeToString(sum[:]) + `"`
}
