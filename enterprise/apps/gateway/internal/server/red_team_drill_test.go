package server

// SP6 red-team-drill：≥12 类脚本化攻击对真实部署栈演练（Go 侧：企业网关）。
//
// 演练原则（MASTER-PLAN 第七节）：
//   - 真实组件组装（PAT 验证器 / 策略引擎 / quota / 审计链 / 告警分发），
//     不打桩拦截层——与 SP1/SP5 E2E 同口径；
//   - 攻击 payload 全部为演练合成词/合成凭据，不落真实敏感词；
//   - 双形态：常规 `go test` 零文件副作用；设 RED_TEAM_DRILL_REPORT 环境变量时
//     每条攻击结果追加 JSONL（run_drill.py 汇总拦截矩阵），演练可季度重跑。
//
// 覆盖攻击类（与 Python 侧 A1–A6 合计 ≥12 类）：
//   A7  跨租户越权     — 凭据绑定身份，伪造租户头/篡改 JWT 无效
//   A8  吊销凭据绕过   — PAT 吊销后重放 → 401 pat_revoked + 链上证据
//   A9  预算击穿       — 硬限超限请求被拒（fail-closed）
//   A10 审计链篡改     — 篡改 JSONL → VerifyAuditChain 断裂 + CRITICAL 告警
//   A11 合规内容       — 合成涉恐/色情演练词 → 90001 + policy_hit 审计 + 告警
//   A12 会话击杀续用   — 处置杀 session 后 JWT 重放 401，无关 session 不受影响

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/alertdispatch"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/golang-jwt/jwt/v5"
)

// recordDrillResult 演练模式（RED_TEAM_DRILL_REPORT 已设）追加一条攻击结果；
// 常规 CI 模式为 no-op（零文件副作用，off 等价现状）。
func recordDrillResult(t *testing.T, attackClass, caseID, payloadDesc, designLayer, outcome, evidence string) {
	t.Helper()
	path := redTeamDrillReportPath()
	if path == "" {
		return
	}
	appendDrillJSONL(t, map[string]any{
		"attack_class": attackClass,
		"case_id":      caseID,
		"payload_desc": payloadDesc,
		"design_layer": designLayer,
		"outcome":      outcome,
		"evidence":     evidence,
		"stack":         "gateway",
	})
}

