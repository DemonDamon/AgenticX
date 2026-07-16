package mcp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/quota"
	"github.com/go-chi/chi/v5"
)

// CallerIdentity is the authenticated subject for MCP proxy requests.
type CallerIdentity struct {
	TenantID     string
	UserID       string
	UserEmail    string
	DepartmentID string
	SessionID    string
	APITokenID   int64
	AuthViaPAT   bool
	ClientIP     string
}

// Handler proxies MCP streamable-HTTP traffic to registered upstream servers.
type Handler struct {
	Registry *Registry
	Quota    *quota.Tracker
	Audit    audit.EventWriter
	Logger   *slog.Logger
	Client   *http.Client
}

func NewHandler(reg *Registry, quotaTracker *quota.Tracker, auditWriter audit.EventWriter, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{
		Registry: reg,
		Quota:    quotaTracker,
		Audit:    auditWriter,
		Logger:   logger,
		Client:   &http.Client{Timeout: 10 * time.Minute},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	serverID := strings.TrimSpace(chi.URLParam(r, "server_id"))
	if serverID == "" {
		writeProxyError(w, http.StatusNotFound, "mcp:server_not_found", serverID)
		return
	}

	rec, ok := h.Registry.Get(serverID)
	if !ok || !rec.Enabled {
		writeProxyError(w, http.StatusNotFound, "mcp:server_not_found", serverID)
		return
	}
	if rec.TenantID != "" {
		id := identityFromContext(r.Context())
		if id.TenantID != "" && !strings.EqualFold(rec.TenantID, id.TenantID) {
			writeProxyError(w, http.StatusNotFound, "mcp:server_not_found", serverID)
			return
		}
	}

	upstreamBase := strings.TrimRight(strings.TrimSpace(rec.UpstreamURL), "/")
	if upstreamBase == "" {
		writeProxyError(w, http.StatusBadGateway, "mcp:upstream_unconfigured", serverID)
		return
	}

	var bodyBytes []byte
	if r.Body != nil && r.Method == http.MethodPost {
		var err error
		bodyBytes, err = PeekBody(r.Body, 4<<20)
		if err != nil {
			writeProxyError(w, http.StatusBadRequest, "mcp:bad_request", serverID)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	}
	toolName := ParseToolName(bodyBytes)

	id := identityFromContext(r.Context())
	if h.Quota != nil {
		check := h.Quota.CheckMCPToolCall(quota.RequestContext{
			TenantID:   id.TenantID,
			UserID:     id.UserID,
			DeptID:     id.DepartmentID,
			APITokenID: apiTokenIDStr(id.APITokenID),
		}, serverID, rec.ToolRateLimit)
		if !check.Allowed {
			for k, v := range check.Headers {
				w.Header().Set(k, v)
			}
			writeProxyError(w, http.StatusTooManyRequests, "mcp:rate_limited", serverID)
			h.writeAudit(id, rec, toolName, "rate_limited", started, hashText(string(bodyBytes)), "")
			return
		}
	}

	suffix := chi.URLParam(r, "*")
	target, err := url.Parse(upstreamBase)
	if err != nil {
		writeProxyError(w, http.StatusBadGateway, "mcp:upstream_invalid", serverID)
		return
	}
	if suffix != "" {
		target.Path = strings.TrimRight(target.Path, "/") + "/" + strings.TrimPrefix(suffix, "/")
	}
	if target.Path == "" {
		target.Path = "/"
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = h.Client.Transport
	if proxy.Transport == nil {
		proxy.Transport = http.DefaultTransport
	}
	origDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		origDirector(req)
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.URL.Path = target.Path
		if target.RawQuery != "" {
			req.URL.RawQuery = target.RawQuery
		} else if suffix != "" {
			if i := strings.Index(suffix, "?"); i >= 0 {
				req.URL.RawQuery = suffix[i+1:]
				req.URL.Path = strings.TrimRight(target.Path, "/") + "/" + strings.TrimPrefix(suffix[:i], "/")
			}
		}
		req.Host = target.Host
		req.Header.Del("Authorization")
		if auth := strings.TrimSpace(rec.AuthHeader); auth != "" {
			if i := strings.Index(auth, ":"); i > 0 {
				req.Header.Set(strings.TrimSpace(auth[:i]), strings.TrimSpace(auth[i+1:]))
			} else {
				req.Header.Set("Authorization", auth)
			}
		}
	}
	proxy.FlushInterval = 50 * time.Millisecond
	proxy.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, proxyErr error) {
		h.Logger.Warn("mcp upstream proxy error", "server_id", serverID, "error", proxyErr)
		writeProxyError(rw, http.StatusBadGateway, "mcp:upstream_unreachable", serverID)
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		status := "ok"
		if resp.StatusCode >= 400 {
			status = "error"
		}
		h.writeAudit(id, rec, toolName, status, started, hashText(string(bodyBytes)), strconv.Itoa(resp.StatusCode))
		return nil
	}

	proxy.ServeHTTP(w, r)
}

type ctxKey int

const identityCtxKey ctxKey = 1

func WithIdentity(ctx context.Context, id CallerIdentity) context.Context {
	return context.WithValue(ctx, identityCtxKey, id)
}

func identityFromContext(ctx context.Context) CallerIdentity {
	if v, ok := ctx.Value(identityCtxKey).(CallerIdentity); ok {
		return v
	}
	return CallerIdentity{}
}

func writeProxyError(w http.ResponseWriter, status int, message, serverID string) {
	msg := message
	if serverID != "" {
		msg = fmt.Sprintf("%s (server_id=%s)", message, serverID)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"message": msg,
			"type":    "gateway_error",
			"code":    message,
		},
	})
}

func (h *Handler) writeAudit(id CallerIdentity, rec MCPServer, toolName, status string, started time.Time, inputHash, upstreamStatus string) {
	if h.Audit == nil {
		return
	}
	ev := audit.Event{
		ID:           fmt.Sprintf("audit_%d", time.Now().UnixNano()),
		TenantID:     id.TenantID,
		EventTime:    time.Now().UTC().Format(time.RFC3339),
		EventType:    "mcp_tool_call",
		UserID:       id.UserID,
		UserEmail:    id.UserEmail,
		DepartmentID: id.DepartmentID,
		SessionID:    id.SessionID,
		ClientType:   clientTypeLabel(id),
		ClientIP:     id.ClientIP,
		Route:        "mcp-proxy",
		APITokenID:   id.APITokenID,
		LatencyMS:    time.Since(started).Milliseconds(),
		MCPServer:    rec.ID,
		MCPToolName:  toolName,
		ToolsCalled:  []string{toolName},
		MCPInputHash: inputHash,
		MCPStatus:    status,
		Digest: &audit.Digest{
			PromptHash:      inputHash,
			ResponseHash:    hashText(upstreamStatus),
			ResponseSummary: upstreamStatus,
		},
	}
	_ = h.Audit.Write(&ev)
}

func clientTypeLabel(id CallerIdentity) string {
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
