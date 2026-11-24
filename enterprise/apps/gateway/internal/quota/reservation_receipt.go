package quota

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
)

// ReservationLine names a counter as it was charged at admission. Rule changes
// and clock rollover must never redirect the final adjustment to another row.
type ReservationLine struct {
	ReserveID string
	Kind      string
	Key       PoolKey
	UserID    string
	Period    string
	Rule      Rule
	Reserved  int64
	completed bool
}

// ReservationReceipt owns one admission lifecycle. Share its pointer, not a
// copy. A first terminal decision is immutable; retries finish only pending rows.
type ReservationReceipt struct {
	Lease           ConcurrencyLease
	ID              string
	Lines           []ReservationLine
	Budget          *BudgetReceipt
	mu              sync.Mutex
	terminal        bool
	actualTokens    int64
	actualCost      float64
	budgetCompleted bool
	costSelected    bool
	release         func()
	released        bool
}

// FinishReservation settles or refunds the rows actually reserved. It deliberately
// does not enforce a newly selected limit against already consumed output.
func (t *Tracker) FinishReservation(r *ReservationReceipt, tokens int64, cost float64) error {
	return t.finishReservation(r, tokens, &cost)
}

// FinishReservationTokens supports callers that do not carry priced usage.
func (t *Tracker) FinishReservationTokens(r *ReservationReceipt, tokens int64) error {
	return t.finishReservation(r, tokens, nil)
}

func (t *Tracker) finishReservation(r *ReservationReceipt, tokens int64, cost *float64) error {
	if t == nil || r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.terminal {
		r.terminal = true
		r.actualTokens = max64(tokens, 0)
	}
	if cost != nil && !r.costSelected {
		r.costSelected = true
		r.actualCost = *cost
		if r.actualCost < 0 {
			r.actualCost = 0
		}
	}
	var errs []error
	for i := range r.Lines {
		line := &r.Lines[i]
		if line.completed {
			continue
		}
		delta := r.actualTokens - line.Reserved
		var err error
		if db, ok := t.poolCounter.(*PGPoolCounter); ok && line.Kind != "monthly_user" {
			_, err = db.finishReservation(line.Key, line.ReserveID, fmt.Sprintf("%s/%d", r.ID, i), r.actualTokens)
		} else if delta != 0 {
			event := LedgerEventSettle
			if r.actualTokens == 0 {
				event = LedgerEventRefund
			}
			if line.Kind == "monthly_user" {
				_, err = t.adjustUserReservation(line.UserID, line.Period, delta, Rule{}, false)
			} else if t.poolCounter == nil {
				err = errors.New("reserved pool counter unavailable")
			} else {
				_, err = t.poolCounter.Add(line.Key, delta, event, fmt.Sprintf("%s/%d", r.ID, i))
			}
		}
		if err != nil {
			errs = append(errs, err)
		} else {
			line.completed = true
		}
	}
	if r.costSelected && !r.budgetCompleted {
		var err error
		if r.actualTokens == 0 && r.actualCost == 0 {
			err = t.RollbackBudgetReceipt(r.Budget)
		} else {
			err = t.SettleBudgetReceipt(r.Budget, r.actualTokens, r.actualCost)
		}
		if err != nil {
			errs = append(errs, err)
		} else {
			r.budgetCompleted = true
		}
	}
	return errors.Join(errs...)
}

// ReleaseReservation releases exactly the slot acquired by this admission,
// even when its rule has since disappeared. A rejected request owns no slot.
func (t *Tracker) ReleaseReservation(r *ReservationReceipt) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.released {
		return
	}
	r.released = true
	if r.release != nil {
		r.release()
	}
}

func (t *Tracker) reserveMonthlyReceipt(ctx RequestContext, cfg Config, tokens int64, receipt *ReservationReceipt) Decision {
	rule := selectRule(cfg, ctx.UserID, ctx.DeptID, ctx.Role, ctx.Model)
	subject := ctx.UserID
	if agentRule, agentSubject, ok := appliedAgentRule(cfg, ctx); ok && agentRule.MonthlyTokens > 0 {
		rule = agentRule
		subject = agentSubject
	}
	if rule.MonthlyTokens <= 0 || tokens <= 0 {
		return Decision{Allowed: true, Rule: rule}
	}
	period := requestCountNow().UTC().Format("2006-01")
	if key, ok := poolKeyFor(rule, ctx, period); ok && t.poolCounter != nil && subject == ctx.UserID {
		used, err := t.poolCounter.Current(key)
		if err != nil {
			return Decision{Allowed: false, StorageError: true, Rule: rule, Description: "quota reservation storage failed"}
		}
		allowed := used+tokens <= rule.MonthlyTokens || rule.Action != ActionBlock
		after := used
		if allowed {
			line := ReservationLine{Kind: "monthly_pool", Key: key, Period: period, Rule: rule, Reserved: tokens, ReserveID: receipt.ID + "/reserve/month"}
			_, databaseCounter := t.poolCounter.(*PGPoolCounter)
			if databaseCounter {
				receipt.Lines = append(receipt.Lines, line)
			}
			after, err = t.poolCounter.Add(key, tokens, LedgerEventReserve, line.ReserveID)
			if err != nil {
				return Decision{Allowed: false, StorageError: true, Rule: rule, Description: "quota reservation storage failed"}
			}
			if !databaseCounter {
				receipt.Lines = append(receipt.Lines, line)
			}
		}
		return Decision{Allowed: allowed, Rule: rule, UsedBefore: used, UsedAfter: after, ExceededBy: max64(after-rule.MonthlyTokens, 0)}
	}
	used, err := t.adjustUserReservation(subject, period, tokens, rule, true)
	if err != nil {
		return Decision{Allowed: false, StorageError: true, Rule: rule, UsedAfter: used, Description: "quota reservation storage failed"}
	}
	allowed := used+tokens <= rule.MonthlyTokens || rule.Action != ActionBlock
	if allowed {
		receipt.Lines = append(receipt.Lines, ReservationLine{Kind: "monthly_user", UserID: subject, Period: period, Rule: rule, Reserved: tokens})
	}
	return Decision{Allowed: allowed, Rule: rule, UsedBefore: used, UsedAfter: used + tokens, ExceededBy: max64(used+tokens-rule.MonthlyTokens, 0)}
}

// adjustUserReservation uses the captured subject/month and commits its cache
// only after the file write succeeds. Refunds cannot resurrect stale cache data.
func (t *Tracker) adjustUserReservation(subject, period string, delta int64, rule Rule, reserve bool) (int64, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	unlock, ok := t.lockUsageFile()
	if !ok {
		return 0, errors.New("quota usage lock failed")
	}
	defer unlock()
	rows := []usageRow{}
	raw, err := os.ReadFile(t.usagePath)
	if err != nil && !os.IsNotExist(err) {
		return 0, err
	}
	if err == nil {
		if err = json.Unmarshal(raw, &rows); err != nil {
			return 0, errors.New("invalid quota usage file")
		}
	}
	used := int64(0)
	index := -1
	for i, row := range rows {
		if row.UserID == subject && row.Month == period {
			used = row.UsedTotal
			index = i
			break
		}
	}
	if reserve && rule.Action == ActionBlock && used+delta > rule.MonthlyTokens {
		return used, nil
	}
	after := max64(used+delta, 0)
	if index < 0 {
		rows = append(rows, usageRow{UserID: subject, Month: period, UsedTotal: after})
	} else {
		rows[index].UsedTotal = after
	}
	if !t.writeUsage(rows) {
		return used, errors.New("quota usage persist failed")
	}
	t.usageCache[cacheKey(subject, period)] = after
	return used, nil
}
