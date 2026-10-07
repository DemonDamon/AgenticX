// connector_handlers.go 连接器网关管理面（admin-console 经 GATEWAY_INTERNAL_TOKEN 调用）：
// OpenAPI 导入、定义/连接生命周期。导入复用 connectorstore 的 Go 管线
// （映射/校验/destructive 确认单源），避免 TS 侧重复实现。
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/connectorstore"
	"github.com/go-chi/chi/v5"
)

func (s *Server) registerConnectorRoutes(r chi.Router) {
	if s.connectorStore == nil {
		return
	}
	r.Get("/internal/connectors", s.handleConnectorList)
	r.Post("/internal/connectors/import", s.handleConnectorImport)
	r.Delete("/internal/connectors/{connectorId}", s.handleConnectorDelete)
	r.Get("/internal/connectors/{connectorId}/connections", s.handleConnectionList)
	r.Post("/internal/connectors/{connectorId}/connections", s.handleConnectionCreate)
	r.Post("/internal/connectors/{connectorId}/connections/{connectionId}/rotate", s.handleConnectionRotate)
	r.Post("/internal/connectors/{connectorId}/connections/{connectionId}/revoke", s.handleConnectionRevoke)
}

func (s *Server) handleConnectorList(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeConnectorUnauthorized(w)
		return
	}
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	if tenantID == "" {
		writeConnectorError(w, http.StatusBadRequest, "40000", "tenant_id is required")
		return
	}
	defs, err := s.connectorStore.ListDefinitions(r.Context(), tenantID)
	if err != nil {
		writeConnectorError(w, http.StatusInternalServerError, "50000", err.Error())
		return
	}
	out := make([]map[string]any, 0, len(defs))
	for _, d := range defs {
		out = append(out, map[string]any{
			"id":          d.ID,
			"displayName": d.DisplayName,
			"description": d.Description,
			"authType":    string(d.Auth.Type),
			"actionCount": len(d.Actions),
		})
	}
	writeConnectorOK(w, map[string]any{"connectors": out})
}

type connectorImportRequest struct {
	TenantID           string          `json:"tenant_id"`
	ConnectorID        string          `json:"connector_id"`
	DisplayName        string          `json:"display_name"`
	BaseURL            string          `json:"base_url"`
	Spec               json.RawMessage `json:"spec"` // OpenAPI 文档（JSON 对象）
	ConfirmDestructive bool            `json:"confirm_destructive"`
}

func (s *Server) handleConnectorImport(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeConnectorUnauthorized(w)
		return
	}
	var req connectorImportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeConnectorError(w, http.StatusBadRequest, "40000", "invalid body")
		return
	}
	req.TenantID = strings.TrimSpace(req.TenantID)
	req.ConnectorID = strings.TrimSpace(req.ConnectorID)
	if req.TenantID == "" || req.ConnectorID == "" || len(req.Spec) == 0 {
		writeConnectorError(w, http.StatusBadRequest, "40000", "tenant_id, connector_id and spec are required")
		return
	}
	res, err := connectorstore.ImportOpenAPI(req.Spec, connectorstore.ImportOptions{
		ConnectorID:        req.ConnectorID,
		DisplayName:        req.DisplayName,
		BaseURL:            req.BaseURL,
		ConfirmDestructive: req.ConfirmDestructive,
	})
	if list, needs := connectorstore.AsDestructiveNeedsConfirm(err); needs {
		writeJSON(w, http.StatusConflict, map[string]any{
			"code":    "40901",
			"message": "destructive actions need confirmation: " + strings.Join(list, ", "),
			"data":    map[string]any{"destructive": list},
		})
		return
	}
	if err != nil {
		writeConnectorError(w, http.StatusBadRequest, "40000", err.Error())
		return
	}
	if err := s.connectorStore.UpsertDefinition(r.Context(), req.TenantID, res.Connector); err != nil {
		writeConnectorError(w, http.StatusInternalServerError, "50000", err.Error())
		return
	}
	// 确保租户的连接器 MCP 入口（/mcp/connector/*）存在
	if err := s.connectorStore.EnsureConnectorServer(r.Context(), req.TenantID); err != nil {
		writeConnectorError(w, http.StatusInternalServerError, "50000", err.Error())
		return
	}
	writeConnectorOK(w, map[string]any{
		"connector": map[string]any{
			"id":          res.Connector.ID,
			"displayName": res.Connector.DisplayName,
			"description": res.Connector.Description,
			"authType":    string(res.Connector.Auth.Type),
			"actionCount": len(res.Connector.Actions),
			"baseUrl":     res.Connector.BaseURL,
		},
		"destructive": res.Destructive,
	})
}

