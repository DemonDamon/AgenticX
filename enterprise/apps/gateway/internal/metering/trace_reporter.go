package metering

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
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
	database *database.Handle
	logger   *slog.Logger
}

func NewTraceReporter(handle *database.Handle, logger *slog.Logger) (*TraceReporter, error) {
	if handle == nil || handle.DB == nil {
		return nil, fmt.Errorf("trace database unavailable")
	}
	handle.DB.SetConnMaxLifetime(10 * time.Minute)
	handle.DB.SetMaxOpenConns(5)
	handle.DB.SetMaxIdleConns(2)
	pingCtx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	if err := handle.Ping(pingCtx); err != nil {
		return nil, err
	}
	return &TraceReporter{database: handle, logger: logger}, nil
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
		upsert := `
      on conflict (tenant_id, trace_id, step_no) do update set
        step_kind = excluded.step_kind, status = excluded.status, model = excluded.model,
        provider = excluded.provider, input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens, reasoning_tokens = excluded.reasoning_tokens,
        total_tokens = excluded.total_tokens, cost_usd = excluded.cost_usd,
        duration_ms = excluded.duration_ms, error_message = excluded.error_message,
        metadata = excluded.metadata, updated_at = CURRENT_TIMESTAMP`
		valuesAlias := ""
		if r.database.Dialect == database.MySQL {
			valuesAlias = " AS new"
			upsert = `
      on duplicate key update
        step_kind = new.step_kind, status = new.status, model = new.model,
        provider = new.provider, input_tokens = new.input_tokens,
        output_tokens = new.output_tokens, reasoning_tokens = new.reasoning_tokens,
        total_tokens = new.total_tokens, cost_usd = new.cost_usd,
        duration_ms = new.duration_ms, error_message = new.error_message,
        metadata = new.metadata, updated_at = CURRENT_TIMESTAMP`
		}
		query := `
      insert into agent_token_traces (
        id, tenant_id, trace_id, step_no, step_kind, status,
        model, provider, input_tokens, output_tokens, reasoning_tokens, total_tokens,
        cost_usd, duration_ms, error_message, metadata, created_at, updated_at
      ) values (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )` + valuesAlias + upsert
		if _, err := r.database.ExecContext(ctx, query,
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
