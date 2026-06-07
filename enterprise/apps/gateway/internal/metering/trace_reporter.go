package metering

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

type TraceSpanRecord struct {
	ID              string
	TenantID        string
	TraceID         string
	StepNo          int
	StepKind        string
	Status          string
	Model           string
	Provider        string
	InputTokens     int
	OutputTokens    int
	ReasoningTokens int
	TotalTokens     int
	CostUSD         float64
	DurationMS      int
	ErrorMessage    string
	Metadata        map[string]any
}

type TraceReporter struct {
	db     *sql.DB
	logger *slog.Logger
}

func NewTraceReporter(connectionString string, logger *slog.Logger) (*TraceReporter, error) {
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
	return &TraceReporter{db: db, logger: logger}, nil
}

func (r *TraceReporter) ReportAsync(record TraceSpanRecord) {
	go func() {
		tenantID, ok := normalizeTenantID(record.TenantID)
		if !ok || strings.TrimSpace(record.TraceID) == "" || record.StepNo <= 0 {
			return
		}
		meta := record.Metadata
		if meta == nil {
			meta = map[string]any{}
		}
		metaJSON, err := json.Marshal(meta)
		if err != nil {
			metaJSON = []byte("{}")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, err := r.db.ExecContext(ctx, `
      insert into agent_token_traces (
        id, tenant_id, trace_id, step_no, step_kind, status,
        model, provider, input_tokens, output_tokens, reasoning_tokens, total_tokens,
        cost_usd, duration_ms, error_message, metadata, created_at, updated_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now(), now()
      )
      on conflict (tenant_id, trace_id, step_no) do update set
        step_kind = excluded.step_kind,
        status = excluded.status,
        model = excluded.model,
        provider = excluded.provider,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        total_tokens = excluded.total_tokens,
        cost_usd = excluded.cost_usd,
        duration_ms = excluded.duration_ms,
        error_message = excluded.error_message,
        metadata = excluded.metadata,
        updated_at = now()
    `,
			record.ID,
			tenantID,
			record.TraceID,
			record.StepNo,
			defaultString(record.StepKind, "model"),
			defaultString(record.Status, "ok"),
			nullIfEmpty(record.Model),
			nullIfEmpty(record.Provider),
			record.InputTokens,
			record.OutputTokens,
			record.ReasoningTokens,
			record.TotalTokens,
			record.CostUSD,
			record.DurationMS,
			nullIfEmpty(record.ErrorMessage),
			metaJSON,
		); err != nil {
			r.logger.Error("trace span write failed", "error", err, "trace_id", record.TraceID, "step", record.StepNo)
		}
	}()
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
