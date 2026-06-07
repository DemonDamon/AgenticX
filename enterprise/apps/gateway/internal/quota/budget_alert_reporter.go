package quota

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

// BudgetAlertReporter persists budget alerts to Postgres (best-effort).
type BudgetAlertReporter struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewBudgetAlertReporter(connectionString string, logger *slog.Logger) (*BudgetAlertReporter, error) {
	connectionString = ensureBudgetReporterSSLMode(connectionString)
	db, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}
	db.SetConnMaxLifetime(10 * time.Minute)
	db.SetMaxOpenConns(3)
	pingCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &BudgetAlertReporter{db: db, logger: logger}, nil
}

func (r *BudgetAlertReporter) Emit(record BudgetAlertRecord) {
	if r == nil || r.db == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, err := r.db.ExecContext(ctx, `
      insert into gateway_budget_alerts (
        id, tenant_id, dept_id, user_id, dimension, dimension_key, period, unit,
        alert_type, used_value, limit_value, warn_threshold_pct, description, created_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      )
    `,
			record.ID,
			nullBudgetString(record.TenantID),
			nullBudgetString(record.DeptID),
			nullBudgetString(record.UserID),
			record.Dimension,
			record.DimensionKey,
			record.Period,
			record.Unit,
			record.AlertType,
			record.Used,
			record.Limit,
			record.WarnThresholdPct,
			nullBudgetString(record.Description),
			record.CreatedAt.UTC(),
		)
		if err != nil && r.logger != nil {
			r.logger.Warn("budget alert write failed", "error", err)
		}
	}()
}

func nullBudgetString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func ensureBudgetReporterSSLMode(connectionString string) string {
	trimmed := strings.TrimSpace(connectionString)
	if trimmed == "" {
		return trimmed
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "sslmode=") {
		return trimmed
	}
	if strings.HasPrefix(lower, "postgres://") || strings.HasPrefix(lower, "postgresql://") {
		sep := "?"
		if strings.Contains(trimmed, "?") {
			sep = "&"
		}
		return trimmed + sep + "sslmode=disable"
	}
	if strings.HasSuffix(trimmed, " ") {
		return trimmed + "sslmode=disable"
	}
	return trimmed + " sslmode=disable"
}
