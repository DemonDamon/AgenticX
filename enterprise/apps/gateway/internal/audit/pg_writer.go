package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// PgWriter inserts events into gateway_audit_events without recomputing checksums.
type PgWriter struct {
	database *database.Handle
}

func NewPgWriter(handle *database.Handle) *PgWriter {
	return &PgWriter{database: handle}
}

// Insert copies the event as stored in JSONL (checksum chain already set by FileWriter).
func (p *PgWriter) Insert(ctx context.Context, e Event) error {
	if p == nil || p.database == nil {
		return fmt.Errorf("audit database writer: nil handle")
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

	conflictClause := "ON CONFLICT (id) DO NOTHING"
	if p.database.Dialect == database.MySQL {
		conflictClause = "ON DUPLICATE KEY UPDATE id = id"
	}
	query := `
INSERT INTO gateway_audit_events (
  id, tenant_id, event_time, event_type,
  user_id, user_email, department_id, session_id,
  client_type, client_ip, provider, model, route,
  channel_id, channel_key_ref, api_token_id,
  input_tokens, output_tokens, total_tokens, latency_ms,
  digest, policies_hit, tools_called,
  mcp_server, mcp_tool_name, mcp_input_hash, mcp_output_hash, mcp_status,
  src_region, dst_region, cross_border, residency_rule,
  prev_checksum, checksum, signature,
  created_at, updated_at
) VALUES (
  ?,?,?,?,
  ?,?,?,?,
  ?,?,?,?,?,
  ?,?,?,
  ?,?,?,?,
  ?,?,?,
  ?,?,?,?,?,
  ?,?,?,?,
  ?,?,?,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
` + conflictClause
	_, err = p.database.ExecContext(ctx, query,
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
		nullStr(e.ChannelID),
		nullStr(e.ChannelKeyRef),
		nullInt64(e.APITokenID),
		e.InputTokens,
		e.OutputTokens,
		e.TotalTokens,
		e.LatencyMS,
		nullJSON(digest),
		nullJSON(policies),
		nil, // tools_called
		nullStr(e.MCPServer),
		nullStr(e.MCPToolName),
		nullStr(e.MCPInputHash),
		nullStr(e.MCPOutputHash),
		nullStr(e.MCPStatus),
		nullStr(e.SrcRegion),
		nullStr(e.DstRegion),
		nullBool(e.CrossBorder),
		nullStr(e.ResidencyRule),
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

func nullInt64(v int64) any {
	if v <= 0 {
		return nil
	}
	return v
}

func nullBool(v bool) any {
	if !v {
		return nil
	}
	return v
}
