package mcphost

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	policyengine "github.com/agenticx/enterprise/policy-engine"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PolicyEvaluator evaluates content policy for MCP tool inputs.
type PolicyEvaluator func(text string, ctx policyengine.EvalContext) policyengine.EvaluateResult

// Host orchestrates MCP server resolution, protocol handling, quota, audit, and backends.
type Host struct {
	registry *Registry
	logger   *slog.Logger
	quota    *quota.Tracker
	audit    audit.EventWriter
	policy   PolicyEvaluator
	backends map[string]Backend
	mu       sync.RWMutex
}

func NewHost(pool *pgxpool.Pool, logger *slog.Logger, quotaTracker *quota.Tracker, auditWriter audit.EventWriter, policy PolicyEvaluator) *Host {
	if logger == nil {
		logger = slog.Default()
	}
	h := &Host{
		registry: NewRegistry(pool, logger),
		logger:   logger,
		quota:    quotaTracker,
		audit:    auditWriter,
		policy:   policy,
		backends: map[string]Backend{
			BackendEcho:    &EchoBackend{},
			BackendOpenAPI: NewOpenAPIBackend(),
		},
	}
	return h
}

func (h *Host) ResolveServer(ctx context.Context, tenantID, name string) (*ServerRecord, error) {
	if rec, ok := builtinServer(name); ok {
		if tenantID != "" && rec.TenantID != "" && rec.TenantID != tenantID {
			return nil, fmt.Errorf("mcp:server_not_found")
		}
		return rec, nil
	}
	return h.registry.GetByName(ctx, tenantID, name)
}

func (h *Host) ListRegistry(ctx context.Context, identity Identity) ([]RegistryEntry, error) {
	entries, err := h.registry.ListActive(ctx, identity.TenantID)
	if err != nil {
		return nil, err
	}
	out := make([]RegistryEntry, 0)
	hasDemo := false
	for _, rec := range entries {
		if rec.Name == "demo" {
			hasDemo = true
		}
		if !CanListTools(identity.Scopes, rec.Name, rec.RequiredScopes) {
			continue
		}
		out = append(out, registryEntryFromRecord(rec))
	}
	if !hasDemo && CanListTools(identity.Scopes, "demo", nil) {
		if demo, ok := builtinServer("demo"); ok {
			out = append([]RegistryEntry{registryEntryFromRecord(demo)}, out...)
		}
	}
	return out, nil
}

func registryEntryFromRecord(rec *ServerRecord) RegistryEntry {
	return RegistryEntry{
		Name:        rec.Name,
		DisplayName: rec.DisplayName,
		Transport:   rec.Transport,
		BackendType: rec.BackendType,
		Endpoints: map[string]string{
			"streamable-http": "/mcp/" + rec.Name + "/streamable-http",
			"sse":             "/mcp/" + rec.Name + "/sse",
			"messages":        "/mcp/" + rec.Name + "/messages",
		},
	}
}

type RegistryEntry struct {
	Name        string            `json:"name"`
	DisplayName string            `json:"display_name,omitempty"`
	Transport   string            `json:"transport"`
	BackendType string            `json:"backend_type"`
	Endpoints   map[string]string `json:"endpoints"`
}

func (h *Host) listTools(ctx context.Context, rec *ServerRecord) ([]Tool, error) {
	backend, err := h.backendFor(rec)
	if err != nil {
		return nil, err
	}
	return backend.ListTools(ctx, rec)
}

func (h *Host) toolMetadata(rec *ServerRecord, toolName string) map[string]any {
	for _, t := range rec.Tools {
		if t.Name == toolName {
			return t.Metadata
		}
	}
	return nil
}

