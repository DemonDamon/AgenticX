package quota

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// The database ledger reserves every active budget dimension in one transaction.
type budgetStoredLine struct {
	Rule      BudgetRule `json:"rule"`
	Dimension string     `json:"dimension"`
	Key       string     `json:"key"`
	Period    string     `json:"period"`
	Reserved  float64    `json:"reserved"`
}

func budgetStoredLines(lines []BudgetReceiptLine) []budgetStoredLine {
	stored := make([]budgetStoredLine, 0, len(lines))
	for _, line := range lines {
		stored = append(stored, budgetStoredLine{
			Rule: line.Rule, Dimension: line.Dimension, Key: line.Key,
			Period: line.Period, Reserved: line.Reserved,
		})
	}
	return stored
}

func budgetDatabaseUnavailable() BudgetDecision {
	return BudgetDecision{Allowed: false, StorageError: true, Description: "policy:budget:storage_unavailable"}
}

func budgetLedgerMissing() BudgetDecision {
	log.Printf("[budget] ledger table missing; apply the gateway budget ledger migration")
	return BudgetDecision{Allowed: false, StorageError: true, Description: "policy:budget:ledger_unavailable"}
}

func budgetUsageInsertSQL(dialect database.Dialect) string {
	if dialect == database.PostgreSQL {
		return `INSERT INTO gateway_budget_usage
			(tenant_id, dimension, dimension_key, period, unit, used_value, updated_at)
			VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
			ON CONFLICT (tenant_id, dimension, dimension_key, period, unit) DO NOTHING`
	}
	return `INSERT IGNORE INTO gateway_budget_usage
		(tenant_id, dimension, dimension_key, period, unit, used_value, updated_at)
		VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
}

func (t *Tracker) checkBudgetDatabase(ctx RequestContext, targets []budgetTarget, tokens int64, costUSD float64) BudgetDecision {
	if t.budgetDatabase == nil || t.budgetDatabase.DB == nil {
		return budgetDatabaseUnavailable()
	}
	// Lock rows in a canonical order. Admission decisions still follow the
	// original company → tenant → department → personal order.
	locked := append([]budgetTarget(nil), targets...)
	sortBudgetTargets(locked)

	dbCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	tx, err := t.budgetDatabase.DB.BeginTx(dbCtx, nil)
	if err != nil {
		return budgetDatabaseUnavailable()
	}
	defer func() { _ = tx.Rollback() }()

	at := budgetUsageNow().UTC()
	usedBy := make(map[string]float64, len(locked))
	for _, target := range locked {
		period := budgetPeriodKey(target.rule.Period, at)
		used, readErr := t.readBudgetUsedTx(dbCtx, tx, ctx.TenantID, target, period)
		if readErr != nil {
			if database.IsMissingRelation(readErr) {
				return budgetLedgerMissing()
			}
			return budgetDatabaseUnavailable()
		}
		usedBy[budgetUsageAmountKey(target, period)] = used
	}

	receipt := &BudgetReceipt{database: true, Lines: make([]BudgetReceiptLine, 0, len(targets))}
	var notable *BudgetDecision
	var warnings []BudgetDecision
	for _, target := range targets {
		period := budgetPeriodKey(target.rule.Period, at)
		used := usedBy[budgetUsageAmountKey(target, period)]
		delta := budgetDelta(target.rule, tokens, costUSD)
		decision := evaluateBudgetTarget(target, period, used, delta)
		if !decision.Allowed {
			t.emitBudgetAlert(ctx, decision, "block")
			return decision
		}
		receipt.Lines = append(receipt.Lines, BudgetReceiptLine{
			Dimension: target.dimension,
			Key:       target.key,
			Period:    period,
			Unit:      target.rule.Unit,
			Reserved:  delta,
			Rule:      target.rule,
		})
		if decision.Warn {
			warnings = append(warnings, decision)
		}
		if notable == nil && (decision.Warn || decision.FallbackModel != "") {
			copy := decision
			notable = &copy
		}
	}

	for _, line := range receipt.Lines {
		if line.Reserved == 0 {
			continue
		}
		used := usedBy[budgetTargetLockKey(budgetTarget{rule: line.Rule, dimension: line.Dimension, key: line.Key})+"\x00"+line.Period]
		if err := t.writeBudgetUsedTx(dbCtx, tx, ctx.TenantID, line.Dimension, line.Key, line.Period, line.Unit, used+line.Reserved); err != nil {
			if database.IsMissingRelation(err) {
				return budgetLedgerMissing()
			}
			return budgetDatabaseUnavailable()
		}
	}

	id, err := newBudgetReceiptID()
	if err != nil {
		return budgetDatabaseUnavailable()
	}
	receipt.ID = id
	linesJSON, err := json.Marshal(budgetStoredLines(receipt.Lines))
	if err != nil {
		return budgetDatabaseUnavailable()
	}
	insert := `INSERT INTO gateway_budget_reservations
		(receipt_id, tenant_id, state, lines_json, created_at, updated_at)
		VALUES (?, ?, 'reserved', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
	if _, err := t.budgetTxExec(dbCtx, tx, insert, id, ctx.TenantID, string(linesJSON)); err != nil {
		if database.IsMissingRelation(err) {
			return budgetLedgerMissing()
		}
		return budgetDatabaseUnavailable()
	}
	if err := tx.Commit(); err != nil {
		if rollbackErr := t.finishBudgetDatabase(receipt, 0, 0, true); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrNoRows) {
			log.Printf("[budget] ambiguous reservation commit requires reconciliation receipt=%s: %v", id, rollbackErr)
		}
		return budgetDatabaseUnavailable()
	}
	for _, decision := range warnings {
		t.emitBudgetAlert(ctx, decision, "warn")
	}
	if notable != nil {
		notable.ReservedTokens = tokens
		notable.ReservedCost = costUSD
		notable.Receipt = receipt
		return *notable
	}
	return BudgetDecision{
		Allowed: true, Description: "ok",
		ReservedTokens: tokens, ReservedCost: costUSD, Receipt: receipt,
	}
}

