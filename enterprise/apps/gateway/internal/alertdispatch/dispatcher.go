package alertdispatch

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
)

// Dispatcher 把安全/预算/审计链告警分发到租户配置的通道。
//
// 设计约束（对齐 MASTER-PLAN 统一纪律）：
//   - 无通道配置的租户零行为变化（现状等价）
//   - Dispatch 本身 never block 调用方：同步段只做查表与判重，发送在独立 goroutine
//   - 分发动作落审计（event_type=alert_dispatch，写入防篡改链）
//   - 去重：相同 DedupKey 在窗口内只发第一条（重复丢弃不落审计，避免链被噪声淹没）
//   - 限流：通道级滑动窗口，超限 outcome=rate_limited 且落审计
type Dispatcher struct {
	loader *ConfigLoader
	audit  audit.EventWriter
	logger *slog.Logger
	client *http.Client

	mu        sync.Mutex
	dedup     map[string]time.Time // dedup key -> last sent at
	rateSends map[string][]time.Time
}

// NewDispatcher 构造分发器。audit 可为 nil（无审计时的降级：仅日志）。
func NewDispatcher(loader *ConfigLoader, writer audit.EventWriter, logger *slog.Logger) *Dispatcher {
	if logger == nil {
		logger = slog.Default()
	}
	return &Dispatcher{
		loader:    loader,
		audit:     writer,
		logger:    logger,
		client:    &http.Client{Timeout: 5 * time.Second},
		dedup:     map[string]time.Time{},
		rateSends: map[string][]time.Time{},
	}
}

// Start 启动配置轮询。
func (d *Dispatcher) Start(stop <-chan struct{}) {
	if d.loader != nil {
		d.loader.Start(stop)
	}
}

// Dispatch 是告警入口；同步返回，异步发送+审计。
func (d *Dispatcher) Dispatch(alert Alert) {
	if d == nil || d.loader == nil || alert.TenantID == "" {
		return
	}
	if alert.EventTime.IsZero() {
		alert.EventTime = time.Now().UTC()
	}
	alert.Severity = normalizeSeverity(alert.Severity)
	if alert.DedupKey == "" {
		alert.DedupKey = fmt.Sprintf("%s|%s|%s", alert.Source, alert.Title, alert.TraceID)
	}

	cfg, ok := d.loader.tenantConfig(alert.TenantID)
	if !ok || len(cfg.Channels) == 0 {
		return
	}

	if !d.claimDedup(alert.DedupKey, cfg.dedupWindow()) {
		d.logger.Debug("alert deduplicated", "dedup_key", alert.DedupKey)
		return
	}

	go d.deliver(alert, cfg)
}

// claimDedup 原子占用去重键：窗口内已存在返回 false。
func (d *Dispatcher) claimDedup(key string, window time.Duration) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pruneLocked()
	if at, ok := d.dedup[key]; ok && time.Since(at) < window {
		return false
	}
	d.dedup[key] = time.Now()
	return true
}

// pruneLocked 防止去重表无界增长（保留 1h）。
func (d *Dispatcher) pruneLocked() {
	if len(d.dedup) < 10000 {
		return
	}
	cutoff := time.Now().Add(-time.Hour)
	for k, at := range d.dedup {
		if at.Before(cutoff) {
			delete(d.dedup, k)
		}
	}
}

// deliver 在后台逐通道发送，并把分发结果写入审计链。
func (d *Dispatcher) deliver(alert Alert, cfg TenantAlertConfig) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	outcomes := make([]audit.ChannelOutcome, 0, len(cfg.Channels))
	for idx, ch := range cfg.Channels {
		min := normalizeSeverity(ch.MinSeverity)
		if severityRank(alert.Severity) < severityRank(min) {
			outcomes = append(outcomes, audit.ChannelOutcome{
				Type: ch.Type, URLDigest: urlDigest(ch.URL), Outcome: "filtered",
			})
			continue
		}
		rateKey := fmt.Sprintf("%s|%d|%s", alert.TenantID, idx, urlDigest(ch.URL))
		if !d.claimRate(rateKey, cfg.rateLimit()) {
			outcomes = append(outcomes, audit.ChannelOutcome{
				Type: ch.Type, URLDigest: urlDigest(ch.URL), Outcome: "rate_limited",
			})
			d.logger.Warn("alert channel rate limited",
				"channel", ch.Type, "dedup_key", alert.DedupKey)
			continue
		}
		if err := d.send(ctx, ch, alert); err != nil {
			outcomes = append(outcomes, audit.ChannelOutcome{
				Type: ch.Type, URLDigest: urlDigest(ch.URL), Outcome: "failed",
			})
			d.logger.Warn("alert send failed", "channel", ch.Type, "error", err)
			continue
		}
		outcomes = append(outcomes, audit.ChannelOutcome{
			Type: ch.Type, URLDigest: urlDigest(ch.URL), Outcome: "sent",
		})
	}

	d.writeAudit(alert, outcomes)
}

