package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func (f *fixture) admin(t *testing.T, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var rd io.Reader
	if body != nil {
		switch b := body.(type) {
		case []byte:
			rd = bytes.NewReader(b)
		default:
			raw, _ := json.Marshal(b)
			rd = bytes.NewReader(raw)
		}
	}
	req, _ := http.NewRequest(method, f.srv.URL+path, rd)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func restDef(id, base string, auth map[string]any) map[string]any {
	return map[string]any{
		"id": id, "displayName": "My API", "baseUrl": base, "auth": auth, "allowPrivateNetwork": true,
		"actions": []any{map[string]any{
			"id": id + ".list_items", "title": "列出条目", "operationType": "read",
			"http": map[string]any{"method": "GET", "path": "/items"},
		}},
	}
}

func TestRegistryRegisterExecuteUnregister(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{}`)) })
	var gotAuth string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = w.Write([]byte(`{"items":[1,2]}`))
	}))
	defer up.Close()

	// 登记（bearer）
	code, out := f.admin(t, "PUT", "/admin/connectors/myapi", restDef("myapi", up.URL, map[string]any{"type": "bearer"}))
	if code != 200 || out["action"] != "created" {
		t.Fatalf("登记失败: %d %v", code, out)
	}
	// 再次同内容 → unchanged
	if _, out := f.admin(t, "PUT", "/admin/connectors/myapi", restDef("myapi", up.URL, map[string]any{"type": "bearer"})); out["action"] != "unchanged" {
		t.Fatalf("同内容应 unchanged: %v", out)
	}
	// 持久化位置 = 启动加载位置
	if _, err := os.Stat(filepath.Join(f.dataDir, "connectors", "myapi.json")); err != nil {
		t.Fatalf("定义未落盘: %v", err)
	}
	// 目录可见，origin=user
	_, apps := f.admin(t, "GET", "/admin/apps", nil)
	found := false
	for _, a := range apps["apps"].([]any) {
		m := a.(map[string]any)
		if m["id"] == "myapi" {
			found = m["origin"] == "user"
		}
	}
	if !found {
		t.Fatalf("目录未包含 user 连接器: %v", apps)
	}
	// 建连接 + 去重
	code, conn := f.admin(t, "POST", "/admin/connections", map[string]any{"connectorId": "myapi", "name": "主账号", "apiKey": "tok-A"})
	if code != 201 {
		t.Fatalf("建连接失败: %d %v", code, conn)
	}
	code, dup := f.admin(t, "POST", "/admin/connections", map[string]any{"connectorId": "myapi", "name": "另一个", "apiKey": "tok-A"})
	if code != 409 || dup["reason"] != "same_credential" {
		t.Fatalf("同凭据应 409: %d %v", code, dup)
	}
	if strings.Contains(mustString(dup), "tok-A") {
		t.Fatalf("409 响应不得回显凭据")
	}
	// 经 MCP 执行（省略 connectionId：单连接自动选用）
	text, isErr := f.toolText(t, "execute_action", map[string]any{"actionId": "myapi.list_items"})
	if isErr || !strings.Contains(text, "items") || gotAuth != "Bearer tok-A" {
		t.Fatalf("执行失败: %v %s auth=%q", isErr, text, gotAuth)
	}
	// 健康检查
	_, chk := f.admin(t, "POST", "/admin/connectors/myapi/check", map[string]any{})
	if chk["ok"] != true {
		t.Fatalf("健康检查失败: %v", chk)
	}
	// 更新凭据（合并）
	code, _ = f.admin(t, "PUT", "/admin/connections/"+conn["id"].(string)+"/secret", map[string]any{"apiKey": "tok-B"})
	if code != 200 {
		t.Fatalf("更新凭据失败: %d", code)
	}
	f.toolText(t, "execute_action", map[string]any{"actionId": "myapi.list_items"})
	if gotAuth != "Bearer tok-B" {
		t.Fatalf("凭据更新未生效: %q", gotAuth)
	}
	// 不能覆盖/注销内置
	if code, _ := f.admin(t, "PUT", "/admin/connectors/demo", restDef("demo", up.URL, map[string]any{"type": "none"})); code != 409 {
		t.Fatalf("覆盖内置应 409: %d", code)
	}
	if code, _ := f.admin(t, "DELETE", "/admin/connectors/demo", nil); code != 409 {
		t.Fatalf("注销内置应 409: %d", code)
	}
	// 注销：联动删除连接
	code, del := f.admin(t, "DELETE", "/admin/connectors/myapi", nil)
	if code != 200 || del["connectionsDeleted"].(float64) != 1 {
		t.Fatalf("注销失败: %d %v", code, del)
	}
	if _, isErr := f.toolText(t, "get_action_guide", map[string]any{"actionId": "myapi.list_items"}); !isErr {
		t.Fatalf("注销后动作应不可见")
	}
}

func TestRegistryHotReloadFromFile(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{}`)) })
	dir := filepath.Join(f.dataDir, "connectors")
	_ = os.MkdirAll(dir, 0o700)
	b, _ := json.Marshal(restDef("filedrop", "https://api.example.com", map[string]any{"type": "none"}))
	if err := os.WriteFile(filepath.Join(dir, "filedrop.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	text, isErr := f.toolText(t, "list_apps", nil)
	if isErr || !strings.Contains(text, "filedrop") {
		t.Fatalf("外部写入的定义应热加载: %s", text)
	}
	// 非法文件被跳过且不影响其他
	_ = os.WriteFile(filepath.Join(dir, "broken.json"), []byte(`{"id":"broken"`), 0o600)
	_, apps := f.admin(t, "GET", "/admin/connectors", nil)
	if !strings.Contains(mustString(apps), "filedrop") || !strings.Contains(mustString(apps["loadErrors"]), "broken.json") {
		t.Fatalf("非法文件应记录到 loadErrors: %v", apps)
	}
}

func TestRegistryValidation(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {})
	bad := restDef("x1", "ftp://nope", map[string]any{"type": "none"})
	if code, _ := f.admin(t, "PUT", "/admin/connectors/x1", bad); code != 400 {
		t.Fatalf("非法 baseUrl 应 400: %d", code)
	}
	if code, _ := f.admin(t, "PUT", "/admin/connectors/other", restDef("x2", "https://a.b", map[string]any{"type": "none"})); code != 400 {
		t.Fatalf("id 不一致应 400: %d", code)
	}
	hm := restDef("hm", "https://a.b", map[string]any{"type": "hmac", "hmac": map[string]any{"accessKeyHeader": "X-AK", "signatureHeader": "X-Sig"}})
	if code, _ := f.admin(t, "PUT", "/admin/connectors/hm", hm); code != 200 {
		t.Fatalf("hmac 定义应可登记: %d", code)
	}
	if code, out := f.admin(t, "POST", "/admin/connections", map[string]any{"connectorId": "hm", "name": "a", "accessKeyId": "AK"}); code != 400 {
		t.Fatalf("缺 SK 应 400: %d %v", code, out)
	}
}

func mustString(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