func newBudgetReceiptID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes[:]), nil
}

func (t *Tracker) budgetTxExec(ctx context.Context, tx *sql.Tx, query string, args ...any) (sql.Result, error) {
	bound, err := database.Rebind(t.budgetDatabase.Dialect, query)
	if err != nil {
		return nil, err
	}
	return tx.ExecContext(ctx, bound, args...)
}

func (t *Tracker) budgetTxQueryRow(ctx context.Context, tx *sql.Tx, query string, args ...any) (*sql.Row, error) {
	bound, err := database.Rebind(t.budgetDatabase.Dialect, query)
	if err != nil {
		return nil, err
	}
	return tx.QueryRowContext(ctx, bound, args...), nil
}

func budgetUsageAmountKey(target budgetTarget, period string) string {
	return budgetTargetLockKey(target) + "\x00" + period
}

func (t *Tracker) readBudgetUsedTx(ctx context.Context, tx *sql.Tx, tenantID string, target budgetTarget, period string) (float64, error) {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(target.key) == "" {
		return 0, errors.New("budget ledger requires tenant and scope identifiers")
	}
	if _, err := t.budgetTxExec(ctx, tx, budgetUsageInsertSQL(t.budgetDatabase.Dialect), tenantID, target.dimension, target.key, period, target.rule.Unit); err != nil {
		return 0, err
	}
	row, err := t.budgetTxQueryRow(ctx, tx, `SELECT used_value FROM gateway_budget_usage
		WHERE tenant_id = ? AND dimension = ? AND dimension_key = ? AND period = ? AND unit = ? FOR UPDATE`,
		tenantID, target.dimension, target.key, period, target.rule.Unit)
	if err != nil {
		return 0, err
	}
	var used float64
	if err := row.Scan(&used); err != nil {
		return 0, err
	}
	return used, nil
}

func (t *Tracker) writeBudgetUsedTx(ctx context.Context, tx *sql.Tx, tenantID, dimension, key, period, unit string, used float64) error {
	if math.IsNaN(used) || math.IsInf(used, 0) {
		return errors.New("invalid budget usage")
	}
	if used < 0 {
		used = 0
	}
	_, err := t.budgetTxExec(ctx, tx, `UPDATE gateway_budget_usage SET used_value = ?, updated_at = CURRENT_TIMESTAMP
		WHERE tenant_id = ? AND dimension = ? AND dimension_key = ? AND period = ? AND unit = ?`,
		used, tenantID, dimension, key, period, unit)
	return err
}

func (t *Tracker) readBudgetUsedDatabase(tenantID, dimension, key, period, unit string) (float64, error) {
	if t.budgetDatabase == nil || t.budgetDatabase.DB == nil {
		return 0, errors.New("budget database unavailable")
	}
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(key) == "" {
		return 0, errors.New("budget ledger requires tenant and scope identifiers")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	row, err := t.budgetDatabase.QueryRowContext(ctx, `SELECT used_value FROM gateway_budget_usage
		WHERE tenant_id = ? AND dimension = ? AND dimension_key = ? AND period = ? AND unit = ?`,
		tenantID, dimension, key, period, unit)
	if err != nil {
		return 0, err
	}
	var used float64
	if err := row.Scan(&used); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		if database.IsMissingRelation(err) {
			log.Printf("[budget] ledger table missing; apply the gateway budget ledger migration")
		}
		return 0, err
	}
	return used, nil
}

