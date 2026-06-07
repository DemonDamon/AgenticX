package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	gatewayauth "github.com/agenticx/enterprise/gateway/internal/auth"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

func (s *Server) effectiveScopes(r *http.Request, identity requestIdentity) []string {
	scopes := append([]string{}, identity.Scopes...)
	if s.sessionGrants == nil || identity.SessionID == "" {
		return scopes
	}
	extra := s.sessionGrants.ScopesFor(r.Context(), identity.TenantID, identity.SessionID)
	return gatewayauth.MergeScopes(scopes, extra)
}

func (s *Server) hasEffectiveScope(r *http.Request, identity requestIdentity, required string) bool {
	return gatewayauth.HasScope(s.effectiveScopes(r, identity), required)
}

func (s *Server) applyResponseFieldPolicy(identity requestIdentity, payload any) (any, policyengine.EvaluateResult) {
	if s.policy == nil {
		return payload, policyengine.EvaluateResult{}
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return payload, policyengine.EvaluateResult{}
	}
	s.policyMu.RLock()
	engine := s.policy
	s.policyMu.RUnlock()
	if engine == nil {
		return payload, policyengine.EvaluateResult{}
	}
	out, result := engine.EvaluateJSONFields(raw, makeEvalContext(identity, "response"))
	if result.Blocked {
		return payload, result
	}
	var parsed any
	if err := json.Unmarshal(out, &parsed); err != nil {
		return payload, result
	}
	return parsed, result
}

func (s *Server) writeFieldPolicyBlock(w http.ResponseWriter, identity requestIdentity, r *http.Request, result policyengine.EvaluateResult) {
	if s.audit != nil {
		_ = s.writeAuditEvent(audit.Event{
			ID:           makeID("audit"),
			TenantID:     identity.TenantID,
			EventTime:    time.Now().UTC().Format(time.RFC3339),
			EventType:    "policy_hit",
			UserID:       identity.UserID,
			UserEmail:    identity.UserEmail,
			DepartmentID: identity.DepartmentID,
			SessionID:    identity.SessionID,
			ClientType:   "web-portal",
			ClientIP:     r.RemoteAddr,
			Route:        "field:deny",
			PoliciesHit:  toAuditPolicyHits(result.Hits),
		})
	}
	writePolicyError(w, "90003", "响应字段触发访问控制", result.Hits)
}
