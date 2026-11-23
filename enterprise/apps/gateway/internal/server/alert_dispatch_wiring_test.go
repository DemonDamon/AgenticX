package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/alertdispatch"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/agenticx/enterprise/gateway/internal/quota"
)

// SP4 alert-dispatch 接线验证：server 的 policy_hit / 预算告警 helper
// 真实驱动 Dispatcher，把告警送到真实 HTTP 接收端。

type alertCapture struct {
	mu     sync.Mutex
	bodies []string
	server *httptest.Server
}

func newAlertCapture(t *testing.T) *alertCapture {
	t.Helper()
	c := &alertCapture{}
	c.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 8192)
		n, _ := r.Body.Read(buf)
		c.mu.Lock()
		c.bodies = append(c.bodies, string(buf[:n]))
		c.mu.Unlock()
		w.WriteHeader(200)
	}))
	t.Cleanup(c.server.Close)
	return c
}

func (c *alertCapture) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.bodies)
}

func (c *alertCapture) last(t *testing.T) map[string]any {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	var body map[string]any
	if err := json.Unmarshal([]byte(c.bodies[len(c.bodies)-1]), &body); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	return body
}

func newTestServerDispatcher(t *testing.T, hookURL string) (*Server, string) {
	t.Helper()
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	cfg := map[string]any{
		"tenants": map[string]any{
			"tenant-1": map[string]any{
				"channels": []map[string]any{
					{"type": "feishu", "url": hookURL, "minSeverity": "HIGH"},
				},
			},
		},
	}
	raw, _ := json.Marshal(cfg)
	if err := os.WriteFile(cfgPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_ADMIN_ALERTS_FILE", cfgPath)
	loader := alertdispatch.NewConfigLoader(nil)
	if err := loader.Reload(); err != nil {
		t.Fatal(err)
	}
	auditDir := t.TempDir()
	writer := audit.NewFileWriter(auditDir)
	srv := &Server{}
	srv.alertDispatcher = alertdispatch.NewDispatcher(loader, writer, nil)
	return srv, auditDir
}

func waitForAlert(t *testing.T, c *alertCapture, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if c.count() == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %d alerts, got %d", want, c.count())
}

func TestServerDispatchPolicyAlertWiring(t *testing.T) {
	capture := newAlertCapture(t)
	srv, _ := newTestServerDispatcher(t, capture.server.URL)

	identity := requestIdentity{
		TenantID: "tenant-1", UserID: "user-1", SessionID: "sess-1", TraceID: "trace-1",
	}
	hits := []policyengine.HitEvent{
		{RuleID: "secret_leak", Severity: "critical", Action: policyengine.ActionBlock},
	}
	srv.dispatchPolicyAlert(identity, "请求侧拦截", "gpt-4o", hits)

	waitForAlert(t, capture, 1)
	card := capture.last(t)
	if card["msg_type"] != "interactive" {
		t.Fatalf("飞书通道应发 interactive 卡片: %v", card)
	}
	// 去重：同一 trace 同规则重复命中不再发送
	srv.dispatchPolicyAlert(identity, "请求侧拦截", "gpt-4o", hits)
	time.Sleep(200 * time.Millisecond)
	if capture.count() != 1 {
		t.Fatalf("重复命中应被去重为 1 条，实际 %d", capture.count())
	}
}

func TestServerDispatchBudgetAlertWiring(t *testing.T) {
	capture := newAlertCapture(t)
	srv, _ := newTestServerDispatcher(t, capture.server.URL)

	rec := quota.BudgetAlertRecord{
		TenantID: "tenant-1", UserID: "user-1", Dimension: "tenant",
		DimensionKey: "tenant-1", Period: "2026-11", Unit: "USD",
		AlertType: "warn", Used: 80, Limit: 100, CreatedAt: time.Now().UTC(),
	}
	srv.dispatchBudgetAlert(rec)

	waitForAlert(t, capture, 1)
	card := capture.last(t)
	if card["msg_type"] != "interactive" {
		t.Fatalf("飞书通道应发 interactive 卡片: %v", card)
	}
}
