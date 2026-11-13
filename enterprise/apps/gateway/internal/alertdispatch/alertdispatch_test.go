package alertdispatch

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
)

type capture struct {
	mu     sync.Mutex
	bodies []string
}

func (c *capture) add(body string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bodies = append(c.bodies, body)
}

func (c *capture) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.bodies)
}

func (c *capture) last() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.bodies) == 0 {
		return ""
	}
	return c.bodies[len(c.bodies)-1]
}

func newWebhookCapture(t *testing.T) *capture {
	t.Helper()
	c := &capture{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		c.add(string(buf[:n]))
		w.WriteHeader(200)
	}))
	t.Cleanup(server.Close)
	c.mu.Lock()
	c.bodies = nil
	c.mu.Unlock()
	t.Setenv("_test_hook_url", server.URL)
	return c
}

func writeConfig(t *testing.T, path string, tenants map[string]TenantAlertConfig) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"tenants": tenants})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
}

func newTestDispatcher(t *testing.T, cfgPath string, writer audit.EventWriter) (*Dispatcher, *ConfigLoader) {
	t.Helper()
	t.Setenv("GATEWAY_ADMIN_ALERTS_FILE", cfgPath)
	loader := NewConfigLoader(nil)
	if err := loader.Reload(); err != nil {
		t.Fatal(err)
	}
	d := NewDispatcher(loader, writer, nil)
	return d, loader
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timeout waiting: " + msg)
}

// --- 源→通道端到端：policy_hit 告警经 webhook 真实送达 ---

func TestDispatchPolicyHitToWebhook(t *testing.T) {
	hook := newWebhookCapture(t)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"tenant-1": {Channels: []ChannelConfig{
			{Type: "webhook", URL: os.Getenv("_test_hook_url")},
		}},
	})
	d, _ := newTestDispatcher(t, cfgPath, nil)

	d.Dispatch(Alert{
		TenantID: "tenant-1", Source: "policy_hit", Severity: "CRITICAL",
		Title: "策略命中：请求侧拦截", Summary: "规则: rbac_deny",
		TraceID: "trace-1", DedupKey: "k1",
	})
	waitFor(t, 3*time.Second, func() bool { return hook.count() == 1 }, "webhook 收到告警")

	var body map[string]any
	if err := json.Unmarshal([]byte(hook.last()), &body); err != nil {
		t.Fatalf("payload 不是合法 JSON: %v", err)
	}
	if body["source"] != "policy_hit" || body["severity"] != "CRITICAL" || body["trace_id"] != "trace-1" {
		t.Fatalf("payload 字段错误: %v", body)
	}
}

// --- 飞书卡片格式 ---

func TestDispatchFeishuCard(t *testing.T) {
	hook := newWebhookCapture(t)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"tenant-1": {Channels: []ChannelConfig{
			{Type: "feishu", URL: os.Getenv("_test_hook_url")},
		}},
	})
	d, _ := newTestDispatcher(t, cfgPath, nil)

	d.Dispatch(Alert{TenantID: "tenant-1", Source: "policy_hit", Severity: "HIGH",
		Title: "策略命中", Summary: "rule x", DedupKey: "k2"})
	waitFor(t, 3*time.Second, func() bool { return hook.count() == 1 }, "飞书通道收到卡片")

	var card map[string]any
	if err := json.Unmarshal([]byte(hook.last()), &card); err != nil {
		t.Fatalf("卡片不是合法 JSON: %v", err)
	}
	if card["msg_type"] != "interactive" {
		t.Fatalf("msg_type 应为 interactive: %v", card)
	}
	header := card["card"].(map[string]any)["header"].(map[string]any)
	if header["template"] != "orange" { // HIGH → orange
		t.Fatalf("HIGH 应为 orange 模板: %v", header)
	}
}

// --- 去重窗口 ---

func TestDedupWindow(t *testing.T) {
	hook := newWebhookCapture(t)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"tenant-1": {
			Channels:           []ChannelConfig{{Type: "webhook", URL: os.Getenv("_test_hook_url")}},
			DedupWindowSeconds: 3600,
		},
	})
	d, _ := newTestDispatcher(t, cfgPath, nil)

	for i := 0; i < 3; i++ {
		d.Dispatch(Alert{TenantID: "tenant-1", Source: "policy_hit", Severity: "HIGH",
			Title: "同规则重复命中", DedupKey: "same-key"})
	}
	waitFor(t, 3*time.Second, func() bool { return hook.count() >= 1 }, "首条送达")
	time.Sleep(200 * time.Millisecond)
	if got := hook.count(); got != 1 {
		t.Fatalf("去重窗口内应只发 1 条，实际 %d", got)
	}
}

