package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/billing"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/agenticx/enterprise/gateway/internal/virtualmodel"
)

type relayQuotaKey struct{}

type relayQuotaState struct {
	Virtual bool
}

type virtualAdmission struct {
	requested   string
	quotaModel  string
	order       []string
	virtualName string
}

// admitVirtual resolves a virtual name once. The first planned model is the
// quota and budget pre-check model. Non-virtual names come back unchanged.
func (s *Server) admitVirtual(tenantID, requested string) virtualAdmission {
	out := virtualAdmission{requested: strings.TrimSpace(requested), quotaModel: strings.TrimSpace(requested)}
	if s == nil || s.virtualLoader == nil || out.requested == "" {
		return out
	}
	order, name, ok := s.virtualLoader.Plan(tenantID, out.requested, s.virtualAvailable(tenantID))
	if !ok || len(order) == 0 {
		return out
	}
	out.order = order
	out.virtualName = name
	out.quotaModel = order[0]
	return out
}

func (s *Server) virtualAvailable(tenantID string) func(string) bool {
	return func(model string) bool {
		if s == nil || s.channelPicker == nil {
			return false
		}
		return s.channelPicker.HasRoutableChannel(tenantID, model)
	}
}

// relayContext carries the admission plan into Executor so it does not sample again.
// A budget fallback that replaces the request model with a non-virtual name drops the plan.
func (s *Server) relayContext(ctx context.Context, tenantID, currentModel string, admission virtualAdmission) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if admission.virtualName == "" {
		return ctx
	}
	ctx = context.WithValue(ctx, relayQuotaKey{}, relayQuotaState{Virtual: true})
	if strings.TrimSpace(currentModel) != admission.requested {
		if s == nil || s.virtualLoader == nil {
			return ctx
		}
		order, name, ok := s.virtualLoader.Plan(tenantID, currentModel, s.virtualAvailable(tenantID))
		if !ok || len(order) == 0 {
			return ctx
		}
		return virtualmodel.WithPlan(ctx, order, name)
	}
	return virtualmodel.WithPlan(ctx, admission.order, admission.virtualName)
}

func (s *Server) withRelayContext(r *http.Request, tenantID, currentModel string, admission virtualAdmission) *http.Request {
	if r == nil {
		return r
	}
	return r.WithContext(s.relayContext(r.Context(), tenantID, currentModel, admission))
}

// settleRelayQuota applies the reservation delta.
// A virtual request whose actual model differs from the pre-check model rolls the
// estimate back on the pre-check model and records the actual tokens on the model
// that served the request. Ordinary requests keep the existing delta settlement.
func (s *Server) settleRelayQuota(
	ctx context.Context,
	identity requestIdentity,
	qctx quota.RequestContext,
	reserved int64,
	actual int64,
	actualModel string,
) billing.SettleResult {
	state, _ := ctx.Value(relayQuotaKey{}).(relayQuotaState)
	actualModel = strings.TrimSpace(actualModel)
	if !state.Virtual || actualModel == "" || actualModel == strings.TrimSpace(qctx.Model) {
		return s.billingService.SettleContext(qctx, reserved, actual)
	}
	s.billingService.RollbackContext(qctx, reserved)
	s.recordModelUsage(identity, actualModel, actual)
	return billing.SettleResult{Reserved: reserved, Actual: actual, Delta: actual - reserved}
}

// reconcileChatQuota is the non-relay counterpart. The baseline is the amount
// already reserved (estimated input tokens). Ordinary requests still reconcile
// against the model argument the caller passes, which is the request model
// after any budget fallback.
func (s *Server) reconcileChatQuota(
	ctx context.Context,
	identity requestIdentity,
	qctx quota.RequestContext,
	estimated int,
	finalTotal int,
	actualModel string,
) {
	state, _ := ctx.Value(relayQuotaKey{}).(relayQuotaState)
	actualModel = strings.TrimSpace(actualModel)
	if !state.Virtual {
		s.reconcileQuotaUsage(identity, actualModel, estimated, finalTotal)
		return
	}
	if actualModel == "" || actualModel == strings.TrimSpace(qctx.Model) {
		s.reconcileQuotaUsage(identity, qctx.Model, estimated, finalTotal)
		return
	}
	s.rollbackQuotaReservation(qctx, estimated)
	s.recordModelUsage(identity, actualModel, int64(finalTotal))
}

func (s *Server) recordModelUsage(identity requestIdentity, model string, tokens int64) {
	if s == nil || s.quotaTracker == nil || tokens <= 0 {
		return
	}
	decision := s.quotaTracker.CheckAndAddContext(s.quotaContext(identity, model), tokens, quota.LedgerEventSettle)
	if decision.Allowed && decision.Description != "no quota" {
		return
	}
	_, _ = s.quotaTracker.AddUsage(identity.UserID, tokens)
}