func (h *Host) invokeTool(ctx context.Context, rec *ServerRecord, identity Identity, name string, args map[string]any) (CallResult, string, error) {
	started := time.Now()
	if args == nil {
		args = map[string]any{}
	}
	if h.quota != nil {
		check := h.quota.CheckMCPToolCall(quota.RequestContext{
			TenantID:   identity.TenantID,
			UserID:     identity.UserID,
			DeptID:     identity.DepartmentID,
			APITokenID: apiTokenIDStr(identity.APITokenID),
		}, rec.Name, rec.ToolCallsPerMin)
		if !check.Allowed {
			h.writeToolAudit(identity, rec, name, args, CallResult{}, "rate_limited", started)
			return CallResult{}, "rate_limited", fmt.Errorf("mcp:rate_limited")
		}
	}
	if h.policy != nil {
		raw, _ := json.Marshal(args)
		pol := h.policy(string(raw), policyengine.EvalContext{
			TenantID:   identity.TenantID,
			UserID:     identity.UserID,
			DeptIDs:    []string{identity.DepartmentID},
			ClientType: "mcp",
			Stage:      "mcp_tool",
		})
		if pol.Blocked {
			h.writeToolAudit(identity, rec, name, args, textResult("policy blocked", true), "blocked", started)
			return CallResult{}, "blocked", fmt.Errorf("policy:blocked")
		}
	}
	backend, err := h.backendFor(rec)
	if err != nil {
		return CallResult{}, "error", err
	}
	result, err := backend.CallTool(ctx, rec, name, args)
	status := "ok"
	if err != nil {
		status = "error"
		h.writeToolAudit(identity, rec, name, args, result, status, started)
		return result, status, err
	}
	if result.IsError {
		status = "error"
	}
	h.writeToolAudit(identity, rec, name, args, result, status, started)
	return result, status, nil
}

func (h *Host) backendFor(rec *ServerRecord) (Backend, error) {
	h.mu.RLock()
	b, ok := h.backends[rec.BackendType]
	h.mu.RUnlock()
	if ok {
		return b, nil
	}
	return NewBackend(rec.BackendType)
}

func (h *Host) writeToolAudit(identity Identity, rec *ServerRecord, toolName string, args map[string]any, result CallResult, status string, started time.Time) {
	if h.audit == nil {
		return
	}
	inRaw, _ := json.Marshal(args)
	outText := ""
	if len(result.Content) > 0 {
		outText = result.Content[0].Text
	}
	ev := audit.Event{
		ID:           fmt.Sprintf("audit_%d", time.Now().UnixNano()),
		TenantID:     identity.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    "mcp_tool_call",
		UserID:       identity.UserID,
		UserEmail:    identity.UserEmail,
		DepartmentID: identity.DepartmentID,
		ClientType:   clientTypeLabel(identity),
		ClientIP:     identity.ClientIP,
		Route:        "mcp",
		APITokenID:   identity.APITokenID,
		LatencyMS:    time.Since(started).Milliseconds(),
		MCPServer:    rec.Name,
		MCPToolName:  toolName,
		MCPInputHash: hashText(string(inRaw)),
		MCPOutputHash: hashText(outText),
		MCPStatus:    status,
		Digest: &audit.Digest{
			PromptHash:      hashText(string(inRaw)),
			ResponseHash:    hashText(outText),
			PromptSummary:   summarize(string(inRaw), 120),
			ResponseSummary: summarize(outText, 120),
		},
	}
	_ = h.audit.Write(&ev)
}

func clientTypeLabel(id Identity) string {
	if id.AuthViaPAT {
		return "api-token"
	}
	return "web-portal"
}

func apiTokenIDStr(id int64) string {
	if id <= 0 {
		return ""
	}
	return strconv.FormatInt(id, 10)
}

func hashText(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:16])
}

func summarize(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func builtinServer(name string) (*ServerRecord, bool) {
	if strings.TrimSpace(name) != "demo" {
		return nil, false
	}
	return &ServerRecord{
		Name:            "demo",
		DisplayName:     "Demo Echo Server",
		Transport:       "streamable-http",
		BackendType:     BackendEcho,
		Status:          "active",
		ToolCallsPerMin: defaultToolCallsPerMinute(),
		Builtin:         true,
	}, true
}

func defaultToolCallsPerMinute() int {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_MCP_TOOL_CALLS_PER_MINUTE"))
	if raw == "" {
		return 60
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 60
	}
	return n
}

func HostingEnabled() bool {
	v := strings.TrimSpace(os.Getenv("GATEWAY_MCP_HOSTING"))
	return strings.EqualFold(v, "on") || strings.EqualFold(v, "1") || strings.EqualFold(v, "true")
}
