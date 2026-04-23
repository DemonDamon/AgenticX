package metering

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

type UsageRecord struct {
	ID           string
	TenantID     string
	DeptID       string
	UserID       string
	Provider     string
	Model        string
	Route        string
	TimeBucket   time.Time
	InputTokens  int
	OutputTokens int
	TotalTokens  int
	CostUSD      float64
}

type Reporter struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewReporter(connectionString string, logger *slog.Logger) (*Reporter, error) {
	db, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}
	db.SetConnMaxLifetime(10 * time.Minute)
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	return &Reporter{db: db, logger: logger}, nil
}

func (r *Reporter) ReportAsync(record UsageRecord) {
	go func() {
		tenantID, ok := normalizeTenantID(record.TenantID)
		if !ok {
			r.logger.Warn("skip usage report: invalid tenant_id", "tenant_id", record.TenantID, "user_id", record.UserID)
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, err := r.db.ExecContext(ctx, `
      insert into usage_records (
        id, tenant_id, dept_id, user_id, provider, model, route, time_bucket,
        input_tokens, output_tokens, total_tokens, cost_usd, created_at, updated_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now()
      )
    `,
			record.ID,
			tenantID,
			nullIfEmpty(record.DeptID),
			nullIfEmpty(record.UserID),
			record.Provider,
			record.Model,
			record.Route,
			record.TimeBucket.UTC(),
			record.InputTokens,
			record.OutputTokens,
			record.TotalTokens,
			record.CostUSD,
		); err != nil {
			r.logger.Error("usage report write failed", "error", err)
		}
	}()
}

func nullIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func normalizeTenantID(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) == 26 {
		return trimmed, true
	}
	return "", false
}
