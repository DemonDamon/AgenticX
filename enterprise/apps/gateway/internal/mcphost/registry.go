package mcphost

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// Registry loads MCP server definitions from the configured database.
type Registry struct {
	database *database.Handle
	logger   *slog.Logger
}

func NewRegistry(handle *database.Handle, logger *slog.Logger) *Registry {
	return &Registry{database: handle, logger: logger}
}

func (r *Registry) GetByName(ctx context.Context, tenantID, name string) (*ServerRecord, error) {
	if r.database == nil {
		return nil, fmt.Errorf("mcp:server_not_found")
	}
	tenantID = strings.TrimSpace(tenantID)
	name = strings.TrimSpace(name)
	var (
		id, displayName, transport, backendType, status string
		backendConfig                                   []byte
		requiredScopesRaw                               []byte
		rateLimit                                       []byte
	)
	row, err := r.database.QueryRowContext(ctx, `
SELECT id, COALESCE(display_name,''), transport, backend_type, backend_config, required_scopes, status, rate_limit
FROM mcp_servers
WHERE tenant_id = ? AND name = ? AND status = 'active'
LIMIT 1`, tenantID, name)
	if err != nil {
		return nil, fmt.Errorf("mcp:server_not_found")
	}
	if err := row.Scan(&id, &displayName, &transport, &backendType, &backendConfig, &requiredScopesRaw, &status, &rateLimit); err != nil {
		return nil, fmt.Errorf("mcp:server_not_found")
	}
	rec := &ServerRecord{
		ID:              id,
		TenantID:        tenantID,
		Name:            name,
		DisplayName:     displayName,
		Transport:       transport,
		BackendType:     backendType,
		BackendConfig:   decodeJSONMap(backendConfig),
		RequiredScopes:  decodeScopes(requiredScopesRaw),
		Status:          status,
		ToolCallsPerMin: toolCallsPerMinuteFromRateLimit(rateLimit),
	}
	tools, err := r.loadTools(ctx, id)
	if err != nil {
		return nil, err
	}
	rec.Tools = tools
	return rec, nil
}

func (r *Registry) ListActive(ctx context.Context, tenantID string) ([]*ServerRecord, error) {
	if r.database == nil {
		return nil, nil
	}
	rows, err := r.database.QueryContext(ctx, `
SELECT id, name, COALESCE(display_name,''), transport, backend_type, backend_config, required_scopes, status, rate_limit
FROM mcp_servers
WHERE tenant_id = ? AND status = 'active'
ORDER BY name ASC`, strings.TrimSpace(tenantID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ServerRecord
	for rows.Next() {
		var (
			id, name, displayName, transport, backendType, status string
			backendConfig                                         []byte
			requiredScopesRaw                                     []byte
			rateLimit                                             []byte
		)
		if err := rows.Scan(&id, &name, &displayName, &transport, &backendType, &backendConfig, &requiredScopesRaw, &status, &rateLimit); err != nil {
			return nil, err
		}
		rec := &ServerRecord{
			ID:              id,
			TenantID:        tenantID,
			Name:            name,
			DisplayName:     displayName,
			Transport:       transport,
			BackendType:     backendType,
			BackendConfig:   decodeJSONMap(backendConfig),
			RequiredScopes:  decodeScopes(requiredScopesRaw),
			Status:          status,
			ToolCallsPerMin: toolCallsPerMinuteFromRateLimit(rateLimit),
		}
		tools, err := r.loadTools(ctx, id)
		if err != nil {
			return nil, err
		}
		rec.Tools = tools
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (r *Registry) loadTools(ctx context.Context, serverID string) ([]Tool, error) {
	rows, err := r.database.QueryContext(ctx, `
SELECT tool_name, COALESCE(description,''), input_schema, output_schema, enabled, metadata, source_operation_id
FROM mcp_tools
WHERE server_id = ? AND enabled = true
ORDER BY tool_name ASC`, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tools []Tool
	for rows.Next() {
		var (
			name, desc, sourceOp string
			inputSchema          []byte
			outputSchema         []byte
			enabled              bool
			metadata             []byte
		)
		if err := rows.Scan(&name, &desc, &inputSchema, &outputSchema, &enabled, &metadata, &sourceOp); err != nil {
			return nil, err
		}
		t := Tool{
			Name:        name,
			Description: desc,
			InputSchema: inputSchema,
			Enabled:     enabled,
			Metadata:    decodeJSONMap(metadata),
		}
		if len(outputSchema) > 0 {
			t.OutputSchema = outputSchema
		}
		tools = append(tools, t)
	}
	return tools, rows.Err()
}

func decodeJSONMap(raw []byte) map[string]any {
	if len(raw) == 0 {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

func decodeScopes(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var scopes []string
	if err := json.Unmarshal(raw, &scopes); err == nil {
		return scopes
	}
	// PostgreSQL text[] may arrive as {a,b} when driven via lib adapters; keep best-effort parse.
	s := strings.TrimSpace(string(raw))
	s = strings.TrimPrefix(s, "{")
	s = strings.TrimSuffix(s, "}")
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.Trim(strings.TrimSpace(part), `"`)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func toolCallsPerMinuteFromRateLimit(raw []byte) int {
	cfg := decodeJSONMap(raw)
	if v, ok := cfg["tool_calls_per_minute"].(float64); ok && v > 0 {
		return int(v)
	}
	return defaultToolCallsPerMinute()
}
