package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenticx/connector-runtime/internal/model"
)

const runtimeToken = "rt-test-1234"
const adminToken = "at-test-5678"

// testConnectors：一个 no-auth 连接器 + 一个 api_key 连接器，上游为本地 httptest。
func testConnectors(t *testing.T, upstreamURL string, apiKeyUpstreamURL string) []*model.Connector {
	t.Helper()
	return []*model.Connector{
		{
			ID: "demo", DisplayName: "Demo", BaseURL: upstreamURL,
			Auth: model.AuthSpec{Type: model.AuthNone},
			Actions: []model.Action{
				{ID: "demo.fetch", Title: "取数", OperationType: "read",
					InputSchema: map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}},
					HTTP:        model.HTTPAction{Method: "GET", Path: "/items/{id}"}},
				{ID: "demo.purge", Title: "清空", OperationType: "destructive",
					RequiredScopes: []string{"admin"},
					HTTP:           model.HTTPAction{Method: "DELETE", Path: "/all"}},
			},
		},
		{
			ID: "keysvc", DisplayName: "KeySvc", BaseURL: apiKeyUpstreamURL,
			Auth: model.AuthSpec{Type: model.AuthAPIKey, APIKey: &model.APIKeyAuth{In: "header", Name: "X-Api-Key"}},
			Actions: []model.Action{
				{ID: "keysvc.secure_get", Title: "带密钥取数", OperationType: "read",
					HTTP: model.HTTPAction{Method: "GET", Path: "/secure"}},
			},
		},
	}
}

type fixture struct {
	srv    *httptest.Server
	api    *Server
	dataDir string
}

func newFixture(t *testing.T, upstream http.HandlerFunc) *fixture {
	t.Helper()
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)
	keyUp := httptest.NewServer(upstream)
	t.Cleanup(keyUp.Close)

	dataDir := t.TempDir()
	s, err := New(Config{
		DataDir:             dataDir,
		Connectors:          testConnectors(t, up.URL, keyUp.URL),
		RuntimeToken:        runtimeToken,
		AdminToken:          adminToken,
		AllowPrivateNetwork: true, // 测试上游是环回地址
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	hs := httptest.NewServer(s.Handler())
	t.Cleanup(hs.Close)
	return &fixture{srv: hs, api: s, dataDir: dataDir}
}

// rpc 发送 JSON-RPC 请求并解出 result.error。
func (f *fixture) rpc(t *testing.T, method string, params any) (json.RawMessage, *rpcErr, int) {
	t.Helper()
	body := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		body["params"] = params
	}
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", f.srv.URL+"/mcp", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+runtimeToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  *rpcErr         `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return out.Result, out.Error, resp.StatusCode
}

type rpcErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// callTool 调用工具并解出 content[0].text 与 isError。
func (f *fixture) callTool(t *testing.T, name string, args map[string]any) (map[string]any, bool, *rpcErr) {
	t.Helper()
	res, rerr, _ := f.rpc(t, "tools/call", map[string]any{"name": name, "arguments": args})
	if rerr != nil {
		return nil, false, rerr
	}
	var tr struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(res, &tr); err != nil {
		t.Fatalf("工具结果形态不符: %v %s", err, res)
	}
	if len(tr.Content) == 0 {
		t.Fatalf("工具结果缺少 content: %s", res)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(tr.Content[0].Text), &payload); err != nil {
		t.Fatalf("content[0].text 不是 JSON: %s", tr.Content[0].Text)
	}
	return payload, tr.IsError, nil
}

