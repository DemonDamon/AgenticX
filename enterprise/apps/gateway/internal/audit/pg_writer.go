package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PgWriter inserts events into gateway_audit_events without recomputing checksums.
type PgWriter struct {
	pool *pgxpool.Pool
}

func NewPgWriter(pool *pgxpool.Pool) *PgWriter {
	return &PgWriter{pool: pool}
}

// Insert copies the event as stored in JSONL (checksum chain already set by FileWriter).
func (p *PgWriter) Insert(ctx context.Context, e Event) error {
	if p == nil || p.pool == nil {
		return fmt.Errorf("pg writer: nil pool")
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(e.EventTime))
	if err != nil {
		return fmt.Errorf("parse event_time: %w", err)
	}

	var digest []byte
	if e.Digest != nil {
		digest, err = json.Marshal(e.Digest)
		if err != nil {
			return fmt.Errorf("marshal digest: %w", err)
		}
	}

	var policies []byte
	if len(e.PoliciesHit) > 0 {
		policies, err = json.Marshal(e.PoliciesHit)
		if err != nil {
			return fmt.Errorf("marshal policies_hit: %w", err)
		}
	}

	nullStr := func(s string) any {
		s = strings.TrimSpace(s)
		if s == "" {
			return nil
		}
		return s
	}

	ct := strings.TrimSpace(e.ClientType)
	if ct == "" {
		ct = "web-portal"
	}

	_, err = p.pool.Exec(ctx, `
INSERT INTO gateway_audit_events (
  id, tenant_id, event_time, event_type,
  user_id, user_email, department_id, session_id,
  client_type, client_ip, provider, model, route,
  input_tokens, output_tokens, total_tokens, latency_ms,
  digest, policies_hit, tools_called,
  prev_checksum, checksum, signature,
  created_at, updated_at
) VALUES (
  $1,$2,$3,$4,
  $5,$6,$7,$8,
  $9,$10,$11,$12,$13,
  $14,$15,$16,$17,
  $18,$19,$20,
  $21,$22,$23,
  timezone('utc', now()), timezone('utc', now())
)
ON CONFLICT (id) DO NOTHING`,
		strings.TrimSpace(e.ID),
		strings.TrimSpace(e.TenantID),
		t,
		strings.TrimSpace(e.EventType),
		nullStr(e.UserID),
		nullStr(e.UserEmail),
		nullStr(e.DepartmentID),
		nullStr(e.SessionID),
		ct,
		nullStr(e.ClientIP),
		nullStr(e.Provider),
		nullStr(e.Model),
		strings.TrimSpace(e.Route),
		e.InputTokens,
		e.OutputTokens,
		e.TotalTokens,
		e.LatencyMS,
		nullJSON(digest),
		nullJSON(policies),
		nil, // tools_called
		strings.TrimSpace(e.PrevChecksum),
		strings.TrimSpace(e.Checksum),
		nil, // signature
	)
	if err != nil {
		return fmt.Errorf("insert gateway_audit_events: %w", err)
	}
	return nil
}

func nullJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
