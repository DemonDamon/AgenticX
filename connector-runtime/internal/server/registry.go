package server

// 运行时连接器登记（REST 连接器热注册）：
//   - 用户定义持久化在 UserConnectorsDir/<id>.json（与启动加载同一位置）；
//   - PUT    /admin/connectors/{id}        登记/更新（校验 → 原子落盘 → 热加载）
//   - DELETE /admin/connectors/{id}        注销（仅 user 来源；联动删除其连接）
//   - GET    /admin/connectors/{id}        读取完整定义
//   - POST   /admin/connectors/{id}/check  健康检查（OAuth 取 token + 执行首个无必填参数的 read 动作）
// 目录文件被外部改写（如 Python 侧直接写文件）时，下一次请求按指纹变化热加载。

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/agenticx/connector-runtime/internal/catalog"
	"github.com/agenticx/connector-runtime/internal/model"
)

// dirSignature 目录指纹：文件名 + mtime + size（无文件返回空串）。
func dirSignature(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	parts := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s:%d:%d", e.Name(), info.ModTime().UnixNano(), info.Size()))
	}
	sort.Strings(parts)
	return strings.Join(parts, "|")
}

// reloadUserConnectors 按需（指纹变化或 force）重建目录：内置 + 用户定义。
// 单个用户文件非法/与内置冲突时跳过该文件（记录到 loadErrors），不影响其余。
func (s *Server) reloadUserConnectors(force bool) {
	dir := s.cfg.UserConnectorsDir
	if dir == "" {
		return
	}
	s.reloadMu.Lock()
	defer s.reloadMu.Unlock()
	sig := dirSignature(dir)
	if !force && sig == s.userSig {
		return
	}
	all := make([]*model.Connector, 0, len(s.cfg.Connectors))
	all = append(all, s.cfg.Connectors...)
	origins := map[string]string{}
	var errs []string
	entries, _ := os.ReadDir(dir)
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	seen := map[string]bool{}
	for _, name := range names {
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			errs = append(errs, name+": "+err.Error())
			continue
		}
		c, err := model.Parse(b)
		if err != nil {
			errs = append(errs, name+": "+err.Error())
			continue
		}
		if s.builtinIDs[c.ID] || seen[c.ID] {
			errs = append(errs, name+": id 与内置/已有连接器冲突: "+c.ID)
			continue
		}
		if strings.TrimSuffix(name, ".json") != c.ID {
			errs = append(errs, name+": 文件名须为 <id>.json")
			continue
		}
		seen[c.ID] = true
		origins[c.ID] = catalog.OriginUser
		all = append(all, c)
	}
	if err := s.cat.Replace(all, origins); err != nil {
		errs = append(errs, "目录重建失败: "+err.Error())
	}
	s.userSig = sig
	s.loadErrors = errs
}

// handleRegistry 处理 /admin/connectors/*；返回 false 表示非本组端点。
func (s *Server) handleRegistry(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	if path == "/admin/connectors" && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, map[string]any{"apps": s.cat.Apps(), "loadErrors": s.loadErrors})
		return true
	}
	if !strings.HasPrefix(path, "/admin/connectors/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/admin/connectors/")
	id, sub, _ := strings.Cut(rest, "/")
	switch {
	case sub == "" && r.Method == http.MethodGet:
		c, ok := s.cat.Connector(id)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "连接器不存在"})
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"connector": c, "origin": s.cat.Origin(id)})
	case sub == "" && r.Method == http.MethodPut:
		s.adminPutConnector(w, r, id)
	case sub == "" && r.Method == http.MethodDelete:
		s.adminDeleteConnector(w, id)
	case sub == "check" && r.Method == http.MethodPost:
		s.adminCheckConnector(w, r, id)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "未知管理端点: " + path})
	}
	return true
}

