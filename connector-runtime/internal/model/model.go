// Package model 定义连接器声明模型：连接器定义（JSON）是目录与执行的唯一事实源。
package model

import (
	"encoding/json"
	"fmt"
	neturl "net/url"
	"regexp"
	"strings"
)

// AuthType 连接器认证类型。01 阶段支持 none / api_key；oauth2 归后续供给阶段。
type AuthType string

const (
	AuthNone   AuthType = "none"
	AuthAPIKey AuthType = "api_key"
)

// APIKeyAuth 描述 api_key 的注入位置。
type APIKeyAuth struct {
	In   string `json:"in"`   // header | query
	Name string `json:"name"` // 如 "X-API-Key"
}

// AuthSpec 认证规格。
type AuthSpec struct {
	Type   AuthType     `json:"type"`
	APIKey *APIKeyAuth  `json:"apiKey,omitempty"`
}

// HTTPAction 动作的 HTTP 执行规格。Path/Query/Header 值可含 {param} 占位符，
// 执行时以输入渲染（缺参属调用方输入错误）。
type HTTPAction struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Query   map[string]string `json:"query,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// Action 动作声明。ID 规则为 "<connectorID>.<name>"。
type Action struct {
	ID             string         `json:"id"`
	Title          string         `json:"title"`
	Description    string         `json:"description,omitempty"`
	OperationType  string         `json:"operationType"` // read | write | destructive
	InputSchema    map[string]any `json:"inputSchema,omitempty"`
	OutputSchema   map[string]any `json:"outputSchema,omitempty"`
	RequiredScopes []string       `json:"requiredScopes,omitempty"`
	HTTP           HTTPAction     `json:"http"`
}

// Connector 连接器定义。
type Connector struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"displayName"`
	Description string   `json:"description,omitempty"`
	HomepageURL string   `json:"homepageUrl,omitempty"`
	Categories  []string `json:"categories,omitempty"`
	BaseURL     string   `json:"baseUrl"`
	Auth        AuthSpec `json:"auth"`
	Actions     []Action `json:"actions"`
}

var (
	idPattern      = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`)
	methodPattern  = regexp.MustCompile(`^[A-Z]+$`)
	validOps       = map[string]bool{"read": true, "write": true, "destructive": true}
	validAPIKeyIn  = map[string]bool{"header": true, "query": true}
)

// Parse 从 JSON 解析连接器定义并校验。
func Parse(data []byte) (*Connector, error) {
	var c Connector
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("解析连接器定义失败: %w", err)
	}
	if err := c.Validate(); err != nil {
		return nil, err
	}
	return &c, nil
}

// Validate 校验定义合法性，返回首个错误。
func (c *Connector) Validate() error {
	if !idPattern.MatchString(c.ID) {
		return fmt.Errorf("连接器 id %q 不合法（需小写字母/数字/连字符）", c.ID)
	}
	if strings.TrimSpace(c.DisplayName) == "" {
		return fmt.Errorf("连接器 %s: displayName 不能为空", c.ID)
	}
	if err := validateBaseURL(c.BaseURL); err != nil {
		return fmt.Errorf("连接器 %s: %w", c.ID, err)
	}
	if err := c.Auth.validate(); err != nil {
		return fmt.Errorf("连接器 %s: %w", c.ID, err)
	}
	if len(c.Actions) == 0 {
		return fmt.Errorf("连接器 %s: 至少需要一个 action", c.ID)
	}
	seen := map[string]bool{}
	for i := range c.Actions {
		if err := c.Actions[i].validate(c.ID); err != nil {
			return err
		}
		if seen[c.Actions[i].ID] {
			return fmt.Errorf("连接器 %s: action id 重复 %q", c.ID, c.Actions[i].ID)
		}
		seen[c.Actions[i].ID] = true
	}
	return nil
}

func (a *AuthSpec) validate() error {
	switch a.Type {
	case AuthNone:
		return nil
	case AuthAPIKey:
		if a.APIKey == nil {
			return fmt.Errorf("api_key 认证缺少 apiKey 规格")
		}
		if !validAPIKeyIn[a.APIKey.In] {
			return fmt.Errorf("apiKey.in 必须是 header 或 query，得到 %q", a.APIKey.In)
		}
		if strings.TrimSpace(a.APIKey.Name) == "" {
			return fmt.Errorf("apiKey.name 不能为空")
		}
		return nil
	default:
		return fmt.Errorf("不支持的认证类型 %q（当前支持 none / api_key）", a.Type)
	}
}

func (a *Action) validate(connectorID string) error {
	prefix := connectorID + "."
	if !strings.HasPrefix(a.ID, prefix) || len(a.ID) <= len(prefix) {
		return fmt.Errorf("action id %q 必须以 %q 为前缀且非空", a.ID, prefix)
	}
	if strings.TrimSpace(a.Title) == "" {
		return fmt.Errorf("action %s: title 不能为空", a.ID)
	}
	if !validOps[a.OperationType] {
		return fmt.Errorf("action %s: operationType 必须是 read/write/destructive，得到 %q", a.ID, a.OperationType)
	}
	if !methodPattern.MatchString(a.HTTP.Method) {
		return fmt.Errorf("action %s: http.method 不合法 %q", a.ID, a.HTTP.Method)
	}
	if !strings.HasPrefix(a.HTTP.Path, "/") {
		return fmt.Errorf("action %s: http.path 必须以 / 开头", a.ID)
	}
	return nil
}

// validateBaseURL 校验上游基址：仅 http/https、无 userinfo、无 query/fragment。
func validateBaseURL(raw string) error {
	u, err := neturl.Parse(raw)
	if err != nil {
		return fmt.Errorf("baseUrl 不合法: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("baseUrl scheme 必须是 http/https，得到 %q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("baseUrl 缺少 host")
	}
	if u.User != nil {
		return fmt.Errorf("baseUrl 不允许携带 userinfo")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("baseUrl 不允许携带 query/fragment")
	}
	return nil
}
