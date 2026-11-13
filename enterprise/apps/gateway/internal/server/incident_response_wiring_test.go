package server

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/agenticx/enterprise/gateway/internal/alertdispatch"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	gatewayauth "github.com/agenticx/enterprise/gateway/internal/auth"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

// SP5 incident-response-loop E2E：模拟外泄攻击 → 告警 → 一键处置 → 原凭据 401。
// 覆盖 MASTER-PLAN 第八节 SP5 验收行。

// newIncidentTestServer 构造带审计链、PAT 验证器、session 吊销存储与告警分发器的最小 Server。
func newIncidentTestServer(t *testing.T, hookURL string) (*Server, string) {
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
	srv := &Server{
		logger:             slog.Default(),
		audit:              writer,
		alertDispatcher:    alertdispatch.NewDispatcher(loader, writer, nil),
		patVerifier:        gatewayauth.NewPATVerifier(nil),
		sessionRevocations: gatewayauth.NewSessionRevocationStore(),
	}
	return srv, auditDir
}

func postIncidentAction(t *testing.T, s *Server, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/internal/security/incident-action", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.handleInternalIncidentAction(rec, req)
	return rec
}

func postIncidentActionAuthorized(t *testing.T, s *Server, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "sp5-secret")
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/internal/security/incident-action", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer sp5-secret")
	rec := httptest.NewRecorder()
	s.handleInternalIncidentAction(rec, req)
	return rec
}

func readAuditEvents(t *testing.T, auditDir string) []map[string]any {
	t.Helper()
	files, err := os.ReadDir(auditDir)
	if err != nil {
		t.Fatalf("read audit dir: %v", err)
	}
	events := []map[string]any{}
	for _, f := range files {
		if !strings.HasSuffix(f.Name(), ".jsonl") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(auditDir, f.Name()))
		if err != nil {
			t.Fatalf("read audit file: %v", err)
		}
		for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
			if line == "" {
				continue
			}
			var ev map[string]any
			if err := json.Unmarshal([]byte(line), &ev); err != nil {
				t.Fatalf("unmarshal audit line: %v", err)
			}
			events = append(events, ev)
		}
	}
	return events
}

