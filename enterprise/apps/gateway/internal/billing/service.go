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

func (s *Service) Reserve(userID, deptID, role, model string, estimate int64) Reservation {
	if s == nil || s.tracker == nil {
		return Reservation{Allowed: true, EstimatedTokens: estimate}
	}
	decision := s.tracker.CheckAndAdd(userID, deptID, role, model, estimate)
	return Reservation{
		ID:              userID + "::" + model,
		EstimatedTokens: estimate,
		Allowed:         decision.Allowed,
		Decision:        decision,
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

func (s *Service) Rollback(userID string, reserved int64) {
	if s == nil || s.tracker == nil || reserved <= 0 {
		return
	}
	s.tracker.Rollback(userID, reserved)
}
