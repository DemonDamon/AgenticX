package quota

import (
	"errors"
	"fmt"
	"sync"
)

type receiptMode uint8

const (
	receiptOpen receiptMode = iota
	receiptSettling
	receiptRollingBack
	receiptClosed
)

type counterKind uint8

const (
	counterTokenWindow counterKind = iota
	counterSharedPool
	counterLegacyMonthly
)

type counterReservation struct {
	kind      counterKind
	key       PoolKey
	ctx       RequestContext
	rule      Rule
	period    string
	reserved  int64
	leaseID   string
	completed bool
}

// monthlyReservation records the exact admission-time storage path. Keeping
// this on Decision lets CheckRequest build one receipt without re-running rule
// selection after a remote policy refresh.
type monthlyReservation = counterReservation

type budgetReservationLine struct {
	rule      BudgetRule
	dimension string
	key       string
	period    string
	reserved  float64
	completed bool
}

type budgetReservationReceipt struct {
	lines []budgetReservationLine
}

// ReservationReceipt is intentionally opaque outside quota. It binds every
// settle/refund to the exact keys, periods, scopes and rules selected at
// admission, even when completion happens after a calendar boundary or config
// reload. The mutex also makes duplicate terminal callbacks idempotent.
type ReservationReceipt struct {
	mu sync.Mutex

	mode           receiptMode
	reservedTokens int64
	reservedCost   float64
	actualTokens   int64
	actualCost     float64

	windows []counterReservation
	monthly *monthlyReservation
	budget  *budgetReservationReceipt
}

func newReservationReceipt(tokens int64, cost float64) *ReservationReceipt {
	return &ReservationReceipt{reservedTokens: max64(tokens, 0), reservedCost: cost}
}

func (r *ReservationReceipt) addWindow(item counterReservation) {
	if r == nil || item.reserved <= 0 {
		return
	}
	r.windows = append(r.windows, item)
}

func (r *ReservationReceipt) setMonthly(item *monthlyReservation) {
	if r == nil {
		return
	}
	r.monthly = item
}

func (r *ReservationReceipt) setBudget(item *budgetReservationReceipt) {
	if r == nil {
		return
	}
	r.budget = item
}

// RollbackReservation refunds only the counters actually reserved at
// admission. It is safe to retry: entries that already committed are skipped.
func (t *Tracker) RollbackReservation(receipt *ReservationReceipt) error {
	if t == nil || receipt == nil {
		return nil
	}
	receipt.mu.Lock()
	defer receipt.mu.Unlock()
	if receipt.mode == receiptClosed {
		return nil
	}
	if receipt.mode == receiptSettling {
		return errors.New("quota reservation is already settling")
	}
	receipt.mode = receiptRollingBack
	var errs []error
	for index := range receipt.windows {
		item := &receipt.windows[index]
		if item.completed {
			continue
		}
		if err := t.applyCounterDelta(item, -item.reserved, LedgerEventRefund); err != nil {
			errs = append(errs, err)
			continue
		}
		item.completed = true
	}
	if item := receipt.monthly; item != nil && !item.completed {
		if err := t.applyCounterDelta(item, -item.reserved, LedgerEventRefund); err != nil {
			errs = append(errs, err)
		} else {
			item.completed = true
		}
	}
	if receipt.budget != nil {
		if err := t.rollbackBudgetReceipt(receipt.budget); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) == 0 {
		receipt.mode = receiptClosed
	}
	return errors.Join(errs...)
}

// SettleReservation replaces the admission estimate with actual provider
// usage on the same counters. A retry must use the same actual values.
func (t *Tracker) SettleReservation(receipt *ReservationReceipt, actualTokens int64, actualCost float64) error {
	if t == nil || receipt == nil {
		return nil
	}
	receipt.mu.Lock()
	defer receipt.mu.Unlock()
	if receipt.mode == receiptClosed {
		return nil
	}
	if receipt.mode == receiptRollingBack {
		return errors.New("quota reservation is already rolling back")
	}
	actualTokens = max64(actualTokens, 0)
	if receipt.mode == receiptSettling &&
		(receipt.actualTokens != actualTokens || receipt.actualCost != actualCost) {
		return errors.New("quota settlement retry changed actual usage")
	}
	receipt.mode = receiptSettling
	receipt.actualTokens = actualTokens
	receipt.actualCost = actualCost
	delta := actualTokens - receipt.reservedTokens
	var errs []error
	for index := range receipt.windows {
		item := &receipt.windows[index]
		if item.completed {
			continue
		}
		if err := t.applyCounterDelta(item, delta, LedgerEventSettle); err != nil {
			errs = append(errs, err)
			continue
		}
		item.completed = true
	}
	if item := receipt.monthly; item != nil && !item.completed {
		if err := t.applyCounterDelta(item, delta, LedgerEventSettle); err != nil {
			errs = append(errs, err)
		} else {
			item.completed = true
		}
	}
	if receipt.budget != nil {
		if err := t.settleBudgetReceipt(receipt.budget, receipt.reservedTokens, receipt.reservedCost, actualTokens, actualCost); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) == 0 {
		receipt.mode = receiptClosed
	}
	return errors.Join(errs...)
}

