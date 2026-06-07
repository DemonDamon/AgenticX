package server

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/residency"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func (s *Server) resolveSrcRegion(identity requestIdentity, policy residency.TenantPolicy) string {
	if r := residency.NormalizeRegion(identity.DataResidency); r != "" {
		return r
	}
	return residency.NormalizeRegion(policy.DataResidency)
}

func (s *Server) resolveDstRegion(decision routing.Decision) string {
	if id := strings.TrimSpace(decision.ChannelID); id != "" && s.channelRegistry != nil {
		if ch, ok := s.channelRegistry.ByID(id); ok {
			if r := residency.NormalizeRegion(ch.Region); r != "" {
				return r
			}
		}
	}
	route := strings.ToLower(strings.TrimSpace(decision.Route))
	switch route {
	case "local", "private-cloud":
		return ""
	default:
		return residency.NormalizeRegion(os.Getenv("GATEWAY_DEFAULT_UPSTREAM_REGION"))
	}
}

func (s *Server) evaluateCrossBorder(r *http.Request, identity requestIdentity, decision routing.Decision) residency.Result {
	if s.compliance == nil {
		return residency.Judge("", s.resolveDstRegion(decision), residency.TenantPolicy{CrossBorderAction: residency.ActionAllow})
	}
	ctx := context.Background()
	if r != nil {
		ctx = r.Context()
	}
	policy := s.compliance.PolicyFor(ctx, identity.TenantID)
	src := s.resolveSrcRegion(identity, policy)
	dst := s.resolveDstRegion(decision)
	return residency.Judge(src, dst, policy)
}

func applyCrossBorderAuditFields(event *audit.Event, cb residency.Result) {
	if event == nil {
		return
	}
	event.SrcRegion = cb.SrcRegion
	event.DstRegion = cb.DstRegion
	event.CrossBorder = cb.CrossBorder
	event.ResidencyRule = cb.ResidencyRule
}

func (s *Server) enforceCrossBorder(
	w http.ResponseWriter,
	r *http.Request,
	identity requestIdentity,
	decision routing.Decision,
	startedAt time.Time,
	latestUserText string,
) (residency.Result, bool) {
	cb := s.evaluateCrossBorder(r, identity, decision)
	if !cb.CrossBorder {
		return cb, true
	}
	if cb.Blocked {
		ev := audit.Event{
			ID:           makeID("audit"),
			TenantID:     identity.TenantID,
			EventTime:    time.Now().UTC().Format(time.RFC3339),
			EventType:    "policy_hit",
			UserID:       identity.UserID,
			UserEmail:    identity.UserEmail,
			DepartmentID: identity.DepartmentID,
			SessionID:    identity.SessionID,
			ClientType:   clientTypeFromIdentity(identity),
			ClientIP:     r.RemoteAddr,
			Model:        decision.Model,
			Provider:     decision.Provider,
			Route:        decision.Route,
			Digest:       &audit.Digest{PromptHash: hashText(latestUserText)},
			LatencyMS:    time.Since(startedAt).Milliseconds(),
		}
		applyCrossBorderAuditFields(&ev, cb)
		_ = s.writeAuditEvent(ev)
		writePolicyError(w, "90004", "跨境数据流动被策略拦截", nil)
		return cb, false
	}
	if cb.PendingApproval {
		ev := audit.Event{
			ID:           makeID("audit"),
			TenantID:     identity.TenantID,
			EventTime:    time.Now().UTC().Format(time.RFC3339),
			EventType:    "policy_hit",
			UserID:       identity.UserID,
			UserEmail:    identity.UserEmail,
			DepartmentID: identity.DepartmentID,
			SessionID:    identity.SessionID,
			ClientType:   clientTypeFromIdentity(identity),
			ClientIP:     r.RemoteAddr,
			Model:        decision.Model,
			Provider:     decision.Provider,
			Route:        decision.Route,
			Digest:       &audit.Digest{PromptHash: hashText(latestUserText)},
			LatencyMS:    time.Since(startedAt).Milliseconds(),
		}
		applyCrossBorderAuditFields(&ev, cb)
		_ = s.writeAuditEvent(ev)
		writeAPIError(w, openai.Forbidden("cross_border:require_approval"))
		return cb, false
	}
	return cb, true
}

func clientTypeFromIdentity(identity requestIdentity) string {
	if ct := strings.TrimSpace(identity.ClientType); ct != "" {
		return ct
	}
	return "web-portal"
}