func TestHealthzAndAuth(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {})

	// healthz 无认证
	resp, err := http.Get(f.srv.URL + "/healthz")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("healthz: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// /mcp 无 token → 401
	req, _ := http.NewRequest("POST", f.srv.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 401 {
		t.Fatalf("无 token 应 401: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// 错误 token → 401
	req, _ = http.NewRequest("POST", f.srv.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	req.Header.Set("Authorization", "Bearer wrong")
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 401 {
		t.Fatalf("错误 token 应 401: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// runtime token 不能访问管理面
	req, _ = http.NewRequest("GET", f.srv.URL+"/admin/apps", nil)
	req.Header.Set("Authorization", "Bearer "+runtimeToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 401 {
		t.Fatalf("runtime token 访问管理面应 401: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// admin token 访问管理面 OK
	req, _ = http.NewRequest("GET", f.srv.URL+"/admin/apps", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("admin token 应 200: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// GET /mcp → 405
	resp, err = http.Get(f.srv.URL + "/mcp")
	if err != nil || resp.StatusCode != 405 {
		t.Fatalf("GET /mcp 应 405: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()
}

func TestMCPProtocolBasics(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {})

	// initialize：回显受支持版本
	res, rerr, status := f.rpc(t, "initialize", map[string]any{"protocolVersion": "2025-03-26"})
	if status != 200 || rerr != nil {
		t.Fatalf("initialize: %d %+v", status, rerr)
	}
	if !bytes.Contains(res, []byte(`"protocolVersion":"2025-03-26"`)) {
		t.Fatalf("应回显受支持版本: %s", res)
	}
	// 不受支持版本 → 回落最新
	res, _, _ = f.rpc(t, "initialize", map[string]any{"protocolVersion": "1999-01-01"})
	if !bytes.Contains(res, []byte(`"2025-06-18"`)) {
		t.Fatalf("不受支持版本应回落: %s", res)
	}

	// 通知 → 202 空 body
	body := `{"jsonrpc":"2.0","method":"notifications/initialized"}`
	req, _ := http.NewRequest("POST", f.srv.URL+"/mcp", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+runtimeToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 202 {
		t.Fatalf("通知应 202: %v %d", err, resp.StatusCode)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if len(b) != 0 {
		t.Fatalf("通知响应应为空 body: %s", b)
	}

	// 损坏 JSON → 400 + -32700
	req, _ = http.NewRequest("POST", f.srv.URL+"/mcp", strings.NewReader(`{`))
	req.Header.Set("Authorization", "Bearer "+runtimeToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 400 {
		t.Fatalf("损坏 JSON 应 400: %v %d", err, resp.StatusCode)
	}
	var er struct{ Error *rpcErr `json:"error"` }
	_ = json.NewDecoder(resp.Body).Decode(&er)
	resp.Body.Close()
	if er.Error == nil || er.Error.Code != -32700 {
		t.Fatalf("应为 -32700: %+v", er.Error)
	}

	// 未知方法 → -32601
	_, rerr, _ = f.rpc(t, "resources/list", nil)
	if rerr == nil || rerr.Code != -32601 {
		t.Fatalf("未知方法应 -32601: %+v", rerr)
	}

	// tools/list 恰好 5 个固定工具
	res, _, _ = f.rpc(t, "tools/list", nil)
	var tl struct {
		Tools []struct{ Name string `json:"name"` } `json:"tools"`
	}
	if err := json.Unmarshal(res, &tl); err != nil {
		t.Fatal(err)
	}
	want := []string{"list_apps", "list_connections", "search_actions", "get_action_guide", "execute_action"}
	if len(tl.Tools) != 5 {
		t.Fatalf("应恰好 5 工具: %+v", tl.Tools)
	}
	for i, n := range want {
		if tl.Tools[i].Name != n {
			t.Fatalf("工具集不符: %+v", tl.Tools)
		}
	}

	// 未知工具 → -32602
	_, _, rerr = f.callTool(t, "not_a_tool", nil)
	if rerr == nil || rerr.Code != -32602 {
		t.Fatalf("未知工具应 -32602: %+v", rerr)
	}
}

// toolText 调用工具并返回 content[0].text 原文与 isError（适用于数组型结果）。
func (f *fixture) toolText(t *testing.T, name string, args map[string]any) (string, bool) {
	t.Helper()
	res, rerr, _ := f.rpc(t, "tools/call", map[string]any{"name": name, "arguments": args})
	if rerr != nil {
		t.Fatalf("工具 %s 调用失败: %+v", name, rerr)
	}
	var tr struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(res, &tr); err != nil || len(tr.Content) == 0 {
		t.Fatalf("工具结果形态不符: %v %s", err, res)
	}
	return tr.Content[0].Text, tr.IsError
}

func TestMCPFiveToolsFlow(t *testing.T) {
	var lastPath string
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {
		lastPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":"value-42"}`))
	})

	// 1. list_apps（数组结果）
	text, isErr := f.toolText(t, "list_apps", nil)
	if isErr || !strings.Contains(text, `"demo"`) || !strings.Contains(text, `"keysvc"`) {
		t.Fatalf("list_apps: %s", text)
	}

	// 2. search_actions 命中（数组结果）
	text, isErr = f.toolText(t, "search_actions", map[string]any{"query": "purge"})
	if isErr {
		t.Fatalf("search_actions: %s", text)
	}
	var hits []map[string]any
	if err := json.Unmarshal([]byte(text), &hits); err != nil || len(hits) != 1 || hits[0]["id"] != "demo.purge" {
		t.Fatalf("search_actions 应命中 1 条: %s", text)
	}
	// 未知 connectorId → -32602
	_, _, rerr := f.callTool(t, "search_actions", map[string]any{"connectorId": "nope"})
	if rerr == nil || rerr.Code != -32602 {
		t.Fatalf("未知 connectorId 应 -32602: %+v", rerr)
	}

	// 3. get_action_guide 含 schema 与 scope
	res, isErr, _ := f.callTool(t, "get_action_guide", map[string]any{"actionId": "demo.purge"})
	if isErr {
		t.Fatalf("get_action_guide: %+v", res)
	}
	guide, _ := json.Marshal(res)
	if !strings.Contains(string(guide), "inputSchema") || !strings.Contains(string(guide), "admin") {
		t.Fatalf("guide 应含 schema 与 scope: %s", guide)
	}
	// 未知动作 → 工具级 unknown_action（isError）
	res, isErr, _ = f.callTool(t, "get_action_guide", map[string]any{"actionId": "demo.nope"})
	if !isErr {
		t.Fatalf("未知动作应 isError: %+v", res)
	}

	// 4. execute_action：no-auth 匿名执行成功
	res, isErr, _ = f.callTool(t, "execute_action", map[string]any{
		"actionId": "demo.fetch", "input": map[string]any{"id": "42"},
	})
	if isErr {
		t.Fatalf("execute_action: %+v", res)
	}
	if res["executionId"] == nil || !strings.HasPrefix(res["executionId"].(string), "exec-") {
		t.Fatalf("结果应含 executionId: %+v", res)
	}
	body, _ := json.Marshal(res["body"])
	if !strings.Contains(string(body), "value-42") {
		t.Fatalf("结果 body 不符: %s", body)
	}
	if lastPath != "/items/42" {
		t.Fatalf("上游路径不符: %s", lastPath)
	}

	// 5. api_key 连接器：无连接 → connection_not_found
	res, isErr, _ = f.callTool(t, "execute_action", map[string]any{"actionId": "keysvc.secure_get"})
	if !isErr || res["error"].(map[string]any)["code"] != "connection_not_found" {
		t.Fatalf("无连接应 connection_not_found: %+v", res)
	}
}

func TestAdminConnectionAndExecute(t *testing.T) {
	var lastAuth string
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {
		lastAuth = r.Header.Get("X-Api-Key")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	// 建连接（管理面）
	req, _ := http.NewRequest("POST", f.srv.URL+"/admin/connections", strings.NewReader(
		`{"connectorId":"keysvc","name":"生产密钥","apiKey":"sk-live-secret","grantedScopes":["admin"]}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 201 {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("建连接失败: %v %d %s", err, resp.StatusCode, b)
	}
	var proj struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&proj)
	resp.Body.Close()
	if proj.ID == "" {
		t.Fatal("应返回连接 id")
	}

	// 列表不含凭据
	req, _ = http.NewRequest("GET", f.srv.URL+"/admin/connections", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	listRaw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if strings.Contains(string(listRaw), "sk-live-secret") || strings.Contains(string(listRaw), "encryptedSecret") {
		t.Fatalf("连接列表泄漏凭据: %s", listRaw)
	}

	// 带连接执行：api_key 注入上游
	_, isErr, _ := f.callTool(t, "execute_action", map[string]any{
		"actionId": "keysvc.secure_get", "connectionId": proj.ID,
	})
	if isErr {
		t.Fatal("带连接执行应成功")
	}
	if lastAuth != "sk-live-secret" {
		t.Fatalf("上游应收 api_key header: %q", lastAuth)
	}

	// scope 授权：为 no-auth 连接器创建「仅授权 scope」连接（授予 admin）
	req, _ = http.NewRequest("POST", f.srv.URL+"/admin/connections", strings.NewReader(
		`{"connectorId":"demo","name":"管理员授权","grantedScopes":["admin"]}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 201 {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("创建 scope 连接失败: %v %d %s", err, resp.StatusCode, b)
	}
	var scopeProj struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&scopeProj)
	resp.Body.Close()
	_, isErr, _ = f.callTool(t, "execute_action", map[string]any{
		"actionId": "demo.purge", "connectionId": scopeProj.ID,
	})
	if isErr {
		t.Fatal("授予 admin scope 的连接应可执行 demo.purge")
	}
	// 匿名执行 demo.purge → scope_denied
	res, isErr, _ := f.callTool(t, "execute_action", map[string]any{"actionId": "demo.purge"})
	if !isErr || res["error"].(map[string]any)["code"] != "scope_denied" {
		t.Fatalf("匿名执行需 scope 动作应 scope_denied: %+v", res)
	}

	// 删除连接
	req, _ = http.NewRequest("DELETE", f.srv.URL+"/admin/connections/"+proj.ID, nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("删除连接: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()
	// 删除后执行 → connection_not_found
	res, isErr, _ = f.callTool(t, "execute_action", map[string]any{
		"actionId": "keysvc.secure_get", "connectionId": proj.ID,
	})
	if !isErr || res["error"].(map[string]any)["code"] != "connection_not_found" {
		t.Fatalf("删除后应 connection_not_found: %+v", res)
	}

	// no-auth 连接器带 apiKey 建连接 → 400；不带 apiKey（仅 scope）→ 允许
	req, _ = http.NewRequest("POST", f.srv.URL+"/admin/connections", strings.NewReader(
		`{"connectorId":"demo","name":"x","apiKey":"k"}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 400 {
		t.Fatalf("no-auth 连接器带 apiKey 应 400: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()
}

func TestPolicyAndAudit(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{}`))
	})

	// PUT 策略：阻止 demo.purge
	req, _ := http.NewRequest("PUT", f.srv.URL+"/admin/policy", strings.NewReader(
		`{"allow":["*"],"block":["demo.purge"]}`))
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("PUT 策略: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()

	// GET 策略回读
	req, _ = http.NewRequest("GET", f.srv.URL+"/admin/policy", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var pv struct {
		Block []string `json:"block"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&pv)
	resp.Body.Close()
	if len(pv.Block) != 1 || pv.Block[0] != "demo.purge" {
		t.Fatalf("策略回读不符: %+v", pv)
	}

	// 被阻止动作执行 → action_blocked（执行前拦截）
	res, isErr, _ := f.callTool(t, "execute_action", map[string]any{
		"actionId": "demo.purge", "connectionId": "conn-x",
	})
	if !isErr || res["error"].(map[string]any)["code"] != "action_blocked" {
		t.Fatalf("应被策略拦截: %+v", res)
	}

	// 审计可查：含 executionId、action、status
	req, _ = http.NewRequest("GET", f.srv.URL+"/admin/audit?limit=10", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var ar struct {
		Entries []map[string]any `json:"entries"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&ar)
	resp.Body.Close()
	if len(ar.Entries) == 0 {
		t.Fatal("审计应有记录")
	}
	found := false
	for _, e := range ar.Entries {
		if e["action"] == "demo.purge" && e["status"] == "denied" && strings.HasPrefix(fmt.Sprint(e["executionId"]), "exec-") {
			found = true
		}
	}
	if !found {
		t.Fatalf("审计应含 demo.purge 拒绝记录: %+v", ar.Entries)
	}
}

func TestAdminAppsETag(t *testing.T) {
	f := newFixture(t, func(w http.ResponseWriter, r *http.Request) {})

	get := func(ifNoneMatch string) (*http.Response, string) {
		req, _ := http.NewRequest("GET", f.srv.URL+"/admin/apps", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return resp, string(b)
	}
	resp, body := get("")
	if resp.StatusCode != 200 || resp.Header.Get("ETag") == "" || !strings.Contains(body, "demo") {
		t.Fatalf("apps: %d etag=%q body=%s", resp.StatusCode, resp.Header.Get("ETag"), body)
	}
	resp2, body2 := get(resp.Header.Get("ETag"))
	if resp2.StatusCode != 304 || body2 != "" {
		t.Fatalf("ETag 命中应 304: %d %s", resp2.StatusCode, body2)
	}
}

func TestDevNoAuth(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer up.Close()
	s, err := New(Config{
		DataDir:             t.TempDir(),
		Connectors:          testConnectors(t, up.URL, up.URL),
		DevNoAuth:           true,
		AllowPrivateNetwork: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	hs := httptest.NewServer(s.Handler())
	defer hs.Close()

	req, _ := http.NewRequest("POST", hs.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("DevNoAuth 应免认证: %v %d", err, resp.StatusCode)
	}
	resp.Body.Close()
}