func TestDedupExpirySendsAgain(t *testing.T) {
	hook := newWebhookCapture(t)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"tenant-1": {
			Channels:           []ChannelConfig{{Type: "webhook", URL: os.Getenv("_test_hook_url")}},
			DedupWindowSeconds: 1,
		},
	})
	d, _ := newTestDispatcher(t, cfgPath, nil)

	d.Dispatch(Alert{TenantID: "tenant-1", Severity: "HIGH", Title: "a", DedupKey: "expire-key"})
	waitFor(t, 3*time.Second, func() bool { return hook.count() == 1 }, "第一条")
	time.Sleep(1100 * time.Millisecond)
	d.Dispatch(Alert{TenantID: "tenant-1", Severity: "HIGH", Title: "a", DedupKey: "expire-key"})
	waitFor(t, 3*time.Second, func() bool { return hook.count() == 2 }, "窗口过期后再发")
}

// --- 通道限流 ---

func TestChannelRateLimit(t *testing.T) {
	hook := newWebhookCapture(t)
	auditDir := t.TempDir()
	writer := audit.NewFileWriter(auditDir)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"tenant-1": {
			Channels:           []ChannelConfig{{Type: "webhook", URL: os.Getenv("_test_hook_url")}},
			RateLimitPerMinute: 2,
		},
	})
	d, _ := newTestDispatcher(t, cfgPath, writer)

	for i := 0; i < 4; i++ {
		d.Dispatch(Alert{TenantID: "tenant-1", Source: "policy_hit", Severity: "HIGH",
			Title: fmt.Sprintf("告警 %d", i), DedupKey: fmt.Sprintf("rl-%d", i)})
	}
	waitFor(t, 3*time.Second, func() bool { return hook.count() == 2 }, "限流 2 条送达")
	time.Sleep(200 * time.Millisecond)
	if got := hook.count(); got != 2 {
		t.Fatalf("限流后应只有 2 条送达，实际 %d", got)
	}

	// rate_limited 落审计：读 audit jsonl 找 alert_dispatch 事件
	waitFor(t, 3*time.Second, func() bool { return findAlertDispatch(t, auditDir, "rate_limited") != nil }, "rate_limited 落审计")
	ev := findAlertDispatch(t, auditDir, "rate_limited")
	if ev.AlertDispatch.Source != "policy_hit" || len(ev.AlertDispatch.Channels) == 0 {
		t.Fatalf("审计事件载荷不完整: %+v", ev.AlertDispatch)
	}
}

func findAlertDispatch(t *testing.T, dir, outcome string) *audit.Event {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(dir, "audit-*.jsonl"))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		for _, line := range splitLines(string(raw)) {
			var ev audit.Event
			if json.Unmarshal([]byte(line), &ev) != nil {
				continue
			}
			if ev.EventType != "alert_dispatch" || ev.AlertDispatch == nil {
				continue
			}
			for _, ch := range ev.AlertDispatch.Channels {
				if ch.Outcome == outcome {
					return &ev
				}
			}
		}
	}
	return nil
}

func splitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			if seg := trimSpace(s[start:i]); seg != "" {
				out = append(out, seg)
			}
			start = i + 1
		}
	}
	if seg := trimSpace(s[start:]); seg != "" {
		out = append(out, seg)
	}
	return out
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\r' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\r' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

// --- severity 过滤 ---

func TestSeverityFilter(t *testing.T) {
	hook := newWebhookCapture(t)
	auditDir := t.TempDir()
	writer := audit.NewFileWriter(auditDir)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"tenant-1": {Channels: []ChannelConfig{
			{Type: "webhook", URL: os.Getenv("_test_hook_url"), MinSeverity: "CRITICAL"},
		}},
	})
	d, _ := newTestDispatcher(t, cfgPath, writer)

	d.Dispatch(Alert{TenantID: "tenant-1", Severity: "MEDIUM", Title: "低级别", DedupKey: "f1"})
	time.Sleep(200 * time.Millisecond)
	if hook.count() != 0 {
		t.Fatal("低于门槛不应发送")
	}
	waitFor(t, 3*time.Second, func() bool { return findAlertDispatch(t, auditDir, "filtered") != nil }, "filtered 落审计")
}

// --- 分发动作落审计链（含 checksum 防篡改） ---

