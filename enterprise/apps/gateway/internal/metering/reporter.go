package metering

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

type UsageRecord struct {
	ID                       string
	TenantID                 string
	DeptID                   string
	UserID                   string
	APITokenID               int64
	Provider                 string
	Model                    string
	Route                    string
	TimeBucket               time.Time
	InputTokens              int
	OutputTokens             int
	TotalTokens              int
	CachedTokens             int
	CacheReadInputTokens     int
	CacheCreationInputTokens int
	ReasoningTokens          int
	UsageSource              string
	CostUSD                  float64
	PricingVersion           string
	TraceID                  string
	TraceStep                int
}

type Reporter struct {
	database *database.Handle
	logger   *slog.Logger
}

func NewReporter(handle *database.Handle, logger *slog.Logger) (*Reporter, error) {
	if handle == nil || handle.DB == nil {
		return nil, fmt.Errorf("metering database unavailable")
	}
	handle.DB.SetConnMaxLifetime(10 * time.Minute)
	handle.DB.SetMaxOpenConns(5)
	handle.DB.SetMaxIdleConns(2)
	pingCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if err := handle.Ping(pingCtx); err != nil {
		return nil, err
	}
	return &Reporter{database: handle, logger: logger}, nil
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
		if _, err := r.database.ExecContext(ctx, `
      insert into usage_records (
        id, tenant_id, dept_id, user_id, api_token_id, provider, model, route, time_bucket,
        input_tokens, output_tokens, total_tokens,
        cached_tokens, cache_read_input_tokens, cache_creation_input_tokens, reasoning_tokens, usage_source,
        cost_usd, pricing_version, trace_id, trace_step, created_at, updated_at
      ) values (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
			record.ID,
			tenantID,
			nullIfEmpty(record.DeptID),
			nullIfEmpty(record.UserID),
			nullInt64(record.APITokenID),
			record.Provider,
			record.Model,
			record.Route,
			record.TimeBucket.UTC(),
			record.InputTokens,
			record.OutputTokens,
			record.TotalTokens,
			record.CachedTokens,
			record.CacheReadInputTokens,
			record.CacheCreationInputTokens,
			record.ReasoningTokens,
			nullIfEmpty(record.UsageSource),
			record.CostUSD,
			nullIfEmpty(record.PricingVersion),
			nullIfEmpty(record.TraceID),
			nullTraceStep(record.TraceStep),
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

func nullInt64(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func nullTraceStep(step int) any {
	if step <= 0 {
		return nil
	}
	return step
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
