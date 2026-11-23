package server

import (
	"context"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/alertdispatch"
	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/routing"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

// moderationOutcome 汇总一次第三方内容安全审核的结论（SP3 compliance-moderation）。
type moderationOutcome struct {
	Checked     bool
	Blocked     bool
	Degraded    bool // provider 故障且 degraded 模式：放行但已发 CRITICAL 告警
	Hit         policyengine.HitEvent
	AuditFailed bool // policy_hit 审计写失败：fail-closed，调用方必须中止请求
}

// enforceModeration 执行第三方内容安全审核：
//   - 未配置/未启用：Checked=false，现状等价（零外呼零阻断）；
//   - provider 故障 + degraded（默认）：不阻断（本地合规规则仍在 evaluatePolicy 生效），
//     发 CRITICAL 告警（SP4 Dispatcher 去重窗口兜底防风暴）；
//   - provider 判 block 或 strict fail-closed：先落 policy_hit 审计（含 category），
//     再由调用方写 90001/90002（先审计后动作纪律）。
func (s *Server) enforceModeration(ctx context.Context, identity requestIdentity, stage, text, model string, decision routing.Decision, remoteAddr string, startedAt time.Time) moderationOutcome {
	if s.moderation == nil {
		return moderationOutcome{}
	}
	result := s.moderation.Enforce(ctx, identity.TenantID, stage, text)
	if !result.Checked {
		return moderationOutcome{}
	}
	if result.Degraded && !result.Blocked {
		s.dispatchModerationDegradedAlert(identity, stage)
		return moderationOutcome{Checked: true, Degraded: true}
	}
	if !result.Blocked {
		return moderationOutcome{Checked: true}
	}

	hit := result.Hit
	digest := &audit.Digest{}
	if stage == "response" {
		digest.ResponseHash = hashText(text)
	} else {
		digest.PromptHash = hashText(text)
	}
	ev := audit.Event{
		ID:           makeID("audit"),
		TenantID:     identity.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    "policy_hit",
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		SessionID:    identity.SessionID,
		TraceID:      identity.TraceID,
		DeploymentID: identity.DeploymentID,
		ClientType:   clientTypeFromIdentity(identity),
		ClientIP:     remoteAddr,
		Model:        model,
		Provider:     decision.Provider,
		Route:        decision.Route,
		Digest:       digest,
		PoliciesHit:  toAuditPolicyHits([]policyengine.HitEvent{hit}),
		LatencyMS:    time.Since(startedAt).Milliseconds(),
	}
	if err := s.writeAuditEvent(ev); err != nil {
		return moderationOutcome{Checked: true, Blocked: true, Hit: hit, AuditFailed: true}
	}
	s.dispatchPolicyAlert(identity, "内容安全拦截("+stage+")", model, []policyengine.HitEvent{hit})
	return moderationOutcome{Checked: true, Blocked: true, Hit: hit}
}

// dispatchModerationDegradedAlert 发送内容安全 provider 故障降级的 CRITICAL 告警。
// DedupKey 固定为租户级：同租户窗口内只告一次，风暴由 SP4 去重窗口与限流兜底。
func (s *Server) dispatchModerationDegradedAlert(identity requestIdentity, stage string) {
	if s.alertDispatcher == nil {
		return
	}
	s.alertDispatcher.Dispatch(alertdispatch.Alert{
		TenantID:  identity.TenantID,
		Source:    "moderation_degraded",
		Severity:  "CRITICAL",
		Title:     "内容安全服务降级",
		Summary:   "第三方内容安全 provider 调用失败，已降级为本地规则兜底（stage=" + stage + "）",
		TraceID:   identity.TraceID,
		SessionID: identity.SessionID,
		UserID:    identity.UserID,
		DedupKey:  "moderation_degraded|" + identity.TenantID,
		EventTime: time.Now().UTC(),
	})
}
