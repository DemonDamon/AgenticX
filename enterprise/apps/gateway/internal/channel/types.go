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

// LatencyRingSize 控制每个 Channel 在内存中保留的 latency 样本数，用于 p50 计算。
const LatencyRingSize = 64

// Stat 内存态健康统计。
type Stat struct {
	SuccessCount  int64
	FailureCount  int64
	LastError     string
	CooldownUntil time.Time
	LastSuccess   time.Time
	// Latencies 环形缓冲（仅成功样本），长度上限 LatencyRingSize。
	Latencies []int64
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

// P50LatencyMS 返回当前 latency 样本的 p50（中位数）；样本不足时返回 0。
func (s *Stat) P50LatencyMS() int64 {
	if s == nil || len(s.Latencies) == 0 {
		return 0
	}
	buf := append([]int64(nil), s.Latencies...)
	sortInt64(buf)
	mid := len(buf) / 2
	return buf[mid]
}

func sortInt64(a []int64) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j-1] > a[j]; j-- {
			a[j-1], a[j] = a[j], a[j-1]
		}
	}
}
