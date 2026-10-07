// Package server 装配 HTTP 面：
//   - POST /mcp        运行面（runtime token）：MCP JSON-RPC（无状态 Streamable HTTP）
//   - /admin/*         管理面（admin token）：目录/连接/策略/审计
//   - GET  /healthz    健康检查（无认证）
package server

import (
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/agenticx/connector-runtime/internal/audit"
	"github.com/agenticx/connector-runtime/internal/catalog"
	"github.com/agenticx/connector-runtime/internal/connection"
	"github.com/agenticx/connector-runtime/internal/executor"
	"github.com/agenticx/connector-runtime/internal/mcp"
	"github.com/agenticx/connector-runtime/internal/model"
	"github.com/agenticx/connector-runtime/internal/policy"
	"github.com/agenticx/connector-runtime/internal/secret"
)

// Config 服务配置。
type Config struct {
	DataDir             string   // 数据目录（密钥/连接/策略/审计）
	Connectors          []*model.Connector
	RuntimeToken        string   // 运行面 token；DevNoAuth 时可空
	AdminToken          string   // 管理面 token
	AllowPrivateNetwork bool     // 允许私网/环回上游（本地调试/内网）
	DevNoAuth           bool     // 本地调试：跳过 token 认证（不安全）
}

// Server 装配后的服务。
type Server struct {
	cfg        Config
	cat        *catalog.Store
	conns      *connection.Store
	pol        *policy.Policy
	mcp        *mcp.Server
	auditLog   *audit.Logger
	auditFile  *os.File
	handler    http.Handler
}

// New 装配服务（打开数据目录下的各类存储）。
func New(cfg Config) (*Server, error) {
	for _, c := range cfg.Connectors {
		if err := c.Validate(); err != nil {
			return nil, err
		}
	}
	cat, err := catalog.New(cfg.Connectors)
	if err != nil {
		return nil, err
	}
	key, err := secret.LoadOrGenerateKey(filepath.Join(cfg.DataDir, "master.key"))
	if err != nil {
		return nil, err
	}
	cipher, err := secret.NewCipher(key)
	if err != nil {
		return nil, err
	}
	conns, err := connection.Open(cfg.DataDir, cipher)
	if err != nil {
		return nil, err
	}
	pol, err := policy.Load(filepath.Join(cfg.DataDir, "policy.json"))
	if err != nil {
		return nil, err
	}
	auditLog, auditFile, err := audit.OpenFile(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	exec := executor.New(executor.Options{AllowPrivateNetwork: cfg.AllowPrivateNetwork})

	s := &Server{
		cfg: cfg, cat: cat, conns: conns, pol: pol,
		auditLog: auditLog, auditFile: auditFile,
		mcp: mcp.New(cat, conns, pol, exec, auditLog),
	}
	s.handler = s.buildRoutes()
	return s, nil
}

// Handler 返回 http.Handler。
func (s *Server) Handler() http.Handler { return s.handler }

// Close 释放底层资源。
func (s *Server) Close() error {
	if s.auditFile != nil {
		return s.auditFile.Close()
	}
	return nil
}

// Catalog 暴露目录（cmd 层 catalog 子命令用）。
func (s *Server) Catalog() *catalog.Store { return s.cat }

func (s *Server) buildRoutes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// MCP 运行面
	mux.HandleFunc("POST /mcp", s.requireRuntime(s.handleMCP))
	mux.HandleFunc("GET /mcp", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "仅支持 POST（无状态 Streamable HTTP）"})
	})

	// 管理面
	admin := s.requireAdmin(http.HandlerFunc(s.handleAdmin))
	mux.Handle("/admin/", admin)

	return mux
}

// ---- 认证 ----

func (s *Server) requireRuntime(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r, s.cfg.RuntimeToken) {
			return
		}
		next(w, r)
	}
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.authorize(w, r, s.cfg.AdminToken) {
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authorize(w http.ResponseWriter, r *http.Request, token string) bool {
	if s.cfg.DevNoAuth {
		return true
	}
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" || subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "未授权：缺少或错误的 Bearer token"})
		return false
	}
	return true
}

// ---- MCP ----

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "读取请求体失败"})
		return
	}
	out := s.mcp.Handle(r.Context(), body)
	if out.Body == nil {
		w.WriteHeader(out.Status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(out.Status)
	_ = json.NewEncoder(w).Encode(out.Body)
}

// ---- 管理面 ----

func (s *Server) handleAdmin(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case path == "/admin/apps" && r.Method == http.MethodGet:
		s.adminApps(w, r)
	case path == "/admin/connections" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"connections": s.conns.List(r.Context())})
	case path == "/admin/connections" && r.Method == http.MethodPost:
		s.adminCreateConnection(w, r)
	case strings.HasPrefix(path, "/admin/connections/") && r.Method == http.MethodDelete:
		id := strings.TrimPrefix(path, "/admin/connections/")
		if id == "" || s.conns.Delete(id) == false {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "连接不存在"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"deleted": true})
	case path == "/admin/policy" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, s.pol.Snapshot())
	case path == "/admin/policy" && r.Method == http.MethodPut:
		s.adminPutPolicy(w, r)
	case path == "/admin/audit" && r.Method == http.MethodGet:
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		entries, err := audit.ReadAll(filepath.Join(s.cfg.DataDir, "audit.log"), limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"entries": entries})
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "未知管理端点: " + path})
	}
}

func (s *Server) adminApps(w http.ResponseWriter, r *http.Request) {
	etag := s.cat.ETag()
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", etag)
	writeJSON(w, http.StatusOK, map[string]any{"apps": s.cat.Apps()})
}

func (s *Server) adminCreateConnection(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ConnectorID   string   `json:"connectorId"`
		Name          string   `json:"name"`
		GrantedScopes []string `json:"grantedScopes"`
		APIKey        string   `json:"apiKey"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体须为 JSON"})
		return
	}
	conn, ok := s.cat.Connector(req.ConnectorID)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "连接器不存在: " + req.ConnectorID})
		return
	}
	switch conn.Auth.Type {
	case model.AuthAPIKey:
		if req.APIKey == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "apiKey 不能为空"})
			return
		}
	case model.AuthNone:
		// 允许创建「仅授权 scope」的连接（无凭据），用于连接级授权
		if req.APIKey != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "none 认证连接器不接受 apiKey（可创建仅授权 scope 的连接）"})
			return
		}
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "暂不支持的认证类型: " + string(conn.Auth.Type)})
		return
	}
	p, err := s.conns.Create(req.ConnectorID, req.Name, string(conn.Auth.Type), req.GrantedScopes, connection.Secret{APIKey: req.APIKey})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) adminPutPolicy(w http.ResponseWriter, r *http.Request) {
	var p policy.Policy
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&p); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求体须为 JSON"})
		return
	}
	s.pol.UpdateFrom(&p)
	if err := s.pol.Save(s.cfg.DataDir); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "策略持久化失败: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, s.pol.Snapshot())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
