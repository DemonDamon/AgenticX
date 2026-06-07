package server

import (
	"net/http"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/routing"
)

func (s *Server) estimateRequestCostUSD(model string, inputTokens int) float64 {
	if inputTokens <= 0 {
		return 0
	}
	outEstimate := inputTokens / 4
	if outEstimate <= 0 {
		outEstimate = 1
	}
	usage := openai.Usage{
		PromptTokens:     inputTokens,
		CompletionTokens: outEstimate,
		TotalTokens:      inputTokens + outEstimate,
	}
	table := s.activePricingTable()
	if table == nil {
		return float64(usage.TotalTokens) * 0.000001
	}
	return table.ComputeCostUSD(model, usage)
}

func (s *Server) applyBudgetFallback(req *openai.ChatCompletionRequest, decision *routing.Decision, check quota.CheckResult) {
	if check.FallbackModel == "" {
		return
	}
	req.Model = check.FallbackModel
	decision.Model = check.FallbackModel
}

func (s *Server) rollbackBudgetReservation(identity requestIdentity, model string, check quota.CheckResult) {
	if s.quotaTracker == nil {
		return
	}
	if check.BudgetReservedTokens == 0 && check.BudgetReservedCost == 0 {
		return
	}
	s.quotaTracker.RollbackBudget(s.quotaContext(identity, model), check.BudgetReservedTokens, check.BudgetReservedCost)
}

func (s *Server) emitBudgetAuditIfNeeded(identity requestIdentity, check quota.CheckResult, r *http.Request) {
	if s.audit == nil || check.Kind != "budget" {
		return
	}
	eventType := ""
	if !check.Allowed {
		eventType = "budget.block"
	} else if check.Warn {
		eventType = "budget.warn"
	}
	if eventType == "" {
		return
	}
	ev := audit.Event{
		ID:           makeID("audit"),
		TenantID:     identity.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    eventType,
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		SessionID:    identity.SessionID,
		ClientType:   "web-portal",
		ClientIP:     r.RemoteAddr,
		Route:        check.Description,
	}
	_ = s.writeAuditEvent(ev)
}

// runChatQuotaGate performs TPM/RPM/concurrency/monthly/budget checks for chat requests.
func (s *Server) runChatQuotaGate(
	w http.ResponseWriter,
	r *http.Request,
	qctx quota.RequestContext,
	identity requestIdentity,
	req *openai.ChatCompletionRequest,
	decision *routing.Decision,
	estimatedInputTokens int,
	reserveTokens int64,
) (quota.CheckResult, billing.Reservation, bool) {
	estimatedCost := s.estimateRequestCostUSD(req.Model, estimatedInputTokens)
	if s.useChannelRelay() {
		reservation := s.billingService.ReserveContext(qctx, reserveTokens, estimatedCost)
		if !reservation.Allowed {
			s.writeQuotaError(w, reservation.Check)
			return reservation.Check, reservation, false
		}
		s.applyQuotaHeaders(w, reservation.Check)
		s.applyBudgetFallback(req, decision, reservation.Check)
		s.emitBudgetAuditIfNeeded(identity, reservation.Check, r)
		return reservation.Check, reservation, true
	}
	check := s.quotaTracker.CheckRequest(qctx, int64(estimatedInputTokens), estimatedCost)
	if !check.Allowed {
		s.writeQuotaError(w, check)
		return check, billing.Reservation{}, false
	}
	s.applyQuotaHeaders(w, check)
	s.applyBudgetFallback(req, decision, check)
	s.emitBudgetAuditIfNeeded(identity, check, r)
	return check, billing.Reservation{}, true
}

func (s *Server) rollbackChatQuotaAndBudget(identity requestIdentity, model string, tokens int, check quota.CheckResult) {
	s.rollbackQuotaReservation(identity, tokens)
	s.rollbackBudgetReservation(identity, model, check)
}
