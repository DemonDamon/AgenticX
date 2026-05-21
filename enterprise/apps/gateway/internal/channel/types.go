package channel

import (
	"encoding/json"
	"strings"
	"time"
)

const (
	StatusActive   = "active"
	StatusDisabled = "disabled"
)

// Channel 描述一条可路由的上游通道。
type Channel struct {
	ID              string            `json:"id"`
	TenantID        string            `json:"tenantId"`
	Name            string            `json:"name"`
	ProviderType    string            `json:"providerType"`
	BaseURL         string            `json:"baseUrl"`
	APIKey          string            `json:"apiKey,omitempty"`
	Weight          int               `json:"weight"`
	Priority        int               `json:"priority"`
	Status          string            `json:"status"`
	SupportedModels []string          `json:"supportedModels"`
	Metadata        map[string]any    `json:"metadata,omitempty"`
	MaxRetries      int               `json:"maxRetries,omitempty"`
	Route           string            `json:"route,omitempty"`
	ProviderLabel   string            `json:"providerLabel,omitempty"`
}

// SnapshotFile 与 admin internal API / channels.json 对齐。
type SnapshotFile struct {
	Channels []Channel `json:"channels"`
}

func (c Channel) Active() bool {
	return strings.EqualFold(strings.TrimSpace(c.Status), StatusActive)
}

func (c Channel) SupportsModel(model string) bool {
	model = strings.TrimSpace(model)
	if model == "" {
		return false
	}
	if len(c.SupportedModels) == 0 {
		return true
	}
	for _, m := range c.SupportedModels {
		if strings.EqualFold(strings.TrimSpace(m), model) {
			return true
		}
	}
	return false
}

func (c Channel) KeyRefs() []string {
	if c.Metadata == nil {
		return nil
	}
	raw, ok := c.Metadata["keyRefs"]
	if !ok {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	default:
		return nil
	}
}

func (c Channel) KeyPoolID() string {
	if c.Metadata == nil {
		return ""
	}
	if v, ok := c.Metadata["keyPoolId"].(string); ok {
		return strings.TrimSpace(v)
	}
	if v, ok := c.Metadata["key_pool_id"].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

// Attempt 记录一次上游调用尝试，写入审计。
type Attempt struct {
	ChannelID   string `json:"channel_id"`
	Provider    string `json:"provider,omitempty"`
	Success     bool   `json:"success"`
	RetryReason string `json:"retry_reason,omitempty"`
	LatencyMS   int64  `json:"latency_ms,omitempty"`
}

func AttemptsJSON(attempts []Attempt) json.RawMessage {
	if len(attempts) == 0 {
		return nil
	}
	raw, _ := json.Marshal(attempts)
	return raw
}

// Stat 内存态健康统计。
type Stat struct {
	SuccessCount int64
	FailureCount int64
	LastError    string
	CooldownUntil time.Time
	LastSuccess  time.Time
}

func (s *Stat) InCooldown(now time.Time) bool {
	if s == nil {
		return false
	}
	return !s.CooldownUntil.IsZero() && now.Before(s.CooldownUntil)
}

func (s *Stat) SuccessRate() float64 {
	if s == nil {
		return 0
	}
	total := s.SuccessCount + s.FailureCount
	if total == 0 {
		return 0
	}
	return float64(s.SuccessCount) / float64(total)
}
