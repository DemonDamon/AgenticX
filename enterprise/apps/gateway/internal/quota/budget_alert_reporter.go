package quota

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// BudgetAlertReporter persists budget alerts to the configured database (best-effort).
type BudgetAlertReporter struct {
	database *database.Handle
	logger   *slog.Logger
}

func NewBudgetAlertReporter(handle *database.Handle, logger *slog.Logger) (*BudgetAlertReporter, error) {
	if handle == nil || handle.DB == nil {
		return nil, fmt.Errorf("budget alert database unavailable")
	}
	handle.DB.SetConnMaxLifetime(10 * time.Minute)
	handle.DB.SetMaxOpenConns(3)
	pingCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if err := handle.Ping(pingCtx); err != nil {
		return nil, err
	}
	return &BudgetAlertReporter{database: handle, logger: logger}, nil
}

func (r *BudgetAlertReporter) Emit(record BudgetAlertRecord) {
	if r == nil || r.database == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, err := r.database.ExecContext(ctx, `
      insert into gateway_budget_alerts (
        id, tenant_id, dept_id, user_id, dimension, dimension_key, period, unit,
        alert_type, used_value, limit_value, warn_threshold_pct, description, created_at
      ) values (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?
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
