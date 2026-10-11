package server

// 端到端验收：真实供给（内置连接器 + 外部目录定义）+ 真实 HTTP 监听，
// 驱动「搜索-发现-执行」全链路与连接管理、策略拦截、审计落盘。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenticx/connector-runtime/internal/connectors"
)

// writeDef 向临时供给目录写一份连接器定义。
func writeDef(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

// newE2EFixture 内置供给 + 外部目录（指向本地 httptest 上游）+ 真实监听。
func newE2EFixture(t *testing.T, upstream, keyUpstream http.HandlerFunc) *fixture {
	t.Helper()
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)
	keyUp := httptest.NewServer(keyUpstream)
	t.Cleanup(keyUp.Close)

	dir := t.TempDir()
	writeDef(t, dir, "localdemo.json", fmt.Sprintf(`{
		"id": "localdemo",
		"displayName": "本地演示",
		"baseUrl": %q,
		"auth": {"type": "none"},
		"actions": [
			{"id": "localdemo.fetch", "title": "取数", "operationType": "read",
			 "description": "按 id 取一条数据",
			 "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}},
			 "http": {"method": "GET", "path": "/items/{id}"}}
		]
	}`, up.URL))
	writeDef(t, dir, "keydemo.json", fmt.Sprintf(`{
		"id": "keydemo",
		"displayName": "本地密钥演示",
		"baseUrl": %q,
		"auth": {"type": "api_key", "apiKey": {"in": "header", "name": "X-Api-Key"}},
		"actions": [
			{"id": "keydemo.secure_get", "title": "带密钥取数", "operationType": "read",
			 "http": {"method": "GET", "path": "/secure"}}
		]
	}`, keyUp.URL))

	all, err := connectors.All(dir)
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	s, err := New(Config{
		DataDir:             dataDir,
		Connectors:          all,
		RuntimeToken:        runtimeToken,
		AdminToken:          adminToken,
		AllowPrivateNetwork: true, // e2e 上游是环回地址
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	hs := httptest.NewServer(s.Handler())
	t.Cleanup(hs.Close)
	return &fixture{srv: hs, api: s, dataDir: dataDir}
}

// adminReq 管理面原始请求。
func (f *fixture) adminReq(t *testing.T, method, path, body string) *http.Response {
	t.Helper()
	var rd *strings.Reader
	if body == "" {
		rd = strings.NewReader("")
	} else {
		rd = strings.NewReader(body)
	}
	req, _ := http.NewRequest(method, f.srv.URL+path, rd)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestE2EFullFlow(t *testing.T) {
	var gotPath, gotKey string
	f := newE2EFixture(t,
		func(w http.ResponseWriter, r *http.Request) { // localdemo 上游
			gotPath = r.URL.Path
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
		},
		func(w http.ResponseWriter, r *http.Request) { // keydemo 上游
			gotKey = r.Header.Get("X-Api-Key")
			if gotKey != "e2e-secret" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"secure":true}`))
		},
	)

	// 1. 内置供给 + 外部目录均在目录中
	text, _ := f.toolText(t, "list_apps", nil)
	for _, id := range []string{"httpbin", "ipinfo", "jsonplaceholder", "localdemo", "keydemo"} {
		if !strings.Contains(text, `"`+id+`"`) {
			t.Fatalf("list_apps 缺少 %s: %s", id, text)
		}
	}

	// 2. search_actions 命中
	text, _ = f.toolText(t, "search_actions", map[string]any{"query": "localdemo"})
	if !strings.Contains(text, "localdemo.fetch") {
		t.Fatalf("search_actions 未命中 localdemo.fetch: %s", text)
	}

	// 3. get_action_guide 返回完整指南
	guide, isErr, _ := f.callTool(t, "get_action_guide", map[string]any{"actionId": "localdemo.fetch"})
	if isErr {
		t.Fatalf("get_action_guide 出错: %v", guide)
	}
	if _, ok := guide["inputSchema"]; !ok {
		t.Fatalf("guide 缺 inputSchema: %v", guide)
	}
	if _, ok := guide["connector"]; !ok {
		t.Fatalf("guide 缺 connector: %v", guide)
	}

	// 4. no-auth 匿名执行成功，executionId 贯穿
	res, isErr, _ := f.callTool(t, "execute_action", map[string]any{
		"actionId": "localdemo.fetch", "input": map[string]any{"id": "42"},
	})
	if isErr {
		t.Fatalf("no-auth 执行失败: %v", res)
	}
	if gotPath != "/items/42" {
		t.Fatalf("上游路径不符: %s", gotPath)
	}
	body, _ := json.Marshal(res["body"])
	if !bytes.Contains(body, []byte(`"ok":true`)) {
		t.Fatalf("执行 body 不符: %s", body)
	}
	execID, _ := res["executionId"].(string)
	if !strings.HasPrefix(execID, "exec-") {
		t.Fatalf("executionId 形态不符: %v", execID)
	}

	// 5. api_key 连接器缺 connectionId → connection_not_found
	res, isErr, _ = f.callTool(t, "execute_action", map[string]any{"actionId": "keydemo.secure_get"})
	if !isErr {
		t.Fatalf("缺 connectionId 应被拒: %v", res)
	}
	if !strings.Contains(fmt.Sprint(res), "connection_not_found") {
		t.Fatalf("应为 connection_not_found: %v", res)
	}

	// 6. 管理面建连接 → 带连接执行，密钥注入上游
	resp := f.adminReq(t, "POST", "/admin/connections",
		`{"connectorId":"keydemo","name":"e2e 连接","apiKey":"e2e-secret"}`)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("建连接应 201: %d", resp.StatusCode)
	}
	var created struct {
		ID           string `json:"id"`
		ConnectorID  string `json:"connectorId"`
		GrantedScopes []string `json:"grantedScopes"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&created)
	resp.Body.Close()
	if created.ID == "" || created.ConnectorID != "keydemo" {
		t.Fatalf("连接投影不符: %+v", created)
	}

	res, isErr, _ = f.callTool(t, "execute_action", map[string]any{
		"actionId": "keydemo.secure_get", "connectionId": created.ID,
	})
	if isErr {
		t.Fatalf("带连接执行失败: %v", res)
	}
	if gotKey != "e2e-secret" {
		t.Fatalf("上游未收到注入的密钥: %q", gotKey)
	}
	if sc, _ := res["statusCode"].(float64); sc != 200 {
		t.Fatalf("上游状态码不符: %v", res["statusCode"])
	}

	// 7. list_connections 可见连接且不含凭据
	text, _ = f.toolText(t, "list_connections", nil)
	if !strings.Contains(text, created.ID) {
		t.Fatalf("list_connections 缺少连接 %s: %s", created.ID, text)
	}
	if strings.Contains(text, "e2e-secret") {
		t.Fatalf("list_connections 泄漏凭据: %s", text)
	}

	// 8. 策略拦截：block keydemo.* → action_blocked
	resp = f.adminReq(t, "PUT", "/admin/policy", `{"block":["keydemo.*"],"default":"allow"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("更新策略应 200: %d", resp.StatusCode)
	}
	resp.Body.Close()
	res, isErr, _ = f.callTool(t, "execute_action", map[string]any{
		"actionId": "keydemo.secure_get", "connectionId": created.ID,
	})
	if !isErr || !strings.Contains(fmt.Sprint(res), "action_blocked") {
		t.Fatalf("应被策略拦截: %v", res)
	}

	// 9. 审计落盘：ok 与 denied 记录均在，且带 executionId
	resp = f.adminReq(t, "GET", "/admin/audit?limit=100", "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("审计查询应 200: %d", resp.StatusCode)
	}
	var auditOut struct {
		Entries []struct {
			ExecutionID string `json:"executionId"`
			Action      string `json:"action"`
			Status      string `json:"status"`
			ErrorCode   string `json:"errorCode"`
		} `json:"entries"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&auditOut)
	resp.Body.Close()

	var hasOK, hasDenied bool
	for _, e := range auditOut.Entries {
		if !strings.HasPrefix(e.ExecutionID, "exec-") {
			t.Fatalf("审计记录缺 executionId: %+v", e)
		}
		if e.Action == "keydemo.secure_get" && e.Status == "ok" {
			hasOK = true
		}
		if e.Action == "keydemo.secure_get" && e.Status == "denied" && e.ErrorCode == "action_blocked" {
			hasDenied = true
		}
	}
	if !hasOK || !hasDenied {
		t.Fatalf("审计应含 ok 与 denied(action_blocked) 记录: %+v", auditOut.Entries)
	}

	// 10. 删除连接 → list_connections 不再包含
	resp = f.adminReq(t, "DELETE", "/admin/connections/"+created.ID, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("删除连接应 200: %d", resp.StatusCode)
	}
	resp.Body.Close()
	text, _ = f.toolText(t, "list_connections", nil)
	if strings.Contains(text, created.ID) {
		t.Fatalf("连接删除后仍可见: %s", text)
	}
}