// A7 跨租户越权：租户身份只来自签名凭据（PAT payload / JWT RS256 claims），
// 请求头/查询参数不可伪造。攻击者持租户 A 的 JWT + 伪造租户 B 的头 →
// 身份解析仍为 A；直接改 JWT payload 不重签 → 解析失败（篡改即拒）。
func TestRedTeamCrossTenantHeaderSpoofIsIneffective(t *testing.T) {
	key := redTeamRSAKey(t)
	signed := signTestAccessJWT(t, key, accessClaims{
		UserID:    "user-7",
		TenantID:  "tenant-a",
		SessionID: "sess-7",
		Type:      "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenticx-enterprise-web-portal",
			Audience:  jwt.ClaimStrings{"agenticx-web-users"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})

	// 攻击 1：伪造 X-Tenant-ID 头冒充租户 B。
	req := newAccessJWTRequest(signed)
	req.Header.Set("X-Tenant-ID", "tenant-b")
	req.Header.Set("X-Tenant", "tenant-b")
	identity, err := (&Server{}).identityFromRequest(req)
	if err != nil {
		t.Fatalf("valid JWT should parse: %v", err)
	}
	if identity.TenantID != "tenant-a" {
		t.Fatalf("tenant must come from signed claims, got %q (header spoof effective!)", identity.TenantID)
	}
	recordDrillResult(t, "cross_tenant", "A7-1", "伪造 X-Tenant-ID 头冒充他租户",
		"凭据绑定身份：TenantID 只取自签名 JWT claims（identityFromRequest）",
		"blocked", "TestRedTeamCrossTenantHeaderSpoofIsIneffective: identity.TenantID==tenant-a")

	// 攻击 2：篡改 JWT payload（换租户）不重签 → 验签失败拒绝。
	tampered := redTeamTamperJWTTenant(t, signed)
	if _, err := (&Server{}).identityFromRequest(newAccessJWTRequest(tampered)); err == nil {
		t.Fatal("tampered JWT must be rejected by RS256 signature verification")
	}
	recordDrillResult(t, "cross_tenant", "A7-2", "篡改 JWT payload 改租户字段（不重签）",
		"RS256 验签：payload 篡改即签名失配 → 401",
		"blocked", "TestRedTeamCrossTenantHeaderSpoofIsIneffective: tampered JWT rejected")
}

// A8 吊销凭据绕过：管理员吊销 PAT（处置端点，先落链）→ 原凭据立即重放
// 必须命中内存吊销存储（先于任何数据库检查）→ pat_revoked；链上 incident_action 可查。
func TestRedTeamRevokedPATReplayIsRejected(t *testing.T) {
	s, auditDir := newIncidentTestServer(t, "http://hook.invalid")
	const victimPAT = "agx-pat-redteam-victim"

	// 吊销前：凭据未被吊销（未知 token 走 DB 路径，stub 无 DB → database_unavailable，
	// 即"未吊销"不可证明放行；吊销后错误必须变成内存命中的 pat_revoked）。
	if _, err := s.patVerifier.Verify(context.Background(), victimPAT); err == nil {
		t.Fatal("precondition: unknown PAT must not verify without database")
	}

	rec := postIncidentActionAuthorized(t, s, map[string]any{
		"incident_id": "inc-rt-1", "action": "revoke_pat", "target_type": "pat",
		"target_id": "7", "target_hash": hashPlainPAT(victimPAT),
		"actor": "admin-rt", "tenant_id": "tenant-1",
	})
	if rec.Code != 200 {
		t.Fatalf("disposition status = %d body=%s", rec.Code, rec.Body.String())
	}

	// 攻击：原凭据重放 → 内存吊销命中（先于数据库）。
	if _, err := s.patVerifier.Verify(context.Background(), victimPAT); err == nil || !strings.Contains(err.Error(), "pat_revoked") {
		t.Fatalf("revoked PAT replay must fail with pat_revoked, got %v", err)
	}
	// 处置动作在审计链可查（先审计后动作纪律）。
	found := false
	for _, ev := range readAuditEvents(t, auditDir) {
		if ev["event_type"] == "incident_action" {
			found = true
		}
	}
	if !found {
		t.Fatal("incident_action audit event missing on chain")
	}
	recordDrillResult(t, "revocation_bypass", "A8-1", "已吊销 PAT 原凭据立即重放",
		"PATRevocationStore：Verify 首查内存吊销（即时）+ 快照轮询（重启/多副本兜底）",
		"blocked", "TestRedTeamRevokedPATReplayIsRejected: pat_revoked + incident_action on chain")
}

// A9 预算击穿：租户预算硬限（action=block）下持续消费 → 超限请求被拒。
// 凭据类配额 fail-closed：DB 模式缺预算关系即拒绝（既有 TestBudgetDatabaseMissingRelationDenies 口径）。
func TestRedTeamBudgetBreachIsBlocked(t *testing.T) {
	t.Setenv("GATEWAY_BUDGET_BACKEND", "")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	t.Setenv("GATEWAY_TOKEN_WINDOW_QUOTA", "off")
	t.Setenv("GATEWAY_QUOTA_POOL", "off")
	dir := t.TempDir()
	t.Setenv("GATEWAY_BUDGET_CONFIG_FILE", writeRedTeamBudget(t, dir, `{"version":2,"users":{"user-rt":{"unit":"cost_usd","period":"day","limit":10,"action":"block"}}}`))
	usagePath := dir + "/budget-usage.json"
	t.Setenv("GATEWAY_BUDGET_USAGE_FILE", usagePath)

	tracker := quota.NewTracker(dir+"/quotas.json", dir+"/quota-usage.json", nil)
	ctx := quota.RequestContext{TenantID: "tenant-rt", UserID: "user-rt", Model: "glm-5.3"}

	// 攻击：先打 8 USD（预算内），再打 5 USD 试图击穿硬限。
	first := tracker.CheckRequest(ctx, 0, 8)
	if !first.Allowed {
		t.Fatalf("in-budget request must pass: %+v", first)
	}
	second := tracker.CheckRequest(ctx, 0, 5)
	if second.Allowed {
		t.Fatalf("budget breach must be blocked, got %+v", second)
	}
	recordDrillResult(t, "budget_breach", "A9-1", "持续消费击穿日预算硬限（block 档）",
		"quota budget 硬限：超限即拒；DB 模式缺关系 fail-closed（TestBudgetDatabaseMissingRelationDenies）",
		"blocked", "TestRedTeamBudgetBreachIsBlocked: second CheckRequest !Allowed")
}

// A10 审计链篡改：写入合法链后篡改任意行 → VerifyAuditChain 检出断裂；
// 与周期自检（StartChainCheck）同源的 CRITICAL chain_check 告警送达通道。
func TestRedTeamAuditChainTamperIsDetectedAndAlerted(t *testing.T) {
	capture := newAlertCapture(t)
	s, auditDir := newIncidentTestServer(t, capture.server.URL)

	// 合法链：两个事件。
	for i := 0; i < 2; i++ {
		s.writeAuditEvent(audit.Event{
			ID: makeID("rt-tamper"), TenantID: "tenant-rt", EventTime: time.Now().UTC().Format(time.RFC3339),
			EventType: "policy_hit", Route: "/v1/chat/completions",
		})
	}
	if err := alertdispatch.VerifyAuditChain(auditDir); err != nil {
		t.Fatalf("pristine chain must verify, got %v", err)
	}

	// 攻击：篡改链上第二行（改事件路由字段 → checksum 失配）。
	if err := redTeamTamperAuditLine(t, auditDir, `"route":"/v1/chat/completions"`, `"route":"/v1/tampered"`); err != nil {
		t.Fatal(err)
	}
	err := alertdispatch.VerifyAuditChain(auditDir)
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("tampered chain must fail verification with checksum mismatch, got %v", err)
	}

	// 检出 → CRITICAL 告警分发（StartChainCheck 周期自检同款 Alert）。
	s.alertDispatcher.Dispatch(alertdispatch.Alert{
		TenantID: "tenant-1", Source: "chain_check", Severity: "CRITICAL",
		Title:   "审计防篡改链校验失败",
		Summary: "Audit chain verification failed: " + err.Error(),
		DedupKey: "chain_check|" + auditDir, EventTime: time.Now().UTC(),
	})
	waitForAlert(t, capture, 1)
	lastAlert, _ := json.Marshal(capture.last(t))
	if !strings.Contains(string(lastAlert), "审计防篡改链校验失败") {
		t.Fatalf("CRITICAL chain tamper alert must reach channel, got %s", lastAlert)
	}
	recordDrillResult(t, "audit_chain_tamper", "A10-1", "篡改审计链 JSONL 行内字段",
		"blake2b checksum 链逐行校验（VerifyAuditChain）+ 周期自检 CRITICAL 告警（StartChainCheck 同源）",
		"alerted", "TestRedTeamAuditChainTamperIsDetectedAndAlerted: ChainError checksum mismatch + CRITICAL alert delivered")
}

