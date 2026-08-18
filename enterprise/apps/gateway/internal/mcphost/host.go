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
	"github.com/agenticx/enterprise/gateway/internal/database"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	policyengine "github.com/agenticx/enterprise/policy-engine"
)

// PolicyEvaluator evaluates content policy for MCP tool inputs.
type PolicyEvaluator func(text string, ctx policyengine.EvalContext) policyengine.EvaluateResult

// Host orchestrates MCP server resolution, protocol handling, quota, audit, and backends.
type Host struct {
	registry    *Registry
	entitlement *EntitlementChecker
	logger      *slog.Logger
	quota       *quota.Tracker
	audit       audit.EventWriter
	policy      PolicyEvaluator
	backends    map[string]Backend
	mu          sync.RWMutex
}

func NewHost(handle *database.Handle, logger *slog.Logger, quotaTracker *quota.Tracker, auditWriter audit.EventWriter, policy PolicyEvaluator) *Host {
	if logger == nil {
		logger = slog.Default()
	}
	h := &Host{
		registry:    NewRegistry(handle, logger),
		entitlement: NewEntitlementChecker(handle, logger),
		logger:      logger,
		quota:       quotaTracker,
		audit:       auditWriter,
		policy:      policy,
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

// EffectiveScopes resolves what the caller may do with this server, taking the
// capability pack into account, and rejects a caller whose entitlement has been
// revoked. Servers no pack references keep their previous behaviour.
//
// 这是撤销真正生效的地方。桌面端在同步时也会删掉本地条目，但那只挡得住正常使用
// 的人：被撤销的客户端手上握着上次拿到的 token 和地址，照样能直接打过来。
//
// 反过来，包分配本身就是授权：企业把包发给你，就等于管理员批了这台服务器，所以
// 命中分配时补上这台（且仅这台）的读写 scope。否则桌面端的 PAT 只有
// workspace:chat / desktop:managed，管理员在后台分配完，员工那边照样调不动。
func (h *Host) EffectiveScopes(ctx context.Context, identity Identity, rec *ServerRecord) ([]string, error) {
	if h.entitlement == nil {
		return identity.Scopes, nil
	}
	decision, err := h.entitlement.Check(ctx, identity, rec)
	if err != nil {
		h.logger.Warn("mcp entitlement check failed; denying",
			"server", rec.Name, "user", identity.UserID, "error", err)
		return nil, ErrCapabilityRevoked
	}
	if revoked(decision) {
		return nil, ErrCapabilityRevoked
	}
	if !decision.Governed {
		return identity.Scopes, nil
	}
	return grantServerScopes(identity.Scopes, rec.Name), nil
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
		// 先算生效 scope 再判可见性：被撤销的要从列表里消失，而不是列出来再在
		// 调用时报错——列出来就等于告诉员工「你还有这个能力」，然后在他用的时候
		// 才失败。
		scopes, err := h.EffectiveScopes(ctx, identity, rec)
		if err != nil {
			continue
		}
		if !CanListTools(scopes, rec.Name, rec.RequiredScopes) {
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
		ID:            fmt.Sprintf("audit_%d", time.Now().UnixNano()),
		TenantID:      identity.TenantID,
		EventTime:     time.Now().UTC().Format(time.RFC3339),
		EventType:     "mcp_tool_call",
		UserID:        identity.UserID,
		UserEmail:     identity.UserEmail,
		DepartmentID:  identity.DepartmentID,
		ClientType:    clientTypeLabel(identity),
		ClientIP:      identity.ClientIP,
		Route:         "mcp",
		APITokenID:    identity.APITokenID,
		LatencyMS:     time.Since(started).Milliseconds(),
		MCPServer:     rec.Name,
		MCPToolName:   toolName,
		ToolsCalled:   []string{toolName},
		MCPInputHash:  hashText(string(inRaw)),
		MCPOutputHash: hashText(outText),
		MCPStatus:     status,
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