func (s *Server) handleConnectorDelete(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeConnectorUnauthorized(w)
		return
	}
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	connectorID := chi.URLParam(r, "connectorId")
	if tenantID == "" {
		writeConnectorError(w, http.StatusBadRequest, "40000", "tenant_id is required")
		return
	}
	deleted, err := s.connectorStore.DeleteDefinition(r.Context(), tenantID, connectorID)
	if err != nil {
		writeConnectorError(w, http.StatusInternalServerError, "50000", err.Error())
		return
	}
	writeConnectorOK(w, map[string]any{"deleted": deleted})
}

func (s *Server) handleConnectionList(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeConnectorUnauthorized(w)
		return
	}
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	if tenantID == "" {
		writeConnectorError(w, http.StatusBadRequest, "40000", "tenant_id is required")
		return
	}
	conns, err := s.connectorStore.ListConnectionsForConnector(r.Context(), tenantID, chi.URLParam(r, "connectorId"))
	if err != nil {
		writeConnectorError(w, http.StatusInternalServerError, "50000", err.Error())
		return
	}
	writeConnectorOK(w, map[string]any{"connections": conns})
}

type connectionCreateRequest struct {
	TenantID      string   `json:"tenant_id"`
	Name          string   `json:"name"`
	GrantedScopes []string `json:"granted_scopes"`
	APIKey        string   `json:"api_key"`
}

func (s *Server) handleConnectionCreate(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeConnectorUnauthorized(w)
		return
	}
	var req connectionCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeConnectorError(w, http.StatusBadRequest, "40000", "invalid body")
		return
	}
	if strings.TrimSpace(req.TenantID) == "" {
		writeConnectorError(w, http.StatusBadRequest, "40000", "tenant_id is required")
		return
	}
	proj, err := s.connectorStore.CreateConnection(r.Context(), req.TenantID, connectorstore.CreateConnectionInput{
		ConnectorID:   chi.URLParam(r, "connectorId"),
		Name:          req.Name,
		GrantedScopes: req.GrantedScopes,
		APIKey:        req.APIKey,
	})
	if err != nil {
		writeConnectorError(w, http.StatusBadRequest, "40000", err.Error())
		return
	}
	writeConnectorOK(w, map[string]any{"connection": proj})
}

type connectionSecretRequest struct {
	TenantID string `json:"tenant_id"`
	APIKey   string `json:"api_key"`
}

func (s *Server) handleConnectionRotate(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeConnectorUnauthorized(w)
		return
	}
	var req connectionSecretRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeConnectorError(w, http.StatusBadRequest, "40000", "invalid body")
		return
	}
	if err := s.connectorStore.RotateConnectionSecret(r.Context(), req.TenantID, chi.URLParam(r, "connectionId"),
		connectorstore.RotateConnectionInput{APIKey: req.APIKey}); err != nil {
		writeConnectorError(w, http.StatusBadRequest, "40000", err.Error())
		return
	}
	writeConnectorOK(w, map[string]any{"rotated": true})
}

func (s *Server) handleConnectionRevoke(w http.ResponseWriter, r *http.Request) {
	if !gatewayInternalAuthorized(r) {
		writeConnectorUnauthorized(w)
		return
	}
	var req connectionSecretRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeConnectorError(w, http.StatusBadRequest, "40000", "invalid body")
		return
	}
	revoked, err := s.connectorStore.RevokeConnection(r.Context(), req.TenantID, chi.URLParam(r, "connectionId"))
	if err != nil {
		writeConnectorError(w, http.StatusInternalServerError, "50000", err.Error())
		return
	}
	writeConnectorOK(w, map[string]any{"revoked": revoked})
}

func writeConnectorUnauthorized(w http.ResponseWriter) {
	writeConnectorError(w, http.StatusUnauthorized, "40101", "unauthorized")
}

func writeConnectorError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"code": code, "message": message})
}

func writeConnectorOK(w http.ResponseWriter, data map[string]any) {
	writeJSON(w, http.StatusOK, map[string]any{"code": "00000", "message": "ok", "data": data})
}