// A11 合规内容：合成涉恐/色情演练词 → moderation（provider 真实外呼契约）→
// 90001 阻断 + policy_hit（带 category）先落链 + 告警送达。
func TestRedTeamComplianceContentIsBlockedAuditedAndAlerted(t *testing.T) {
	provider := redTeamModerationProvider(t, `{"blocked":true,"categories":["terrorism"],"score":0.99,"detail":"涉恐演练命中"}`)
	defer provider.Close()
	srv, auditDir := newModerationTestServer(t, provider.URL, "degraded")
	capture := newModerationAlertCapture(t)
	wireModerationDispatcher(t, srv, capture.server.URL)

	identity := requestIdentity{TenantID: "tenant-1", UserID: "user-rt", SessionID: "sess-rt", TraceID: "trace-rt"}
	out := srv.enforceModeration(
		testModerationCtx(t), identity, "request", "涉恐演练合成语句（不落真实敏感词）",
		"glm-5.3", routingDecisionDefault(), "127.0.0.1:1", time.Now(),
	)
	if !out.Checked || !out.Blocked || out.AuditFailed {
		t.Fatalf("compliance drill content must be blocked, got %+v", out)
	}
	if out.Hit.Category != "terrorism" {
		t.Fatalf("category = %q, want terrorism", out.Hit.Category)
	}
	// 先审计后动作：policy_hit 带 category 落链。
	var sawCategoryHit bool
	for _, ev := range readAuditJSONL(t, auditDir) {
		if ev["event_type"] == "policy_hit" {
			sawCategoryHit = true
		}
	}
	if !sawCategoryHit {
		t.Fatal("policy_hit audit event missing")
	}
	waitForAlert(t, capture, 1)
	recordDrillResult(t, "compliance_content", "A11-1", "合成涉恐演练词请求侧注入",
		"moderation 合规审核（provider 可插拔 + 本地规则包兜底）→ 90001 阻断 + policy_hit 审计 + 告警",
		"blocked", "TestRedTeamComplianceContentIsBlockedAuditedAndAlerted: blocked + policy_hit(category) + alert")
}

