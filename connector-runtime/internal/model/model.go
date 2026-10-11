// Package model 定义连接器声明模型：连接器定义（JSON）是目录与执行的唯一事实源。
package model

import (
	"encoding/json"
	"fmt"
	neturl "net/url"
	"regexp"
	"strings"
)

// AuthType 连接器认证类型：none / api_key / bearer / hmac（AK/SK 签名）/ oauth2。
type AuthType string

const (
	AuthNone   AuthType = "none"
	AuthAPIKey AuthType = "api_key"
	AuthBearer AuthType = "bearer" // Authorization: Bearer <apiKey>
	AuthHMAC   AuthType = "hmac"   // 通用 HMAC-SHA256 请求签名（AK/SK）
	AuthOAuth2 AuthType = "oauth2" // client_credentials / authorization_code（refresh_token）
)

// HMACAuth 通用 header 式 HMAC 签名规格。
//
// 签名串 StringToSign 为模板，可用占位：{method} {path} {query}（按 key 排序的
// 已编码 query）{timestamp} {nonce} {body_sha256}（hex）{access_key} {host}，
// 以及 "\n" 字面换行。默认模板：
// "{method}\n{path}\n{query}\n{timestamp}\n{body_sha256}"。
type HMACAuth struct {
	Algorithm         string `json:"algorithm,omitempty"`         // 仅 hmac-sha256（默认）
	AccessKeyHeader   string `json:"accessKeyHeader"`             // 如 X-Access-Key
	SignatureHeader   string `json:"signatureHeader"`             // 如 X-Signature
	TimestampHeader   string `json:"timestampHeader,omitempty"`   // 如 X-Timestamp（空则不发送，但 {timestamp} 仍可用）
	TimestampFormat   string `json:"timestampFormat,omitempty"`   // unix（默认）| unix_ms | rfc3339
	NonceHeader       string `json:"nonceHeader,omitempty"`       // 可选
	StringToSign      string `json:"stringToSign,omitempty"`      // 模板，见上
	SignatureEncoding string `json:"signatureEncoding,omitempty"` // hex（默认）| base64
	SignaturePrefix   string `json:"signaturePrefix,omitempty"`   // 签名值前缀，如 "HMAC-SHA256 "
}

// OAuth2Auth OAuth 2.0 规格。client_credentials 由网关按 tokenUrl 换取并缓存
// access token（过期/401 自动重取）；authorization_code 的授权由宿主（桌面端
// 系统浏览器 + 环回回调 + PKCE）完成，网关仅持有 refresh_token 并负责刷新。
type OAuth2Auth struct {
	Grant        string   `json:"grant"`                  // client_credentials | authorization_code
	TokenURL     string   `json:"tokenUrl"`               // 必填
	AuthorizeURL string   `json:"authorizeUrl,omitempty"` // authorization_code 必填（宿主授权用）
	Scopes       []string `json:"scopes,omitempty"`
	ClientAuth   string   `json:"clientAuth,omitempty"` // body（默认）| basic
}

// APIKeyAuth 描述 api_key 的注入位置。
type APIKeyAuth struct {
	In   string `json:"in"`   // header | query
	Name string `json:"name"` // 如 "X-API-Key"
}

// AuthSpec 认证规格。
type AuthSpec struct {
	Type   AuthType    `json:"type"`
	APIKey *APIKeyAuth `json:"apiKey,omitempty"`
	HMAC   *HMACAuth   `json:"hmac,omitempty"`
	OAuth2 *OAuth2Auth `json:"oauth2,omitempty"`
}

// HTTPAction 动作的 HTTP 执行规格。Path/Query/Header 值可含 {param} 占位符，
// 执行时以输入渲染（缺参属调用方输入错误）。
type HTTPAction struct {
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Query   map[string]string `json:"query,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	// BodyField 非空时请求体取 input[BodyField]（而非整个输入），
	// 便于 OpenAPI 导入时把 path/query 参数与请求体分开。
	BodyField string `json:"bodyField,omitempty"`
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
	// AllowPrivateNetwork 该连接器允许访问私网/环回上游（用户显式登记的内网/本机 API）。
	// 仅对该连接器生效；其余连接器仍受出网守护约束。
	AllowPrivateNetwork bool `json:"allowPrivateNetwork,omitempty"`
}

var (
	idPattern     = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`)
	methodPattern = regexp.MustCompile(`^[A-Z]+$`)
	validOps      = map[string]bool{"read": true, "write": true, "destructive": true}
	validAPIKeyIn = map[string]bool{"header": true, "query": true}
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
	case AuthBearer:
		return nil
	case AuthHMAC:
		h := a.HMAC
		if h == nil {
			return fmt.Errorf("hmac 认证缺少 hmac 规格")
		}
		if h.Algorithm != "" && strings.ToLower(h.Algorithm) != "hmac-sha256" {
			return fmt.Errorf("hmac.algorithm 仅支持 hmac-sha256，得到 %q", h.Algorithm)
		}
		if strings.TrimSpace(h.AccessKeyHeader) == "" || strings.TrimSpace(h.SignatureHeader) == "" {
			return fmt.Errorf("hmac.accessKeyHeader 与 hmac.signatureHeader 不能为空")
		}
		switch h.TimestampFormat {
		case "", "unix", "unix_ms", "rfc3339":
		default:
			return fmt.Errorf("hmac.timestampFormat 仅支持 unix/unix_ms/rfc3339，得到 %q", h.TimestampFormat)
		}
		switch h.SignatureEncoding {
		case "", "hex", "base64":
		default:
			return fmt.Errorf("hmac.signatureEncoding 仅支持 hex/base64，得到 %q", h.SignatureEncoding)
		}
		return nil
	case AuthOAuth2:
		o := a.OAuth2
		if o == nil {
			return fmt.Errorf("oauth2 认证缺少 oauth2 规格")
		}
		if o.Grant != "client_credentials" && o.Grant != "authorization_code" {
			return fmt.Errorf("oauth2.grant 仅支持 client_credentials/authorization_code，得到 %q", o.Grant)
		}
		if err := validateEndpointURL(o.TokenURL); err != nil {
			return fmt.Errorf("oauth2.tokenUrl: %w", err)
		}
		if o.Grant == "authorization_code" {
			if err := validateEndpointURL(o.AuthorizeURL); err != nil {
				return fmt.Errorf("oauth2.authorizeUrl: %w", err)
			}
		}
		if o.ClientAuth != "" && o.ClientAuth != "body" && o.ClientAuth != "basic" {
			return fmt.Errorf("oauth2.clientAuth 仅支持 body/basic，得到 %q", o.ClientAuth)
		}
		return nil
	default:
		return fmt.Errorf("不支持的认证类型 %q（支持 none / api_key / bearer / hmac / oauth2）", a.Type)
	}
}

// validateEndpointURL 校验 OAuth 端点：http(s)、有 host、无 userinfo（允许 query）。
func validateEndpointURL(raw string) error {
	u, err := neturl.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return fmt.Errorf("须为 http(s) 绝对地址")
	}
	if u.User != nil {
		return fmt.Errorf("不允许携带 userinfo")
	}
	return nil
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