func TestIncidentActionEndpointRequiresInternalToken(t *testing.T) {
	s, _ := newIncidentTestServer(t, "http://hook.invalid")
	rec := postIncidentAction(t, s, map[string]any{"action": "revoke_pat", "tenant_id": "tenant-1"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestIncidentActionEndpointValidation(t *testing.T) {
	s, _ := newIncidentTestServer(t, "http://hook.invalid")
	cases := []struct {
		name string
		body map[string]any
	}{
		{"invalid action", map[string]any{"action": "nuke", "tenant_id": "tenant-1"}},
		{"missing tenant", map[string]any{"action": "revoke_pat", "target_hash": "x"}},
		{"revoke without hash", map[string]any{"action": "revoke_pat", "tenant_id": "tenant-1"}},
		{"terminate without session", map[string]any{"action": "terminate_session", "tenant_id": "tenant-1"}},
	}
	for _, tc := range cases {
		rec := postIncidentActionAuthorized(t, s, tc.body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d body=%s", tc.name, rec.Code, rec.Body.String())
		}
	}
}

// 核心验收：处置动作先落链（incident_action，checksum 链可验）→ PAT 即时 401。
func TestIncidentActionAuditedThenPATRevoked(t *testing.T) {
	s, auditDir := newIncidentTestServer(t, "http://hook.invalid")
	const victimPAT = "agx-pat-leak-victim"
	ctx := context.Background()
	if _, err := s.patVerifier.Verify(ctx, victimPAT); err == nil {
		t.Fatal("stub verifier expects database_unavailable for unknown token; got success")
	}
	rec := postIncidentActionAuthorized(t, s, map[string]any{
		"incident_id": "inc-1",
		"action":      "revoke_pat",
		"target_type": "pat",
		"target_id":   "42",
		"target_hash": hashPlainPAT(victimPAT),
		"actor":       "admin-1",
		"tenant_id":   "tenant-1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			Outcome string `json:"outcome"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Data.Outcome != "executed" {
		t.Fatalf("outcome = %s, want executed", resp.Data.Outcome)
	}
	// 原凭据请求：Verify 必须立刻命中 revocation（先于数据库查询）。
	if _, err := s.patVerifier.Verify(ctx, victimPAT); err == nil || !strings.Contains(err.Error(), "pat_revoked") {
		t.Fatalf("revoked PAT should fail with pat_revoked, got %v", err)
	}
	// 处置动作在审计链可查：incident_action 事件在链上且 checksum 链通过校验。
	events := readAuditEvents(t, auditDir)
	found := false
	for _, ev := range events {
		if ev["event_type"] != "incident_action" {
			continue
		}
		rec2, _ := ev["incident_action"].(map[string]any)
		if rec2 == nil || rec2["action"] != "revoke_pat" {
			t.Fatalf("incident_action payload missing action: %v", ev)
		}
		if rec2["outcome"] != "executed" || rec2["incident_id"] != "inc-1" || rec2["actor"] != "admin-1" {
			t.Fatalf("incident_action fields mismatch: %v", rec2)
		}
		found = true
	}
	if !found {
		t.Fatal("incident_action event not found on audit chain")
	}
	if err := alertdispatch.VerifyAuditChain(auditDir); err != nil {
		t.Fatalf("audit chain verify failed: %v", err)
	}
}

func TestIncidentActionTerminatesSessionAndRecordsUserModelActions(t *testing.T) {
	s, auditDir := newIncidentTestServer(t, "http://hook.invalid")
	rec := postIncidentActionAuthorized(t, s, map[string]any{
		"incident_id": "inc-2",
		"action":      "terminate_session",
		"target_type": "session",
		"target_id":   "sess-9",
		"actor":       "admin-1",
		"tenant_id":   "tenant-1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("terminate_session status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !s.sessionRevocations.IsRevoked("sess-9") {
		t.Fatal("session not revoked locally")
	}
	// disable_user / block_model 纯记录（执行体在 console），必须同样落链。
	rec = postIncidentActionAuthorized(t, s, map[string]any{
		"incident_id": "inc-2", "action": "disable_user", "target_type": "user",
		"target_id": "user-9", "actor": "admin-1", "tenant_id": "tenant-1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("disable_user status = %d", rec.Code)
	}
	rec = postIncidentActionAuthorized(t, s, map[string]any{
		"incident_id": "inc-2", "action": "block_model", "target_type": "model",
		"target_id": "glm-5.3", "actor": "admin-1", "tenant_id": "tenant-1",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("block_model status = %d", rec.Code)
	}
	var recordedCount int
	for _, ev := range readAuditEvents(t, auditDir) {
		if ev["event_type"] != "incident_action" {
			continue
		}
		rec2, _ := ev["incident_action"].(map[string]any)
		if rec2 == nil {
			t.Fatalf("missing incident_action payload: %v", ev)
		}
		switch rec2["action"] {
		case "terminate_session":
			if rec2["outcome"] != "executed" {
				t.Fatalf("terminate_session outcome = %v", rec2["outcome"])
			}
		case "disable_user", "block_model":
			if rec2["outcome"] != "recorded" {
				t.Fatalf("%v outcome = %v, want recorded", rec2["action"], rec2["outcome"])
			}
			recordedCount++
		}
	}
	if recordedCount != 2 {
		t.Fatalf("recorded outcome count = %d, want 2", recordedCount)
	}
	if err := alertdispatch.VerifyAuditChain(auditDir); err != nil {
		t.Fatalf("audit chain verify failed: %v", err)
	}
}

// signTestAccessJWT 生成 RS256 access JWT（重置包级公钥缓存以隔离其它用例）。
func signTestAccessJWT(t *testing.T, key *rsa.PrivateKey, claims accessClaims) string {
	t.Helper()
	publicKeyOnce = sync.Once{}
	publicKey = nil
	publicKeyErr = nil
	pub, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("AUTH_JWT_PUBLIC_KEY", string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pub})))
	signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return signed
}

func newAccessJWTRequest(signed string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer "+signed)
	return req
}

// E2E：模拟外泄攻击（policy 拦截 + policy_hit 审计 + 告警）→ 一键处置 →
// 原凭据 401（PAT pat_revoked + JWT session_revoked）→ 全部动作在审计链可查。
func TestIncidentResponseLeakDispositionE2E(t *testing.T) {
	capture := newAlertCapture(t)
	s, auditDir := newIncidentTestServer(t, capture.server.URL)

	// 阶段 1：模拟外泄攻击——请求侧 PII 外泄规则命中，policy_hit 落链 + 告警分发。
	leakIdentity := requestIdentity{
		TenantID:  "tenant-1",
		UserID:    "user-9",
		SessionID: "sess-leak-1",
		TraceID:   "trace-leak-1",
	}
	leakHits := []policyengine.HitEvent{
		{RuleID: "pii-leak-001", Severity: "critical", Action: policyengine.ActionBlock, Category: "pii"},
	}
	s.writeAuditEvent(audit.Event{
		ID:         makeID("policy"),
		TenantID:   leakIdentity.TenantID,
		EventTime:  time.Now().UTC().Format(time.RFC3339),
		EventType:  "policy_hit",
		UserID:     leakIdentity.UserID,
		SessionID:  leakIdentity.SessionID,
		TraceID:    leakIdentity.TraceID,
		Route:      "/v1/chat/completions",
		ClientType: "web",
		PoliciesHit: []audit.PolicyHit{
			{PolicyID: "pii-leak-001", Severity: "critical", Action: "block", Category: "pii"},
		},
	})
	s.dispatchPolicyAlert(leakIdentity, "request", "glm-5.3", leakHits)

	// 告警送达处置侧（飞书群机器人通道）。
	waitForAlert(t, capture, 1)
	alertRaw := func() string {
		capture.mu.Lock()
		defer capture.mu.Unlock()
		return capture.bodies[len(capture.bodies)-1]
	}()
	if !strings.Contains(alertRaw, "策略命中") || !strings.Contains(alertRaw, "sess-leak-1") {
		t.Fatalf("alert body missing policy hit context: %s", alertRaw)
	}

	// 阶段 2：一键处置——终止会话 + 吊销 PAT（管理员从告警主体一键执行）。
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "sp5-secret")
	const victimPAT = "agx-pat-leak-e2e"
	for _, action := range []map[string]any{
		{
			"incident_id": "inc-leak-1", "action": "terminate_session", "target_type": "session",
			"target_id": "sess-leak-1", "actor": "admin-1", "tenant_id": "tenant-1",
		},
		{
			"incident_id": "inc-leak-1", "action": "revoke_pat", "target_type": "pat",
			"target_id": "42", "target_hash": hashPlainPAT(victimPAT),
			"actor": "admin-1", "tenant_id": "tenant-1",
		},
	} {
		rec := postIncidentActionAuthorized(t, s, action)
		if rec.Code != http.StatusOK {
			t.Fatalf("disposition %v status = %d body=%s", action["action"], rec.Code, rec.Body.String())
		}
	}

	// 阶段 3：原凭据请求 401。
	// 3a. PAT：revocationStore 命中在数据库检查之前。
	if _, err := s.patVerifier.Verify(context.Background(), victimPAT); err == nil || !strings.Contains(err.Error(), "pat_revoked") {
		t.Fatalf("revoked PAT should fail, got %v", err)
	}
	// 3b. JWT access：同 session 的新请求被 session_revoked 拒绝。
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signed := signTestAccessJWT(t, key, accessClaims{
		UserID:    "user-9",
		TenantID:  "tenant-1",
		Email:     "user-9@example.invalid",
		SessionID: "sess-leak-1",
		Type:      "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenticx-enterprise-web-portal",
			Audience:  jwt.ClaimStrings{"agenticx-web-users"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	if _, err := s.identityFromRequest(newAccessJWTRequest(signed)); err == nil || !strings.Contains(err.Error(), "session_revoked") {
		t.Fatalf("terminated session JWT should fail, got %v", err)
	}
	// 未处置的 session 不受影响（off 等价现状：只吊销目标会话）。
	otherSigned := signTestAccessJWT(t, key, accessClaims{
		UserID:    "user-9",
		TenantID:  "tenant-1",
		Email:     "user-9@example.invalid",
		SessionID: "sess-clean-1",
		Type:      "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenticx-enterprise-web-portal",
			Audience:  jwt.ClaimStrings{"agenticx-web-users"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	if _, err := s.identityFromRequest(newAccessJWTRequest(otherSigned)); err != nil {
		t.Fatalf("unrelated session must pass, got %v", err)
	}

	// 阶段 4：全链路在审计链可查——policy_hit / alert_dispatch / incident_action 全部落链且链完整。
	events := readAuditEvents(t, auditDir)
	types := map[string]int{}
	for _, ev := range events {
		types[ev["event_type"].(string)]++
	}
	if types["policy_hit"] != 1 || types["alert_dispatch"] != 1 || types["incident_action"] != 2 {
		t.Fatalf("audit chain events mismatch: %v", types)
	}
	if err := alertdispatch.VerifyAuditChain(auditDir); err != nil {
		t.Fatalf("audit chain verify failed: %v", err)
	}
}