// claimRate 通道级滑动窗口限流（每分钟 rateLimit 条）。
func (d *Dispatcher) claimRate(key string, rateLimit int) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-time.Minute)
	sends := d.rateSends[key][:0]
	for _, at := range d.rateSends[key] {
		if at.After(cutoff) {
			sends = append(sends, at)
		}
	}
	if len(sends) >= rateLimit {
		d.rateSends[key] = sends
		return false
	}
	d.rateSends[key] = append(sends, now)
	return true
}

func (d *Dispatcher) send(ctx context.Context, ch ChannelConfig, alert Alert) error {
	var payload []byte
	var contentType = "application/json"
	switch strings.ToLower(strings.TrimSpace(ch.Type)) {
	case "feishu":
		payload = feishuCardPayload(alert)
	case "webhook":
		fallthrough
	default:
		body := map[string]any{
			"source":     alert.Source,
			"severity":   alert.Severity,
			"title":      alert.Title,
			"summary":    alert.Summary,
			"tenant_id":  alert.TenantID,
			"trace_id":   alert.TraceID,
			"session_id": alert.SessionID,
			"user_id":    alert.UserID,
			"model":      alert.Model,
			"event_time": alert.EventTime.Format(time.RFC3339),
		}
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ch.URL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("User-Agent", "agenticx-gateway-alertdispatch/1.0")
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("channel %s responded http %d", ch.Type, resp.StatusCode)
	}
	return nil
}

// writeAudit 把分发结果写入审计链（outcome 逐通道记录）。
func (d *Dispatcher) writeAudit(alert Alert, outcomes []audit.ChannelOutcome) {
	if d.audit == nil {
		return
	}
	event := audit.Event{
		ID:        newAlertID(),
		TenantID:  alert.TenantID,
		EventTime: time.Now().UTC().Format(time.RFC3339),
		EventType: "alert_dispatch",
		UserID:    alert.UserID,
		SessionID: alert.SessionID,
		TraceID:   alert.TraceID,
		Model:     alert.Model,
		Route:     "alert-dispatch",
		ClientType: "gateway",
		AlertDispatch: &audit.AlertDispatchRecord{
			Source:    alert.Source,
			Severity:  alert.Severity,
			Title:     alert.Title,
			DedupKey:  alert.DedupKey,
			Channels:  outcomes,
		},
	}
	if err := d.audit.Write(&event); err != nil {
		d.logger.Warn("alert dispatch audit write failed", "error", err)
	}
}

// feishuCardPayload 构造飞书群机器人 interactive 卡片。
func feishuCardPayload(alert Alert) []byte {
	template := "blue"
	icon := "🔵"
	switch alert.Severity {
	case "CRITICAL":
		template = "red"
		icon = "🔴"
	case "HIGH":
		template = "orange"
		icon = "🟠"
	case "MEDIUM":
		template = "yellow"
		icon = "🟡"
	default:
		template = "grey"
		icon = "⚪"
	}
	lines := []string{
		fmt.Sprintf("%s **[%s] %s**", icon, alert.Severity, alert.Title),
		"",
		alert.Summary,
	}
	if alert.TraceID != "" {
		lines = append(lines, "", fmt.Sprintf("trace_id: `%s`", alert.TraceID))
	}
	if alert.TenantID != "" {
		lines = append(lines, fmt.Sprintf("tenant: `%s`", alert.TenantID))
	}
	// SP5 incident-response：主体信息进卡——处置面板据此一键处置（session/PAT/user/model）。
	if alert.UserID != "" {
		lines = append(lines, fmt.Sprintf("user: `%s`", alert.UserID))
	}
	if alert.SessionID != "" {
		lines = append(lines, fmt.Sprintf("session: `%s`", alert.SessionID))
	}
	if alert.Model != "" {
		lines = append(lines, fmt.Sprintf("model: `%s`", alert.Model))
	}
	lines = append(lines, fmt.Sprintf("time: %s", alert.EventTime.Format(time.RFC3339)))
	card := map[string]any{
		"msg_type": "interactive",
		"card": map[string]any{
			"header": map[string]any{
				"title":    map[string]any{"tag": "plain_text", "content": fmt.Sprintf("[agx 告警] %s", alert.Title)},
				"template": template,
			},
			"elements": []map[string]any{
				{"tag": "div", "text": map[string]any{"tag": "lark_md", "content": strings.Join(lines, "\n")}},
			},
		},
	}
	raw, err := json.Marshal(card)
	if err != nil {
		return []byte("{}")
	}
	return raw
}

func urlDigest(url string) string {
	sum := sha256.Sum256([]byte(url))
	return hex.EncodeToString(sum[:])[:12]
}

func newAlertID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("alert-%d", time.Now().UnixNano())
	}
	return "alert-" + hex.EncodeToString(buf)
}
