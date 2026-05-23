package server

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/audit"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/wasmhost"
)

func (s *Server) initWasmHost() {
	if wasmhost.Disabled() {
		s.logger.Info("wasm plugins disabled via GATEWAY_WASM_PLUGINS")
		return
	}
	root := wasmhost.DefaultPluginsRoot()
	var metrics wasmhost.MetricsRecorder
	if s.metrics != nil {
		metrics = s.metrics
	}
	s.wasmManager = wasmhost.NewManager(root, metrics)
	if err := s.wasmManager.Start(context.Background()); err != nil {
		s.logger.Warn("wasm plugin manager start failed", "error", err, "root", root)
	}
}

func (s *Server) newPluginHookContext(identity requestIdentity, r *http.Request, route string) *wasmhost.HookContext {
	headers := map[string]string{}
	for k, vals := range r.Header {
		if len(vals) > 0 {
			headers[k] = vals[0]
		}
	}
	return &wasmhost.HookContext{
		TenantID:   identity.TenantID,
		UserID:     identity.UserID,
		Route:      route,
		Method:     r.Method,
		ClientIP:   r.RemoteAddr,
		Headers:    headers,
		Properties: map[string]string{},
	}
}

func pluginRouteFromRequest(r *http.Request) string {
	path := strings.TrimSpace(r.URL.Path)
	if path == "" {
		return "/v1/*"
	}
	return path
}

func (s *Server) runWasmRequestHooks(w http.ResponseWriter, hookCtx *wasmhost.HookContext, body []byte) bool {
	if s.wasmManager == nil || hookCtx == nil {
		return false
	}
	if err := s.wasmManager.RunRequestHeaders(hookCtx); err != nil {
		if errors.Is(err, wasmhost.ErrStopped) {
			s.writeWasmStop(w, hookCtx)
			return true
		}
	}
	if err := s.wasmManager.RunRequestBody(hookCtx, body, true); err != nil {
		if errors.Is(err, wasmhost.ErrStopped) {
			s.writeWasmStop(w, hookCtx)
			return true
		}
	}
	return false
}

func (s *Server) writeWasmStop(w http.ResponseWriter, hookCtx *wasmhost.HookContext) {
	status := http.StatusForbidden
	if hookCtx != nil && hookCtx.StopStatus > 0 {
		status = hookCtx.StopStatus
	}
	body := []byte(`{"code":"40301","message":"request blocked by wasm plugin"}`)
	if hookCtx != nil && len(hookCtx.StopBody) > 0 {
		body = hookCtx.StopBody
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func applyPluginsInvoked(event *audit.Event, hookCtx *wasmhost.HookContext) {
	if event == nil || hookCtx == nil || len(hookCtx.Invoked) == 0 {
		return
	}
	event.PluginsInvoked = append([]string(nil), hookCtx.Invoked...)
}

func (s *Server) applyWasmResponseBody(hookCtx *wasmhost.HookContext, body []byte) []byte {
	if s.wasmManager == nil || hookCtx == nil || len(body) == 0 {
		return body
	}
	out, err := s.wasmManager.RunResponseBody(hookCtx, body, true)
	if err != nil || len(out) == 0 {
		return body
	}
	return out
}

func (s *Server) applyWasmStreamChunk(hookCtx *wasmhost.HookContext, chunk []byte) []byte {
	if s.wasmManager == nil || hookCtx == nil || len(chunk) == 0 {
		return chunk
	}
	out, err := s.wasmManager.RunStreamChunk(hookCtx, chunk)
	if err != nil || len(out) == 0 {
		return chunk
	}
	return out
}

func (s *Server) transformChatResponseJSON(hookCtx *wasmhost.HookContext, resp *openai.ChatCompletionResponse) {
	if hookCtx == nil || resp == nil || len(resp.Choices) == 0 {
		return
	}
	raw, err := json.Marshal(resp)
	if err != nil {
		return
	}
	transformed := s.applyWasmResponseBody(hookCtx, raw)
	if string(transformed) == string(raw) {
		return
	}
	var patched openai.ChatCompletionResponse
	if err := json.Unmarshal(transformed, &patched); err != nil {
		content := resp.Choices[0].Message.Content
		out := s.applyWasmResponseBody(hookCtx, []byte(content))
		resp.Choices[0].Message.Content = string(out)
		return
	}
	*resp = patched
}