func TestDispatchAuditedOnChain(t *testing.T) {
	hook := newWebhookCapture(t)
	auditDir := t.TempDir()
	writer := audit.NewFileWriter(auditDir)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"tenant-1": {Channels: []ChannelConfig{{Type: "webhook", URL: os.Getenv("_test_hook_url")}}},
	})
	d, _ := newTestDispatcher(t, cfgPath, writer)

	d.Dispatch(Alert{TenantID: "tenant-1", Source: "policy_hit", Severity: "CRITICAL",
		Title: "审计链验证", DedupKey: "audit-1"})
	waitFor(t, 3*time.Second, func() bool { return hook.count() == 1 }, "webhook 送达")
	waitFor(t, 3*time.Second, func() bool { return findAlertDispatch(t, auditDir, "sent") != nil }, "sent 落审计")

	if err := VerifyAuditChain(auditDir); err != nil {
		t.Fatalf("分发后审计链应校验通过: %v", err)
	}
}

// --- 审计链自检发现篡改 ---

func TestChainCheckDetectsTampering(t *testing.T) {
	auditDir := t.TempDir()
	writer := audit.NewFileWriter(auditDir)
	for i := 0; i < 3; i++ {
		_ = writer.Write(&audit.Event{ID: fmt.Sprintf("audit_%d", i), TenantID: "t",
			EventTime: time.Now().UTC().Format(time.RFC3339), EventType: "policy_hit", Route: "chat"})
	}
	if err := VerifyAuditChain(auditDir); err != nil {
		t.Fatalf("未篡改前应通过: %v", err)
	}

	// 篡改第 2 行内容
	files, _ := filepath.Glob(filepath.Join(auditDir, "audit-*.jsonl"))
	raw, _ := os.ReadFile(files[0])
	lines := splitLines(string(raw))
	lines[1] = replaceOnce(lines[1], `"policy_hit"`, `"policy_HIT_TAMPERED"`)
	_ = os.WriteFile(files[0], []byte(joinLines(lines)), 0o600)

	err := VerifyAuditChain(auditDir)
	if err == nil {
		t.Fatal("篡改后应校验失败")
	}
	chainErr, ok := err.(*ChainError)
	if !ok || chainErr.Line != 2 {
		t.Fatalf("应定位到第 2 行: %v", err)
	}
}

// --- 链自检失败 → CRITICAL 告警分发 ---

func TestChainCheckDispatchesCritical(t *testing.T) {
	hook := newWebhookCapture(t)
	auditDir := t.TempDir()
	writer := audit.NewFileWriter(auditDir)
	_ = writer.Write(&audit.Event{ID: "a1", TenantID: "default",
		EventTime: time.Now().UTC().Format(time.RFC3339), EventType: "policy_hit"})

	// 篡改
	files, _ := filepath.Glob(filepath.Join(auditDir, "audit-*.jsonl"))
	raw, _ := os.ReadFile(files[0])
	_ = os.WriteFile(files[0], []byte(replaceOnce(string(raw), `"policy_hit"`, `"tampered"`)), 0o600)

	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{
		"default": {Channels: []ChannelConfig{{Type: "webhook", URL: os.Getenv("_test_hook_url")}}},
	})
	t.Setenv("GATEWAY_ALERT_CHAIN_TENANT", "default")
	d, _ := newTestDispatcher(t, cfgPath, writer)

	stop := make(chan struct{})
	StartChainCheck(stop, auditDir, d, nil, 20*time.Millisecond)
	waitFor(t, 3*time.Second, func() bool { return hook.count() >= 1 }, "链校验失败告警送达")
	close(stop)

	var body map[string]any
	_ = json.Unmarshal([]byte(hook.last()), &body)
	if body["source"] != "chain_check" || body["severity"] != "CRITICAL" {
		t.Fatalf("应为 chain_check/CRITICAL: %v", body)
	}
}

// --- 无配置租户零行为（现状等价） ---

func TestNoConfigNoDispatch(t *testing.T) {
	hook := newWebhookCapture(t)
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	writeConfig(t, cfgPath, map[string]TenantAlertConfig{}) // 无租户
	d, _ := newTestDispatcher(t, cfgPath, nil)

	d.Dispatch(Alert{TenantID: "unknown-tenant", Severity: "CRITICAL", Title: "x", DedupKey: "z"})
	time.Sleep(200 * time.Millisecond)
	if hook.count() != 0 {
		t.Fatal("无通道配置的租户不应分发")
	}
}

func replaceOnce(s, old, new string) string {
	for i := 0; i+len(old) <= len(s); i++ {
		if s[i:i+len(old)] == old {
			return s[:i] + new + s[i+len(old):]
		}
	}
	return s
}

func joinLines(lines []string) string {
	out := ""
	for i, l := range lines {
		if i > 0 {
			out += "\n"
		}
		out += l
	}
	return out + "\n"
}
