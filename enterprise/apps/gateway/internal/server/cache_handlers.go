package server

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/openai"
)

func (s *Server) handleCacheConfigReload(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	path := cacheConfigPath()
	adminCfg, err := cache.LoadAdminConfig(path)
	if err != nil {
		writeAPIError(w, openai.BadRequest(err.Error()))
		return
	}
	if s.cacheService != nil {
		s.cacheService.UpdateConfig(adminCfg.Apply(s.cacheService.Config()))
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": "00000", "message": "ok"})
}

func (s *Server) handleCacheEvict(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeAPIError(w, openai.Unauthorized("unauthorized"))
		return
	}
	var body struct {
		Prefix string `json:"prefix"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeAPIError(w, openai.BadRequest("invalid body"))
		return
	}
	removed := 0
	if s.cacheService != nil {
		removed = s.cacheService.EvictPrefix(strings.TrimSpace(body.Prefix))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"code":    "00000",
		"message": "ok",
		"data":    map[string]any{"removed": removed},
	})
}

func cacheConfigPath() string {
	path := strings.TrimSpace(os.Getenv("GATEWAY_CACHE_CONFIG_FILE"))
	if path != "" {
		return path
	}
	return "../../.runtime/admin/cache-config.json"
}
