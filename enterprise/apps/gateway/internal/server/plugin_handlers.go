package server

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/channel"
	"github.com/agenticx/enterprise/gateway/internal/gwerrors"
	"github.com/agenticx/enterprise/gateway/internal/observability"
	"github.com/agenticx/enterprise/gateway/internal/openai"
	"github.com/agenticx/enterprise/gateway/internal/wasmhost"
	"github.com/go-chi/chi/v5"
)

func (s *Server) handleInternalPluginsList(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	list := []wasmhost.Manifest{}
	if s.wasmManager != nil {
		list = s.wasmManager.List()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code": "00000", "message": "ok",
		"data": map[string]any{"plugins": list, "enabled": !wasmhost.Disabled()},
	})
}

func (s *Server) handleInternalPluginsReload(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	if s.wasmManager == nil {
		writeAPIError(w, openai.BadRequest("wasm plugins disabled"))
		return
	}
	if err := s.wasmManager.Reload(); err != nil {
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": "00000", "message": "ok"})
}

func (s *Server) handleInternalPluginsUpload(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	if s.wasmManager == nil {
		writeAPIError(w, openai.BadRequest("wasm plugins disabled"))
		return
	}
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeAPIError(w, openai.BadRequest("invalid multipart form"))
		return
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		writeAPIError(w, openai.BadRequest("name is required"))
		return
	}
	root := wasmhost.DefaultPluginsRoot()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	if manifestFile, _, err := r.FormFile("manifest"); err == nil {
		defer manifestFile.Close()
		raw, _ := io.ReadAll(manifestFile)
		if len(raw) > 0 {
			_ = os.WriteFile(filepath.Join(dir, "manifest.yaml"), raw, 0o644)
		}
	}
	if wasmFile, _, err := r.FormFile("wasm"); err == nil {
		defer wasmFile.Close()
		raw, _ := io.ReadAll(wasmFile)
		if len(raw) > 0 {
			_ = os.WriteFile(filepath.Join(dir, "plugin.wasm"), raw, 0o644)
		}
	}
	if err := s.wasmManager.Reload(); err != nil {
		writeAPIError(w, openai.Internal(err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": "00000", "message": "ok", "data": map[string]any{"path": dir}})
}

func (s *Server) handleInternalErrors(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	items := []gwerrors.Record{}
	if s.errorStore != nil {
		items = s.errorStore.List(tenantID, 50)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code": "00000", "message": "ok",
		"data": map[string]any{"errors": items},
	})
}

func (s *Server) handleInternalChannelProbe(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	channelID := strings.TrimSpace(chi.URLParam(r, "id"))
	if channelID == "" {
		writeAPIError(w, openai.BadRequest("channel id required"))
		return
	}
	ch, ok := s.lookupChannel(channelID)
	if !ok {
		writeAPIError(w, openai.BadRequest("channel not found"))
		return
	}
	keys := s.channelKeysForProbe(ch)
	result := s.channelProber.Probe(r.Context(), ch, keys)
	writeJSON(w, http.StatusOK, map[string]any{"code": "00000", "message": "ok", "data": result})
}

func (s *Server) handleInternalPerf(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code": "00000", "message": "ok",
		"data": observability.PyroscopeConfigFromEnv(),
	})
}

func (s *Server) lookupChannel(id string) (channel.Channel, bool) {
	if s.channelRegistry != nil {
		return s.channelRegistry.ByID(id)
	}
	return channel.Channel{}, false
}

func (s *Server) channelKeysForProbe(ch channel.Channel) map[string]string {
	out := map[string]string{}
	if key := strings.TrimSpace(ch.APIKey); key != "" {
		out["default"] = key
	}
	poolID := ch.ID
	if pid := ch.KeyPoolID(); pid != "" {
		poolID = pid
	}
	for _, ref := range ch.KeyRefs() {
		if v := strings.TrimSpace(os.Getenv(ref)); v != "" {
			out[ref] = v
			continue
		}
		if s.keyPool != nil {
			resolved := s.keyPool.ResolveWithRef(poolID, "", []string{ref}, nil)
			if resolved.Key != "" {
				out[ref] = resolved.Key
			}
		}
	}
	return out
}

func (s *Server) recordUpstreamError(tenantID, requestID, channelID string, status int, body []byte) {
	if s.errorStore == nil {
		return
	}
	errType, message := gwerrors.ParseUpstreamError(status, body)
	s.errorStore.RecordError(tenantID, requestID, channelID, status, errType, message)
	if s.metrics != nil {
		s.metrics.RecordUpstreamError(channelID, errType)
	}
}