func (s *Server) adminPutConnector(w http.ResponseWriter, r *http.Request, id string) {
	if s.cfg.UserConnectorsDir == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "未配置用户连接器目录"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "读取请求体失败"})
		return
	}
	c, err := model.Parse(body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if c.ID != id {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "路径 id 与定义 id 不一致"})
		return
	}
	if s.builtinIDs[id] {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "id 与内置连接器冲突，不能覆盖: " + id, "reason": "builtin"})
		return
	}
	canonical, _ := json.MarshalIndent(c, "", "  ")
	target := filepath.Join(s.cfg.UserConnectorsDir, id+".json")
	action := "created"
	if old, err := os.ReadFile(target); err == nil {
		if string(old) == string(canonical) {
			action = "unchanged"
		} else {
			action = "updated"
		}
	}
	if action != "unchanged" {
		if err := os.MkdirAll(s.cfg.UserConnectorsDir, 0o700); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建目录失败"})
			return
		}
		tmp := target + ".tmp"
		if err := os.WriteFile(tmp, canonical, 0o600); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "写入定义失败"})
			return
		}
		if err := os.Rename(tmp, target); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "写入定义失败"})
			return
		}
	}
	s.reloadUserConnectors(true)
	if _, ok := s.cat.Connector(id); !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "登记后未能加载", "loadErrors": s.loadErrors})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"action": action, "id": id, "actionCount": len(c.Actions)})
}

func (s *Server) adminDeleteConnector(w http.ResponseWriter, id string) {
	if s.builtinIDs[id] {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "内置连接器不可注销", "reason": "builtin"})
		return
	}
	target := filepath.Join(s.cfg.UserConnectorsDir, id+".json")
	if s.cfg.UserConnectorsDir == "" || !idPatternOK(id) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "连接器不存在"})
		return
	}
	if err := os.Remove(target); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "连接器不存在"})
		return
	}
	n := s.conns.DeleteByConnector(id)
	s.reloadUserConnectors(true)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "connectionsDeleted": n})
}

func idPatternOK(id string) bool {
	c := model.Connector{ID: id, DisplayName: "x", BaseURL: "https://x", Auth: model.AuthSpec{Type: model.AuthNone},
		Actions: []model.Action{{ID: id + ".x", Title: "x", OperationType: "read", HTTP: model.HTTPAction{Method: "GET", Path: "/"}}}}
	return c.Validate() == nil
}

// adminCheckConnector 健康检查：选首个无必填参数的 read 动作执行一次。
// body 可选 {"connectionId": "...", "actionId": "..."}。
func (s *Server) adminCheckConnector(w http.ResponseWriter, r *http.Request, id string) {
	conn, ok := s.cat.Connector(id)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "连接器不存在"})
		return
	}
	var req struct {
		ConnectionID string         `json:"connectionId"`
		ActionID     string         `json:"actionId"`
		Input        map[string]any `json:"input"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req)
	var act *model.Action
	for i := range conn.Actions {
		a := &conn.Actions[i]
		if req.ActionID != "" {
			if a.ID == req.ActionID {
				act = a
				break
			}
			continue
		}
		if a.OperationType == "read" && len(requiredOf(a.InputSchema)) == 0 {
			act = a
			break
		}
	}
	if act == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "code": "no_probe_action", "message": "没有可用于探测的无参 read 动作"})
		return
	}
	connID := req.ConnectionID
	if connID == "" && conn.Auth.Type != model.AuthNone {
		for _, p := range s.conns.List(r.Context()) {
			if p.ConnectorID == id {
				connID = p.ID
				break
			}
		}
	}
	sec, _ := s.conns.Reveal(r.Context(), connID)
	if conn.Auth.Type != model.AuthNone && connID == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "code": "connection_not_found", "message": "该连接器尚无连接（凭据）"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	res, xerr := s.exec.ExecuteConn(ctx, conn, *act, req.Input, sec, connID)
	if xerr != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "actionId": act.ID, "code": xerr.Code, "message": xerr.Message})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "actionId": act.ID, "statusCode": res.StatusCode, "durationMs": res.DurationMS})
}

func requiredOf(schema map[string]any) []string {
	raw, _ := schema["required"].([]any)
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
