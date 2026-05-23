package mcphost

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Registry loads MCP server definitions from Postgres.
type Registry struct {
	pool   *pgxpool.Pool
	logger *slog.Logger
}

func NewRegistry(pool *pgxpool.Pool, logger *slog.Logger) *Registry {
	return &Registry{pool: pool, logger: logger}
}

func (r *Registry) GetByName(ctx context.Context, tenantID, name string) (*ServerRecord, error) {
	if r.pool == nil {
		return nil, fmt.Errorf("mcp:server_not_found")
	}
	tenantID = strings.TrimSpace(tenantID)
	name = strings.TrimSpace(name)
	var (
		id, displayName, transport, backendType, status string
		backendConfig                                   []byte
		requiredScopes                                  []string
		rateLimit                                       []byte
	)
	err := r.pool.QueryRow(ctx, `
SELECT id, COALESCE(display_name,''), transport, backend_type, backend_config, required_scopes, status, rate_limit
FROM mcp_servers
WHERE tenant_id = $1 AND name = $2 AND status = 'active'
LIMIT 1`, tenantID, name).Scan(&id, &displayName, &transport, &backendType, &backendConfig, &requiredScopes, &status, &rateLimit)
	if err != nil {
		return nil, fmt.Errorf("mcp:server_not_found")
	}
	rec := &ServerRecord{
		ID:             id,
		TenantID:       tenantID,
		Name:           name,
		DisplayName:    displayName,
		Transport:      transport,
		BackendType:    backendType,
		BackendConfig:  decodeJSONMap(backendConfig),
		RequiredScopes: requiredScopes,
		Status:         status,
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
	if r.pool == nil {
		return nil, nil
	}
	rows, err := r.pool.Query(ctx, `
SELECT id, name, COALESCE(display_name,''), transport, backend_type, backend_config, required_scopes, status, rate_limit
FROM mcp_servers
WHERE tenant_id = $1 AND status = 'active'
ORDER BY name ASC`, strings.TrimSpace(tenantID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*ServerRecord
	for rows.Next() {
		var (
			id, name, displayName, transport, backendType, status string
			backendConfig                                           []byte
			requiredScopes                                          []string
			rateLimit                                               []byte
		)
		if err := rows.Scan(&id, &name, &displayName, &transport, &backendType, &backendConfig, &requiredScopes, &status, &rateLimit); err != nil {
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
			RequiredScopes:  requiredScopes,
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
	rows, err := r.pool.Query(ctx, `
SELECT tool_name, COALESCE(description,''), input_schema, output_schema, enabled, metadata, source_operation_id
FROM mcp_tools
WHERE server_id = $1 AND enabled = true
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

func toolCallsPerMinuteFromRateLimit(raw []byte) int {
	cfg := decodeJSONMap(raw)
	if v, ok := cfg["tool_calls_per_minute"].(float64); ok && v > 0 {
		return int(v)
	}
	return defaultToolCallsPerMinute()
}