func (t *Tracker) applyCounterDelta(item *counterReservation, delta int64, event string) error {
	if item == nil || delta == 0 {
		return nil
	}
	if item.kind == counterLegacyMonthly {
		if delta < 0 {
			if !t.rollbackLegacyMonthlyExact(item.ctx, item.period, -delta) {
				return fmt.Errorf("legacy monthly refund failed period=%s", item.period)
			}
			return nil
		}
		if !t.addLegacyMonthlyExact(item.ctx, item.period, delta, event) {
			return fmt.Errorf("legacy monthly settle failed period=%s", item.period)
		}
		return nil
	}
	counter := t.tokenWindowCounter
	if item.kind == counterSharedPool {
		counter = t.poolCounter
	}
	if counter == nil {
		return fmt.Errorf("quota counter unavailable key=%s", item.key.cacheKey())
	}
	marker := ""
	if item.leaseID != "" {
		active, err := counter.HasRequest(item.key, item.leaseID)
		if err != nil {
			return fmt.Errorf("quota lease lookup failed key=%s: %w", item.key.cacheKey(), err)
		}
		if active {
			marker = item.leaseID
		}
	}
	if delta < 0 {
		_, err := counter.Add(item.key, delta, LedgerEventRefund, marker)
		if err != nil {
			return fmt.Errorf("quota refund failed key=%s: %w", item.key.cacheKey(), err)
		}
		if item.key.ScopeType == tokenScopeMonth && item.kind == counterTokenWindow {
			t.syncMonthlyUserUsage(item.ctx.UserID, item.period, item.key)
		}
		return nil
	}
	limit := int64(0)
	switch item.key.ScopeType {
	case tokenScopeDay:
		limit = item.rule.DailyTokens
	case tokenScopeWeek:
		limit = item.rule.WeeklyTokens
	case tokenScopeMonth:
		limit = item.rule.MonthlyTokens
	default:
		if item.kind == counterSharedPool {
			limit = item.rule.MonthlyTokens
		}
	}
	if item.rule.Action == ActionBlock && limit > 0 {
		reservation, err := counter.ReserveWithTurnGrace(item.key, delta, limit, 0, event, item.leaseID)
		if err != nil {
			return fmt.Errorf("quota settle reserve failed key=%s: %w", item.key.cacheKey(), err)
		}
		if reservation.Allowed {
			if item.key.ScopeType == tokenScopeMonth && item.kind == counterTokenWindow {
				t.syncMonthlyUserUsage(item.ctx.UserID, item.period, item.key)
			}
			return nil
		}
		// The provider has already consumed this usage. Persist it without
		// extending the grace lease; the next admission remains blocked.
	}
	_, err := counter.Add(item.key, delta, event, "")
	if err != nil {
		return fmt.Errorf("quota settle failed key=%s: %w", item.key.cacheKey(), err)
	}
	if item.key.ScopeType == tokenScopeMonth && item.kind == counterTokenWindow {
		t.syncMonthlyUserUsage(item.ctx.UserID, item.period, item.key)
	}
	return nil
}

func (t *Tracker) addLegacyMonthlyExact(ctx RequestContext, period string, delta int64, event string) bool {
	if t == nil || delta <= 0 {
		return true
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	rule := Rule{Action: ActionWarn}
	decision := t.checkAndAddUserLocked(rule, ctx, period, delta, true, event)
	return decision.reservation != nil
}

func (t *Tracker) rollbackLegacyMonthlyExact(ctx RequestContext, period string, tokens int64) bool {
	if t == nil || tokens <= 0 {
		return true
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.rollbackUserLocked(ctx, period, tokens)
}
