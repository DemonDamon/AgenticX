package metering

import (
	"context"
	"database/sql"
	"log/slog"
	"net/url"
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
	// 本地 docker postgres 默认未启用 SSL，但 lib/pq 默认会要求 SSL，
	// 导致 ping 失败 → 回落 file sink → admin 计量长期查到空集。
	// 这里在用户未显式指定 sslmode 时补 disable，保留显式配置的优先级。
	connectionString = ensureSSLMode(connectionString)
	db, err := sql.Open("postgres", connectionString)
	if err != nil {
		return nil, err
	}
	db.SetConnMaxLifetime(10 * time.Minute)
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	pingCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, err
	}
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
	// enterprise dev/runtime 既有 ULID(26) 也有 tenant_default 这类逻辑租户 ID。
	// 计量写入只要求非空，避免把合法会话流量静默丢弃。
	if trimmed != "" {
		return trimmed, true
	}
	return "", false
}

// ensureSSLMode 在未显式提供 sslmode 时补 disable，仅作用于本地无 SSL 的 dev postgres。
// 同时支持 URL 形式（postgres://...）与 KV 形式（host=... user=...）。
func ensureSSLMode(connectionString string) string {
	trimmed := strings.TrimSpace(connectionString)
	if trimmed == "" {
		return trimmed
	}
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "postgres://") || strings.HasPrefix(lower, "postgresql://") {
		parsed, err := url.Parse(trimmed)
		if err != nil {
			return trimmed
		}
		query := parsed.Query()
		if query.Get("sslmode") != "" {
			return trimmed
		}
		query.Set("sslmode", "disable")
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	if strings.Contains(lower, "sslmode=") {
		return trimmed
	}
	if strings.HasSuffix(trimmed, " ") {
		return trimmed + "sslmode=disable"
	}
	return trimmed + " sslmode=disable"
}
