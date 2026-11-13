package moderation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// CheckRequest 是一次内容安全审核的输入（SP3 compliance-moderation）。
type CheckRequest struct {
	TenantID    string   `json:"tenantId"`
	Stage       string   `json:"stage"` // request | response
	Text        string   `json:"text"`
	Categories  []string `json:"categories,omitempty"`
}

// Verdict 是 provider 的判定结论。
type Verdict struct {
	Blocked    bool    `json:"blocked"`
	Categories []string `json:"categories,omitempty"`
	Score      float64 `json:"score,omitempty"`
	Detail     string  `json:"detail,omitempty"`
}

// Provider 是第三方内容安全服务的可插拔适配接口。
// 实现方自行封装厂商协议（阿里云内容安全/腾讯天御/数美等），
// 网关只依赖本契约。新增厂商 = 新增一个 Provider 实现。
type Provider interface {
	Name() string
	Check(ctx context.Context, req CheckRequest) (Verdict, error)
}

// noopProvider 用于未配置 provider 的租户：不外呼、不阻断（现状等价）。
type noopProvider struct{}

func (noopProvider) Name() string { return "noop" }

func (noopProvider) Check(context.Context, CheckRequest) (Verdict, error) {
	return Verdict{}, nil
}

// NewNoopProvider 返回空实现；测试与未配置路径使用。
func NewNoopProvider() Provider { return noopProvider{} }

// httpProvider 走通用 JSON 契约（SP3 既定的 canonical contract）：
//
//	POST {url}
//	Authorization: Bearer {apiKey}
//	{"tenantId":"…","stage":"request","text":"…","categories":[…]}
//	→ {"blocked":true,"categories":["porn"],"score":0.97,"detail":"…"}
//
// 任何厂商均可经薄 shim 适配该契约；后续如需原生 SDK 再加实现。
type httpProvider struct {
	name    string
	url     string
	apiKey  string
	client  *http.Client
}

func NewHTTPProvider(name, url, apiKey string, timeout time.Duration) Provider {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	return &httpProvider{
		name:   strings.TrimSpace(name),
		url:    strings.TrimSpace(url),
		apiKey: strings.TrimSpace(apiKey),
		client: &http.Client{Timeout: timeout},
	}
}

func (p *httpProvider) Name() string {
	if p.name != "" {
		return p.name
	}
	return "http"
}

type httpCheckResponse struct {
	Blocked    bool     `json:"blocked"`
	Categories []string `json:"categories"`
	Score      float64  `json:"score"`
	Detail     string   `json:"detail"`
}

func (p *httpProvider) Check(ctx context.Context, req CheckRequest) (Verdict, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return Verdict{}, fmt.Errorf("moderation request encode: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.url, bytes.NewReader(body))
	if err != nil {
		return Verdict{}, fmt.Errorf("moderation request build: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return Verdict{}, fmt.Errorf("moderation provider call: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Verdict{}, fmt.Errorf("moderation provider returned http %d", resp.StatusCode)
	}
	var parsed httpCheckResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return Verdict{}, fmt.Errorf("moderation provider decode: %w", err)
	}
	return Verdict{
		Blocked:    parsed.Blocked,
		Categories: parsed.Categories,
		Score:      parsed.Score,
		Detail:     parsed.Detail,
	}, nil
}
