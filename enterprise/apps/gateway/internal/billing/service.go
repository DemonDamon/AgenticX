package billing

import (
	"github.com/agenticx/enterprise/gateway/internal/quota"
)

// Reservation 预扣结果。
type Reservation struct {
	ID              string
	EstimatedTokens int64
	Allowed         bool
	Decision        quota.Decision
	Check           quota.CheckResult
}

// SettleResult 结算差额。
type SettleResult struct {
	Reserved int64
	Actual   int64
	Delta    int64
}

// Service 在 quotaTracker 之上提供 Reserve / Settle 语义（FR-5）。
type Service struct {
	tracker *quota.Tracker
}

func NewService(tracker *quota.Tracker) *Service {
	return &Service{tracker: tracker}
}

func (s *Service) quotaCtx(userID, deptID, role, model, tenantID, apiTokenID string) quota.RequestContext {
	return quota.RequestContext{
		TenantID:   tenantID,
		UserID:     userID,
		DeptID:     deptID,
		APITokenID: apiTokenID,
		Role:       role,
		Model:      model,
	}
}

func (s *Service) Reserve(userID, deptID, role, model string, estimate int64) Reservation {
	return s.ReserveContext(s.quotaCtx(userID, deptID, role, model, "", ""), estimate)
}

func (s *Service) ReserveContext(ctx quota.RequestContext, estimate int64) Reservation {
	if s == nil || s.tracker == nil {
		return Reservation{Allowed: true, EstimatedTokens: estimate}
	}
	check := s.tracker.CheckRequest(ctx, estimate)
	decision := quota.Decision{Allowed: check.Allowed, Rule: check.Rule, Description: check.Description}
	return Reservation{
		ID:              ctx.UserID + "::" + ctx.Model,
		EstimatedTokens: estimate,
		Allowed:         check.Allowed,
		Decision:        decision,
		Check:           check,
	}
}

func (s *Service) Settle(userID, deptID, role, model string, reserved, actual int64) SettleResult {
	result := SettleResult{Reserved: reserved, Actual: actual, Delta: actual - reserved}
	if s == nil || s.tracker == nil {
		return result
	}
	if result.Delta == 0 {
		return result
	}
	if result.Delta < 0 {
		s.tracker.Rollback(userID, -result.Delta)
		return result
	}
	s.tracker.CheckAndAdd(userID, deptID, role, model, result.Delta)
	return result
}

func (s *Service) ReleaseContext(ctx quota.RequestContext) {
	if s == nil || s.tracker == nil {
		return
	}
	s.tracker.ReleaseConcurrency(ctx)
}

func (s *Service) Rollback(userID string, reserved int64) {
	if s == nil || s.tracker == nil || reserved <= 0 {
		return
	}
	s.tracker.Rollback(userID, reserved)
}