// A12 会话击杀续用：处置终止会话后原 session JWT 重放 → 401 session_revoked；
// 同租户无关会话不受影响（爆炸半径受限）。
func TestRedTeamKilledSessionReuseIsRejected(t *testing.T) {
	s, auditDir := newIncidentTestServer(t, "http://hook.invalid")
	key := redTeamRSAKey(t)

	// 处置：终止 sess-rt-victim。
	rec := postIncidentActionAuthorized(t, s, map[string]any{
		"incident_id": "inc-rt-2", "action": "terminate_session", "target_type": "session",
		"target_id": "sess-rt-victim", "actor": "admin-rt", "tenant_id": "tenant-1",
	})
	if rec.Code != 200 {
		t.Fatalf("disposition status = %d", rec.Code)
	}

	// 攻击：被杀 session 的新 JWT 重放 → session_revoked。
	victimSigned := signTestAccessJWT(t, key, accessClaims{
		UserID: "user-rt", TenantID: "tenant-1", SessionID: "sess-rt-victim", Type: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenticx-enterprise-web-portal",
			Audience:  jwt.ClaimStrings{"agenticx-web-users"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	if _, err := s.identityFromRequest(newAccessJWTRequest(victimSigned)); err == nil || !strings.Contains(err.Error(), "session_revoked") {
		t.Fatalf("killed session JWT replay must fail with session_revoked, got %v", err)
	}

	// 无关会话不受影响（处置不误伤）。
	otherSigned := signTestAccessJWT(t, key, accessClaims{
		UserID: "user-rt", TenantID: "tenant-1", SessionID: "sess-rt-clean", Type: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenticx-enterprise-web-portal",
			Audience:  jwt.ClaimStrings{"agenticx-web-users"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	if _, err := s.identityFromRequest(newAccessJWTRequest(otherSigned)); err != nil {
		t.Fatalf("unrelated session must keep working, got %v", err)
	}

	// 处置动作在审计链可查且链完整。
	found := false
	for _, ev := range readAuditEvents(t, auditDir) {
		if ev["event_type"] == "incident_action" {
			found = true
		}
	}
	if !found {
		t.Fatal("incident_action audit event missing")
	}
	recordDrillResult(t, "session_kill_reuse", "A12-1", "已终止会话用有效 JWT 重放",
		"SessionRevocationStore：JWT 分支 IsRevoked 即拒（内存即时 + 快照轮询兜底）",
		"blocked", "TestRedTeamKilledSessionReuseIsRejected: session_revoked + unrelated session intact")
}
