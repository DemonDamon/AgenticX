package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/alertdispatch"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/moderation"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func testModerationCtx(t *testing.T) context.Context {
	t.Helper()
	return context.Background()
}

// SP3 compliance-moderation 接线验证：enforceModeration 真实驱动
// provider 外呼 → policy_hit 审计（含 category）→ SP4 告警分发。

func newModerationTestServer(t *testing.T, providerURL string, mode string) (*Server, string) {
	t.Helper()
	cfgPath := filepath.Join(t.TempDir(), "moderation.json")
	cfg := map[string]any{
		"tenants": map[string]any{
			"tenant-1": map[string]any{
				"enabled":        true,
				"mode":           mode,
				"blockSeverity":  "critical",
				"timeoutSeconds": 2,
				"categories":     []string{"politics", "porn"},
				"provider":       map[string]any{"type": "http", "name": "vendor-x", "url": providerURL},
			},
		},
	}
	raw, _ := json.Marshal(cfg)
	if err := os.WriteFile(cfgPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GATEWAY_ADMIN_MODERATION_FILE", cfgPath)
	loader := moderation.NewConfigLoader(nil)
	if err := loader.Reload(); err != nil {
		t.Fatal(err)
	}
	auditDir := t.TempDir()
	writer := audit.NewFileWriter(auditDir)
	srv := &Server{}
	srv.audit = writer
	srv.moderation = moderation.NewService(loader, nil)
	return srv, auditDir
}

func newModerationAlertCapture(t *testing.T) *alertCapture {
	t.Helper()
	return newAlertCapture(t)
}

func wireModerationDispatcher(t *testing.T, srv *Server, hookURL string) {
	t.Helper()
	cfgPath := filepath.Join(t.TempDir(), "alert-channels.json")
	cfg := map[string]any{
		"tenants": map[string]any{
			"tenant-1": map[string]any{
				"channels": []map[string]any{
					{"type": "webhook", "url": hookURL, "minSeverity": "LOW"},
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
	srv.alertDispatcher = alertdispatch.NewDispatcher(loader, audit.NewFileWriter(auditDir), nil)
}

func readAuditJSONL(t *testing.T, auditDir string) []map[string]any {
	t.Helper()
	entries, err := os.ReadDir(auditDir)
	if err != nil || len(entries) == 0 {
		t.Fatalf("audit dir empty or unreadable: %v", err)
	}
	var events []map[string]any
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(auditDir, e.Name()))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			if line == "" {
				continue
			}
			var ev map[string]any
			if json.Unmarshal([]byte(line), &ev) == nil {
				events = append(events, ev)
			}
		}
	}
	return events
}

func TestServerModerationBlockedWritesAuditAndAlert(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"blocked":true,"categories":["porn"],"score":0.98,"detail":"色情内容"}`))
	}))
	defer provider.Close()

	srv, auditDir := newModerationTestServer(t, provider.URL, "degraded")
	capture := newModerationAlertCapture(t)
	wireModerationDispatcher(t, srv, capture.server.URL)

	identity := requestIdentity{TenantID: "tenant-1", UserID: "user-1", SessionID: "sess-1", TraceID: "trace-1"}
	out := srv.enforceModeration(
		testModerationCtx(t),
		identity,
		"request",
		"违规内容",
		"gpt-4o",
		routing.Decision{Provider: "openai", Route: "default"},
		"127.0.0.1:1",
		time.Now(),
	)
	if !out.Checked || !out.Blocked || out.AuditFailed {
		t.Fatalf("expected blocked outcome, got %+v", out)
	}
	if out.Hit.Category != "porn" {
		t.Fatalf("expected category porn, got %q", out.Hit.Category)
	}

	// 先审计后动作：policy_hit 已落审计链，且带 category 字段。
	events := readAuditJSONL(t, auditDir)
	var hit *map[string]any
	for i := range events {
		if events[i]["event_type"] == "policy_hit" {
			hit = &events[i]
		}
	}
	if hit == nil {
		t.Fatalf("policy_hit audit event not found")
	}
	hitsAny, _ := (*hit)["policies_hit"].([]any)
	if len(hitsAny) == 0 {
		t.Fatalf("policies_hit empty in audit event")
	}
	firstHit, _ := hitsAny[0].(map[string]any)
	if firstHit["category"] != "porn" {
		t.Fatalf("expected audit policy_hit category porn, got %v", firstHit["category"])
	}

	// 告警分发送达（SP4 通道），summary 带类别。
	waitForAlert(t, capture, 1)
}

func TestServerModerationDegradedSendsCriticalAlert(t *testing.T) {
	// provider 挂（端口不可达）→ degraded：不阻断 + CRITICAL moderation_degraded 告警 + 窗口内去重。
	srv, _ := newModerationTestServer(t, "http://127.0.0.1:1/check", "degraded")
	capture := newModerationAlertCapture(t)
	wireModerationDispatcher(t, srv, capture.server.URL)

	identity := requestIdentity{TenantID: "tenant-1", UserID: "user-1", SessionID: "sess-1", TraceID: "trace-1"}
	out := srv.enforceModeration(
		testModerationCtx(t),
		identity,
		"response",
		"普通内容",
		"gpt-4o",
		routing.Decision{},
		"127.0.0.1:1",
		time.Now(),
	)
	if out.Blocked {
		t.Fatalf("degraded must not block")
	}
	if !out.Degraded {
		t.Fatalf("expected degraded signal")
	}

	waitForAlert(t, capture, 1)
	body := capture.last(t)
	if body["source"] != "moderation_degraded" {
		t.Fatalf("expected source moderation_degraded, got %v", body["source"])
	}
	if body["severity"] != "CRITICAL" {
		t.Fatalf("expected CRITICAL severity, got %v", body["severity"])
	}

	// 同租户窗口内第二次降级只告一次（dedup key = moderation_degraded|tenant）。
	out2 := srv.enforceModeration(
		testModerationCtx(t),
		identity,
		"response",
		"普通内容 again",
		"gpt-4o",
		routing.Decision{},
		"127.0.0.1:1",
		time.Now(),
	)
	if out2.Blocked {
		t.Fatalf("degraded retry must not block")
	}
	time.Sleep(300 * time.Millisecond)
	if capture.count() != 1 {
		t.Fatalf("degraded alert should dedup within window, got %d", capture.count())
	}
}

func TestServerModerationStrictFailsClosed(t *testing.T) {
	srv, auditDir := newModerationTestServer(t, "http://127.0.0.1:1/check", "strict")
	capture := newModerationAlertCapture(t)
	wireModerationDispatcher(t, srv, capture.server.URL)

	identity := requestIdentity{TenantID: "tenant-1", UserID: "user-1", SessionID: "sess-1", TraceID: "trace-1"}
	out := srv.enforceModeration(
		testModerationCtx(t),
		identity,
		"request",
		"普通内容",
		"gpt-4o",
		routing.Decision{},
		"127.0.0.1:1",
		time.Now(),
	)
	if !out.Blocked {
		t.Fatalf("strict must fail closed")
	}
	if out.Hit.Category != "moderation" {
		t.Fatalf("expected category moderation, got %q", out.Hit.Category)
	}

	// strict fail-closed 也必须先落审计。
	events := readAuditJSONL(t, auditDir)
	found := false
	for _, ev := range events {
		if ev["event_type"] == "policy_hit" {
			found = true
		}
	}
	if !found {
		t.Fatalf("strict fail-closed must write policy_hit audit first")
	}
	waitForAlert(t, capture, 1)
}

func TestServerModerationUnconfiguredTenantNoop(t *testing.T) {
	// 未配置租户：零外呼零阻断（现状等价）。
	var called int
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		_, _ = w.Write([]byte(`{"blocked":true}`))
	}))
	defer provider.Close()

	srv, _ := newModerationTestServer(t, provider.URL, "degraded")
	identity := requestIdentity{TenantID: "tenant-other", UserID: "u"}
	out := srv.enforceModeration(
		testModerationCtx(t),
		identity,
		"request",
		"内容",
		"gpt-4o",
		routing.Decision{},
		"127.0.0.1:1",
		time.Now(),
	)
	if out.Checked || out.Blocked || out.Degraded {
		t.Fatalf("unconfigured tenant must be noop, got %+v", out)
	}
	if called != 0 {
		t.Fatalf("provider must not be called for unconfigured tenant")
	}
}

// snapshot payload.category → 引擎一等字段 → 90001 body 带 category：
// 租户合规规则包（console 播种/编辑）走快照热加载直达网关，命中回显类别。
func TestSnapshotRuleCategoryFlowsTo90001Body(t *testing.T) {
	snapshot := `{
		"updated_at": "2026-11-12T00:00:00Z",
		"tenants": {
			"tenant-1": {
				"version": 1,
				"packs": [
					{
						"code": "compliance-pack",
						"rules": [
							{
								"code": "compliance-porn-1",
								"kind": "keyword",
								"action": "block",
								"severity": "high",
								"message": "色情违规内容，已拦截",
								"payload": {"keywords": ["裸聊"], "category": "porn"}
							},
							{
								"code": "compliance-ad-1",
								"kind": "regex",
								"action": "warn",
								"severity": "medium",
								"payload": {"pattern": "加微信\\s?[a-zA-Z0-9_]+", "category": "ad"}
							}
						]
					}
				]
			}
		}
	}`
	manifests, _, _, err := snapshotManifestsFromRaw([]byte(snapshot), time.Now())
	if err != nil {
		t.Fatalf("snapshotManifestsFromRaw: %v", err)
	}
	if len(manifests) != 1 || len(manifests[0].Rules) != 2 {
		t.Fatalf("expected 1 pack 2 rules, got %+v", manifests)
	}
	if manifests[0].Rules[0].Category != "porn" || manifests[0].Rules[1].Category != "ad" {
		t.Fatalf("expected categories porn/ad, got %q/%q",
			manifests[0].Rules[0].Category, manifests[0].Rules[1].Category)
	}

	engine, err := policyengine.NewEngine(manifests)
	if err != nil {
		t.Fatalf("new engine: %v", err)
	}
	result := engine.Evaluate("我们来裸聊吧", "request")
	if len(result.Hits) == 0 {
		t.Fatalf("expected keyword hit")
	}
	if result.Hits[0].Category != "porn" {
		t.Fatalf("expected hit category porn, got %q", result.Hits[0].Category)
	}

	rec := httptest.NewRecorder()
	writePolicyError(rec, "90001", "请求触发合规拦截", result.Hits)
	if body := rec.Body.String(); !strings.Contains(body, `"category":"porn"`) {
		t.Fatalf("90001 body should carry category, got: %s", body)
	}

	respRec := httptest.NewRecorder()
	writePolicyError(respRec, "90002", "响应触发合规拦截", result.Hits)
	if body := respRec.Body.String(); !strings.Contains(body, `"category":"porn"`) {
		t.Fatalf("90002 body should carry category, got: %s", body)
	}
}