func (t *Tracker) finishBudgetDatabase(receipt *BudgetReceipt, actualTokens int64, actualCost float64, rollback bool) error {
	if t.budgetDatabase == nil || t.budgetDatabase.DB == nil || receipt == nil || receipt.ID == "" {
		return errors.New("budget database reservation unavailable")
	}
	if math.IsNaN(actualCost) || math.IsInf(actualCost, 0) {
		return errors.New("invalid budget settlement cost")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	tx, err := t.budgetDatabase.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	row, err := t.budgetTxQueryRow(ctx, tx, `SELECT tenant_id, state, lines_json, actual_tokens, actual_cost_usd
		FROM gateway_budget_reservations WHERE receipt_id = ? FOR UPDATE`, receipt.ID)
	if err != nil {
		return err
	}
	var tenantID, state, linesJSON string
	var storedTokens sql.NullInt64
	var storedCost sql.NullFloat64
	if err := row.Scan(&tenantID, &state, &linesJSON, &storedTokens, &storedCost); err != nil {
		return err
	}
	if rollback && state == "rolled_back" {
		return nil
	}
	if !rollback && state == "settled" {
		if storedTokens.Valid && storedCost.Valid && storedTokens.Int64 == actualTokens && math.Abs(storedCost.Float64-actualCost) < 0.000001 {
			return nil
		}
		return errors.New("budget settlement retry changed actual usage")
	}
	if state != "reserved" {
		return fmt.Errorf("budget reservation already %s", state)
	}
	var lines []budgetStoredLine
	if err := json.Unmarshal([]byte(linesJSON), &lines); err != nil {
		return fmt.Errorf("decode budget reservation: %w", err)
	}
	for _, line := range lines {
		target := budgetTarget{rule: line.Rule, dimension: line.Dimension, key: line.Key}
		used, err := t.readBudgetUsedTx(ctx, tx, tenantID, target, line.Period)
		if err != nil {
			return err
		}
		delta := -line.Reserved
		if !rollback {
			delta = budgetDelta(line.Rule, actualTokens, actualCost) - line.Reserved
		}
		if delta != 0 {
			if err := t.writeBudgetUsedTx(ctx, tx, tenantID, line.Dimension, line.Key, line.Period, line.Rule.Unit, used+delta); err != nil {
				return err
			}
		}
	}
	newState := "settled"
	var tokenArg, costArg any = actualTokens, actualCost
	if rollback {
		newState, tokenArg, costArg = "rolled_back", nil, nil
	}
	if _, err := t.budgetTxExec(ctx, tx, `UPDATE gateway_budget_reservations
		SET state = ?, actual_tokens = ?, actual_cost_usd = ?, updated_at = CURRENT_TIMESTAMP
		WHERE receipt_id = ?`, newState, tokenArg, costArg, receipt.ID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	for i := range receipt.Lines {
		receipt.Lines[i].completed = true
	}
	return nil
}

// adjustBudgetDatabase updates every selected dimension together for callers
// that do not have an admission receipt.
func (t *Tracker) adjustBudgetDatabase(tenantID string, targets []budgetTarget, amounts []float64) error {
	if t.budgetDatabase == nil || t.budgetDatabase.DB == nil {
		return errors.New("budget database unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	tx, err := t.budgetDatabase.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	ordered := append([]budgetTarget(nil), targets...)
	sortBudgetTargets(ordered)
	amountByKey := make(map[string]float64, len(targets))
	for i, target := range targets {
		amountByKey[budgetTargetLockKey(target)] = amounts[i]
	}
	for _, target := range ordered {
		amount := amountByKey[budgetTargetLockKey(target)]
		if amount == 0 {
			continue
		}
		period := budgetPeriodKey(target.rule.Period, budgetUsageNow().UTC())
		used, err := t.readBudgetUsedTx(ctx, tx, tenantID, target, period)
		if err != nil {
			return err
		}
		if err := t.writeBudgetUsedTx(ctx, tx, tenantID, target.dimension, target.key, period, target.rule.Unit, used+amount); err != nil {
			return err
		}
	}
	return tx.Commit()
}
